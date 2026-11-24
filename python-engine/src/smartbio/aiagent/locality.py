"""FR-8.5 locality receipt: what ran locally and what left the machine.

The agent computes the receipt from the job contract and the staged inputs;
plugins can neither emit nor suppress one. No secret value is copied into the
receipt — a consent token is represented by a one-way, display-safe reference.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any

# Backends that never move data off the executing machine.
_LOCAL_BACKENDS = {"local-python", "browser-local"}

# Preferred staged-input fields, in the same order as the agent's input hash.
_TEXT_INPUT_KEYS = (
    "fasta_text",
    "tsv_text",
    "blast_tsv_text",
    "blast_text",
    "blast_tsv",
    "taxonomy_map_text",
    "text",
    "payload",
    "content",
)

# Metadata keys a plugin or a simulated job may use to describe an egress step.
_TRANSMISSION_KEYS = ("external_transmission", "egress", "transmission", "outbound")
_DESTINATION_KEYS = ("destination", "url", "endpoint", "service", "host", "to")

# Tokens are bearer secrets: never display them, even in abbreviated form.
_TOKEN_PREFIXES = ("consent_", "tk_", "sk_", "bearer ")
_SAFE_REFERENCE_RE = re.compile(r"^[A-Za-z0-9._:_-]{1,64}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _reference(value: Any, *, field: str = "consent") -> str | None:
    """Return a display-safe reference for an id/token supplied in the job."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, dict):
        for key in ("id", "consent_id", "approval_id", "reference", "ref"):
            if value.get(key):
                return _reference(value[key], field=key)
        for key in ("token", "consent_token", "access_token"):
            if value.get(key):
                return _reference(value[key], field=key)
        for key in ("scope", "name"):
            if value.get(key):
                return _reference(value[key], field=key)
        return None
    text = str(value).strip()
    if not text:
        return None
    is_secret = "token" in field.lower() or text.lower().startswith(_TOKEN_PREFIXES)
    if is_secret:
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
        return f"token-ref:{digest}"
    if _SAFE_REFERENCE_RE.fullmatch(text):
        return text
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
    return f"ref:{digest}"


def _consent_records(job: dict[str, Any]) -> list[str]:
    """Collect references for approvals/consents actually supplied in a job."""
    records: list[str] = []

    def add(value: Any, field: str) -> None:
        reference = _reference(value, field=field)
        if reference and reference not in records:
            records.append(reference)

    consent = _as_dict(job.get("consent"))
    if consent:
        for key in ("id", "consent_id", "approval_id", "scope", "reference"):
            add(consent.get(key), key)
    for key in ("consent", "consent_id", "consent_token", "approval"):
        if key in job:
            add(job[key], key)
    for key in ("consents", "consent_records", "approvals"):
        value = job.get(key)
        if isinstance(value, dict):
            add(value, key)
        elif isinstance(value, (list, tuple)):
            for item in value:
                add(item, key)
        elif isinstance(value, str):
            add(value, key)
    return records


def _staged_input(job: dict[str, Any]) -> tuple[int | None, str | None]:
    """Measure the staged input that an egress step would transmit."""
    inputs = job.get("inputs")
    if not isinstance(inputs, dict):
        return None, None
    for key in _TEXT_INPUT_KEYS:
        value = inputs.get(key)
        if isinstance(value, str) and value.strip():
            data = value.encode("utf-8")
            return len(data), hashlib.sha256(data).hexdigest()
    chunks: list[str] = []
    for key in sorted(inputs):
        value = inputs[key]
        if isinstance(value, str) and value:
            chunks.append(f"{key}={value}")
        elif isinstance(value, (bytes, bytearray)):
            chunks.append(f"{key}={bytes(value).hex()}")
    if not chunks:
        return None, None
    data = "\n".join(chunks).encode("utf-8")
    return len(data), hashlib.sha256(data).hexdigest()


def _as_dict(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _egress_descriptors(
    job: dict[str, Any], step: dict[str, Any], meta: dict[str, Any]
) -> list[dict[str, Any]]:
    """Find explicit transmission metadata, or synthesise it for an egress step."""
    descriptors: list[dict[str, Any]] = []
    for source in (meta, job, step):
        source = _as_dict(source) or {}
        for key in _TRANSMISSION_KEYS:
            details = _as_dict(source.get(key))
            if details is not None:
                descriptor = dict(details)
                has_consent = any(
                    descriptor.get(key) for key in ("consent", "consent_id", "consent_token", "consent_ref")
                )
                if not has_consent and source.get("consent") is not None:
                    descriptor["consent"] = source.get("consent")
                descriptors.append(descriptor)
    egress = bool(job.get("external_egress") or step.get("external_egress"))
    if egress and not descriptors:
        services = job.get("external_services") or step.get("external_services") or []
        if isinstance(services, str):
            services = [services]
        if not isinstance(services, (list, tuple)):
            services = []
        for service in services:
            descriptors.append({"destination": str(service)})
        if not descriptors:
            descriptors.append({})
    return descriptors


def _destination(descriptor: dict[str, Any], step: dict[str, Any]) -> str:
    for source in (descriptor, step):
        for key in _DESTINATION_KEYS:
            value = source.get(key)
            if value:
                return str(value)
    return "unspecified-external-service"


def _steps(job: dict[str, Any], step: dict[str, Any]) -> list[dict[str, Any]]:
    """Use the plan's steps when embedded, otherwise the one dispatched step."""
    plan = _as_dict(job.get("plan")) or _as_dict(job.get("plan_json")) or {}
    candidates = plan.get("steps") or job.get("steps")
    if isinstance(candidates, list):
        steps = [item for item in candidates if isinstance(item, dict)]
        if steps:
            return steps
    return [step]


def build_locality_receipt(
    job: dict[str, Any],
    step: dict[str, Any],
    *,
    execution_mode: str = "real",
    input_hash: str | None = None,
    tool_run_meta: dict[str, Any] | None = None,
    now: str | None = None,
) -> dict[str, Any]:
    """Build the FR-8.5 locality receipt for one dispatched job."""
    job = job or {}
    step = step or {}
    meta = tool_run_meta or {}
    timestamp = now or _now()
    local_operations: list[dict[str, Any]] = []
    transmissions: list[dict[str, Any]] = []
    records = _consent_records(job)
    staged_bytes, staged_hash = _staged_input(job)

    for current in _steps(job, step):
        backend = str(
            current.get("backend") or job.get("backend") or "local-python"
        )
        name = current.get("tool_id") or job.get("tool_id") or current.get("id") or "step"
        descriptors = _egress_descriptors(job, current, meta)
        if not descriptors and backend in _LOCAL_BACKENDS:
            local_operations.append(
                {
                    "name": str(name),
                    "step_id": current.get("id") or job.get("step_id"),
                    "tool_id": current.get("tool_id") or job.get("tool_id"),
                    "backend": backend,
                }
            )
        for descriptor in descriptors:
            consent = None
            for key in ("consent", "consent_id", "consent_token", "consent_ref"):
                if descriptor.get(key):
                    consent = _reference(descriptor[key], field=key)
                    break
            if consent is None and records:
                consent = records[0]
            transmitted_bytes = descriptor.get("bytes_sent")
            if transmitted_bytes is None and staged_bytes is not None:
                transmitted_bytes = staged_bytes
            if isinstance(transmitted_bytes, str) and transmitted_bytes.isdigit():
                transmitted_bytes = int(transmitted_bytes)
            transmissions.append(
                {
                    "step_id": current.get("id") or job.get("step_id"),
                    "tool_id": current.get("tool_id") or job.get("tool_id"),
                    "destination": _destination(descriptor, current),
                    "bytes_sent": transmitted_bytes,
                    "input_sha256": descriptor.get("input_sha256")
                    or staged_hash
                    or input_hash,
                    "consent": consent,
                    "timestamp": descriptor.get("timestamp") or timestamp,
                }
            )

    return {
        "mode": "mock" if execution_mode == "mock" else "real",
        "no_external_egress": not transmissions,
        "local_operations": local_operations,
        "external_transmissions": transmissions,
        "consent_records": records,
    }


__all__ = ["build_locality_receipt"]
