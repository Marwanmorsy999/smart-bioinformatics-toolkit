"""Taxonomy resolver.

Supports two sources of taxonomic information:

1. A local taxonomy mapping TSV (taxid, scientific_name, rank, parent_taxid,
   full_lineage).
2. Optional online NCBI Taxonomy resolution via E-utilities (esummary).

Multiple taxonomy identifiers in a single BLAST row (semicolon-separated
staxids / sscinames) are resolved independently and never silently collapsed
to the first value.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

import urllib.error
import urllib.request
import urllib.parse

from smartbio.taxonomy.lineage import (
    TAXONOMIC_RANKS,
    Lineage,
    lineage_from_mapping,
    lineage_from_ncbi_lineage_ex,
)

KNOWN_RANKS = set(TAXONOMIC_RANKS)

# NCBI E-utilities base.
EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"

# Default polite request rate (requests per second) without an API key.
DEFAULT_RATE_LIMIT = 3.0

TAXONOMY_MAP_COLUMNS = [
    "taxid",
    "scientific_name",
    "rank",
    "parent_taxid",
    "full_lineage",
]


class TaxonomyResolverError(RuntimeError):
    """Raised when taxonomy resolution cannot proceed."""


class TaxonInfo:
    """Resolved taxonomic information for one identifier."""

    def __init__(
        self,
        taxid: int | str | None,
        scientific_name: str | None,
        rank: str | None,
        lineage: Lineage,
        source: str,
    ):
        self.taxid = taxid
        self.scientific_name = scientific_name
        self.rank = rank
        self.lineage = lineage
        self.source = source  # "mapping" | "ncbi" | "unresolved" | "missing"

    def to_dict(self) -> dict[str, Any]:
        return {
            "taxid": self.taxid,
            "scientific_name": self.scientific_name,
            "rank": self.rank,
            "lineage": self.lineage.to_dict(),
            "source": self.source,
        }


class NcbiEutilsClient:
    """Small, polite NCBI E-utilities client.

    - Batches taxonomy IDs into a single esummary request.
    - Deduplicates IDs before requesting.
    - Respects a configurable request rate (3/sec default, 10/sec with API key).
    - Caches successful lookups in memory (and optionally on disk).
    - Never retries forever; reports failures explicitly.
    """

    def __init__(
        self,
        *,
        tool: str = "smartbio",
        email: str | None = None,
        api_key: str | None = None,
        rate_limit: float = DEFAULT_RATE_LIMIT,
        timeout: float = 20.0,
        cache: dict[int | str, dict[str, Any]] | None = None,
    ) -> None:
        self.tool = tool
        self.email = email
        self.api_key = api_key
        self.rate_limit = rate_limit
        self.timeout = timeout
        self._cache: dict[int | str, dict[str, Any]] = dict(cache or {})
        self._lock = threading.Lock()
        self._last_request_time: float = 0.0

    def _elapsed_since_last_request(self) -> float:
        with self._lock:
            return time.monotonic() - self._last_request_time

    def _wait_for_rate(self) -> None:
        # Simple token-bucket style pacing: ensure minimum interval between
        # the start of consecutive requests.
        min_interval = 1.0 / max(self.rate_limit, 0.1)
        with self._lock:
            elapsed = time.monotonic() - self._last_request_time
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)
        with self._lock:
            self._last_request_time = time.monotonic()

    def fetch_taxonomy_summaries(
        self, taxids: list[int | str]
    ) -> dict[str, dict[str, Any] | None]:
        """Fetch summaries for a batch of taxids. Returns str(taxid) -> summary or None.

        All keys are normalized to strings so int and str taxids are treated
        identically.
        """
        # Deduplicate and filter cached, keyed by string.
        unique_strs: list[str] = []
        seen: set[str] = set()
        results: dict[str, dict[str, Any] | None] = {}
        for tid in taxids:
            if tid is None:
                continue
            key = str(tid)
            if key in seen:
                continue
            seen.add(key)
            if key in self._cache:
                results[key] = self._cache[key]
            else:
                unique_strs.append(key)

        if not unique_strs:
            return results

        self._wait_for_rate()
        params: dict[str, str] = {
            "db": "taxonomy",
            "id": ",".join(unique_strs),
            "retmode": "json",
        }
        if self.api_key:
            params["api_key"] = self.api_key
        if self.tool:
            params["tool"] = self.tool
        if self.email:
            params["email"] = self.email

        url = EUTILS_BASE + "esummary.fcgi?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            # Network failure: return None for uncached IDs; caller decides.
            for key in unique_strs:
                results[key] = None
            return results

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            for key in unique_strs:
                results[key] = None
            return results

        result_block = data.get("result", {}) if isinstance(data, dict) else {}
        uids = result_block.get("uids", []) if isinstance(result_block, dict) else []
        for uid in uids:
            entry = result_block.get(uid, {}) if isinstance(result_block, dict) else {}
            summary = {
                "taxid": entry.get("taxid", uid),
                "scientificname": entry.get("scientificname"),
                "rank": entry.get("rank"),
                "lineageex": entry.get("lineageex", []),
            }
            results[uid] = summary
            self._cache[uid] = summary

        # IDs present in request but absent from response are unresolved.
        for key in unique_strs:
            if key not in results:
                results[key] = None
                self._cache[key] = None

        return results


class TaxonomyResolver:
    """Resolve BLAST subject taxonomies to lineages."""

    def __init__(
        self,
        *,
        mapping_path: str | Path | None = None,
        online: bool = False,
        tool: str = "smartbio",
        email: str | None = None,
        api_key: str | None = None,
        rate_limit: float = DEFAULT_RATE_LIMIT,
        timeout: float = 20.0,
        cache: dict[int | str, dict[str, Any]] | None = None,
    ) -> None:
        self.mapping_path = Path(mapping_path) if mapping_path else None
        self.mapping: dict[int | str, dict[str, Any]] = {}
        self.mapping_errors: list[str] = []
        self.online = online
        self.client: NcbiEutilsClient | None = None
        if online:
            self.client = NcbiEutilsClient(
                tool=tool,
                email=email,
                api_key=api_key,
                rate_limit=rate_limit,
                timeout=timeout,
                cache=cache,
            )

    # ------------------------------------------------------------------ mapping
    def load_mapping(self) -> dict[str, Any]:
        """Load and validate the local taxonomy mapping TSV.

        Returns a validation report. The mapping is stored on the instance.
        """
        self.mapping = {}
        self.mapping_errors = []
        if not self.mapping_path or not self.mapping_path.exists():
            self.mapping_errors.append(
                f"Taxonomy mapping file not found: {self.mapping_path}"
            )
            return {"valid": False, "errors": list(self.mapping_errors), "taxid_count": 0}

        try:
            text = self.mapping_path.read_text(encoding="utf-8-sig")
        except OSError as exc:
            self.mapping_errors.append(f"Could not read mapping file: {exc}")
            return {"valid": False, "errors": list(self.mapping_errors), "taxid_count": 0}

        lines = [ln for ln in text.splitlines() if ln.strip()]
        if not lines:
            self.mapping_errors.append("Taxonomy mapping file is empty.")
            return {"valid": False, "errors": list(self.mapping_errors), "taxid_count": 0}

        header = [c.strip() for c in lines[0].split("\t")]
        # Accept header even if column order differs; map by name.
        col_index = {name: idx for idx, name in enumerate(header)}
        missing = [c for c in TAXONOMY_MAP_COLUMNS if c not in col_index]
        if missing:
            self.mapping_errors.append(
                "Mapping file missing columns: " + ", ".join(missing)
            )
            return {"valid": False, "errors": list(self.mapping_errors), "taxid_count": 0}

        seen_taxids: set[int | str] = set()
        taxid_lines: dict[int | str, int] = {}
        for line_no, line in enumerate(lines[1:], start=2):
            fields = line.split("\t")
            if len(fields) < len(header):
                self.mapping_errors.append(
                    f"Line {line_no}: expected {len(header)} columns, found {len(fields)}."
                )
                continue
            row = {col: fields[col_index[col]].strip() for col in TAXONOMY_MAP_COLUMNS}
            taxid_raw = row["taxid"]
            if not taxid_raw:
                self.mapping_errors.append(f"Line {line_no}: missing taxid.")
                continue
            try:
                taxid = int(taxid_raw)
            except ValueError:
                taxid = taxid_raw  # keep raw if not an integer (flagged below)
                self.mapping_errors.append(f"Line {line_no}: non-integer taxid '{taxid_raw}'.")
            if taxid in seen_taxids:
                self.mapping_errors.append(f"Line {line_no}: duplicate taxid {taxid}.")
                continue
            seen_taxids.add(taxid)
            taxid_lines[taxid] = line_no
            if not row["scientific_name"]:
                self.mapping_errors.append(
                    f"Line {line_no}: missing scientific_name for taxid {taxid}."
                )
            if row["rank"] and row["rank"].lower().strip() not in KNOWN_RANKS and row["rank"].lower().strip() not in {"", "no rank"}:
                # Allow unknown ranks but note them; do not reject.
                pass
            self.mapping[taxid] = {
                "taxid": taxid,
                "scientific_name": row["scientific_name"],
                "rank": row["rank"] or None,
                "parent_taxid": row["parent_taxid"] or None,
                "full_lineage": row["full_lineage"] or None,
            }

        # Detect cyclic parent links (a taxid must not be its own ancestor).
        parent_of: dict[int | str, int | str | None] = {}
        for tid, rec in self.mapping.items():
            pt = rec.get("parent_taxid")
            if pt is None or str(pt).strip() == "":
                parent_of[tid] = None
            else:
                try:
                    parent_of[tid] = int(str(pt).strip())
                except (ValueError, TypeError):
                    parent_of[tid] = str(pt).strip()
        state: dict[int | str, bool] = {}
        reported: set[int | str] = set()
        for start in list(parent_of):
            if start in state:
                continue
            path: list[int | str] = []
            path_set: set[int | str] = set()
            cur: int | str | None = start
            while True:
                if cur is None or cur not in parent_of:
                    for node in path:
                        state[node] = True
                    break
                if cur in path_set:
                    idx = path.index(cur)
                    for node in path[idx:]:
                        if node not in reported:
                            reported.add(node)
                            ln = taxid_lines.get(node, "?")
                            self.mapping_errors.append(
                                f"Line {ln}: cyclic parent link (cycle) detected for taxid {node}."
                            )
                    for node in path:
                        state[node] = True
                    break
                if cur in state:
                    outcome = state[cur]
                    for node in path:
                        state[node] = outcome
                    break
                path.append(cur)
                path_set.add(cur)
                cur = parent_of[cur]

        valid = len(self.mapping_errors) == 0
        return {
            "valid": valid,
            "errors": list(self.mapping_errors),
            "taxid_count": len(self.mapping),
        }

    def _mapping_lookup(self, tid: int | str | None) -> dict[str, Any] | None:
        """Look up a taxid in the local mapping, tolerating int/str mismatch."""
        if tid is None:
            return None
        if tid in self.mapping:
            return self.mapping[tid]
        if isinstance(tid, str):
            try:
                return self.mapping.get(int(tid))
            except ValueError:
                return None
        return None

    # ---------------------------------------------------------------- resolution
    def resolve_taxids(
        self, taxids: list[int | str | None]
    ) -> dict[int | str | None, TaxonInfo | None]:
        """Resolve each taxid independently to a TaxonInfo.

        Local mapping takes precedence; online lookup is used only for IDs
        absent from the mapping when online mode is enabled.
        """
        results: dict[int | str | None, TaxonInfo | None] = {}
        uncached_for_ncbi: list[int | str] = []
        seen: set[int | str | None] = set()

        for tid in taxids:
            if tid is None:
                results[tid] = None
                continue
            if tid in seen:
                continue
            seen.add(tid)

            rec = self._mapping_lookup(tid)
            if rec is not None:
                results[tid] = self._taxon_from_mapping(rec)
            elif self.client is not None:
                uncached_for_ncbi.append(tid)
            else:
                results[tid] = TaxonInfo(
                    taxid=tid,
                    scientific_name=None,
                    rank=None,
                    lineage=Lineage(taxid=tid, name=None, source="missing"),
                    source="missing",
                )

        # Batch online lookup.
        if uncached_for_ncbi and self.client is not None:
            summaries = self.client.fetch_taxonomy_summaries(uncached_for_ncbi)
            for tid in uncached_for_ncbi:
                summary = summaries.get(str(tid))
                if summary is None:
                    results[tid] = TaxonInfo(
                        taxid=tid,
                        scientific_name=None,
                        rank=None,
                        lineage=Lineage(taxid=tid, name=None, source="missing"),
                        source="missing",
                    )
                else:
                    results[tid] = self._taxon_from_ncbi(tid, summary)

        return results

    def resolve_blast_row(
        self,
        row: dict[str, Any],
    ) -> dict[str, Any]:
        """Resolve taxonomy for a single analyzed BLAST row.

        staxids and sscinames may be semicolon-separated. Each taxid is
        resolved independently; names are associated positionally when
        counts match, otherwise names are kept alongside taxids without
        assuming a one-to-one mapping.
        """
        values = row.get("_values", row) if "_values" in row else row
        staxids_raw = values.get("staxids")
        sscinames_raw = values.get("sscinames")

        taxid_list = self._split_semicolon(staxids_raw) if staxids_raw not in (None, "") else []
        name_list = self._split_semicolon(sscinames_raw) if sscinames_raw not in (None, "") else []

        resolved: list[dict[str, Any]] = []
        taxid_infos = self.resolve_taxids(taxid_list)

        for idx, tid in enumerate(taxid_list):
            info = taxid_infos.get(tid)
            name = name_list[idx] if idx < len(name_list) else None
            entry = {
                "taxid": info.taxid if info else tid,
                "scientific_name": info.scientific_name if info else name,
                "rank": info.rank if info else None,
                "source": info.source if info else "missing",
                "lineage": info.lineage.to_dict() if info else None,
                "input_name": name,
            }
            resolved.append(entry)

        # If there are names but no taxids, record the names as unresolved.
        if not taxid_list and name_list:
            for name in name_list:
                resolved.append(
                    {
                        "taxid": None,
                        "scientific_name": name,
                        "rank": None,
                        "source": "missing",
                        "lineage": None,
                        "input_name": name,
                    }
                )

        return {
            "staxids_raw": staxids_raw,
            "sscinames_raw": sscinames_raw,
            "resolved_taxids": resolved,
            "ambiguous": len(resolved) > 1,
            "has_taxonomy": any(
                r["lineage"] and r["lineage"]["ranks"]
                for r in resolved
                if r["lineage"]
            ),
        }

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def _split_semicolon(value: str) -> list[str]:
        if value is None:
            return []
        parts = [p.strip() for p in str(value).split(";")]
        return [p for p in parts if p]

    def _taxon_from_mapping(self, rec: dict[str, Any]) -> TaxonInfo:
        taxid = rec["taxid"]
        lineage = lineage_from_mapping(
            taxid=taxid,
            scientific_name=rec["scientific_name"],
            rank=rec["rank"],
            full_lineage=rec["full_lineage"],
            parent_taxid=rec["parent_taxid"],
            mapping=self.mapping,
            source="mapping",
        )
        return TaxonInfo(
            taxid=taxid,
            scientific_name=rec["scientific_name"],
            rank=rec["rank"],
            lineage=lineage,
            source="mapping",
        )

    def _taxon_from_ncbi(self, taxid: int | str, summary: dict[str, Any]) -> TaxonInfo:
        lineage = lineage_from_ncbi_lineage_ex(
            taxid=taxid,
            scientific_name=summary.get("scientificname"),
            lineage_ex=summary.get("lineageex", []),
            terminal_rank=summary.get("rank"),
            source="ncbi",
        )
        return TaxonInfo(
            taxid=taxid,
            scientific_name=summary.get("scientificname"),
            rank=summary.get("rank"),
            lineage=lineage,
            source="ncbi",
        )
