"""Optional OpenAI-compatible LLM provider (9Router local proxy).

DESIGN CONTRACT
---------------
This module is a *phrasing* aid only. It is never a source of scientific values,
citations or statistics. Any text it returns must still pass
``smartbio.aiagent.explanation.check_explanation`` before use.

It is disabled by default. Enable explicitly with::

    AI_LLM_PROVIDER=ninerouter
    NINEROUTER_API_KEY=...            # read from the environment, never logged
    NINEROUTER_BASE_URL=http://127.0.0.1:20128/v1   # optional, this is the default
    NINEROUTER_MODEL=auto             # optional

9Router is a local OpenAI-compatible proxy that may route requests to remote
models. Therefore prompts contain ONLY already-validated finding text and
numbers — never raw uploaded sequences or private data. The generated report
records that an external model assisted with phrasing.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

DEFAULT_BASE_URL = "http://127.0.0.1:20128/v1"
DEFAULT_MODEL = "auto"
DEFAULT_TIMEOUT_SECONDS = 20


class LLMError(RuntimeError):
    """Raised when the configured LLM provider cannot produce usable text."""


@dataclass(frozen=True)
class OpenAICompatibleProvider:
    """Minimal OpenAI-compatible chat-completions client (stdlib only)."""

    api_key: str
    base_url: str = DEFAULT_BASE_URL
    model: str = DEFAULT_MODEL
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    provider_name: str = "9Router"

    @property
    def name(self) -> str:
        return f"{self.provider_name}/{self.model}"

    def available(self) -> bool:
        return bool(self.api_key.strip())

    def chat(self, system: str, user: str) -> str:
        """Return the assistant text, or raise LLMError. Never logs the key."""
        if not self.available():
            raise LLMError("LLM provider is not configured")
        endpoint = self.base_url.rstrip("/") + "/chat/completions"
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0,
        }
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                body = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            # Deliberately do not include the URL headers or key in the message.
            raise LLMError(f"LLM request failed: {type(exc).__name__}") from None

        choices = body.get("choices") or []
        if not choices:
            raise LLMError("LLM returned no choices")
        try:
            content = choices[0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise LLMError("LLM returned an unexpected shape") from None
        if not isinstance(content, str) or not content.strip():
            raise LLMError("LLM returned empty content")
        return content.strip()


def provider_from_env() -> OpenAICompatibleProvider | None:
    """Return the configured provider, or None when LLM use is not opted in.

    Opt-in requires ``AI_LLM_PROVIDER=ninerouter`` AND a non-empty
    ``NINEROUTER_API_KEY``. A missing key never raises: the platform falls back
    to its deterministic explanation path.
    """
    if os.environ.get("AI_LLM_PROVIDER", "").strip().lower() != "ninerouter":
        return None
    key = os.environ.get("NINEROUTER_API_KEY", "").strip()
    if not key:
        return None
    try:
        timeout = float(os.environ.get("AI_LLM_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
    except ValueError:
        timeout = DEFAULT_TIMEOUT_SECONDS
    return OpenAICompatibleProvider(
        api_key=key,
        base_url=os.environ.get("NINEROUTER_BASE_URL", DEFAULT_BASE_URL).strip(),
        model=os.environ.get("NINEROUTER_MODEL", DEFAULT_MODEL).strip(),
        timeout_seconds=timeout,
    )
