"""Mocked NCBI E-utilities tests. No internet access is required."""

from pathlib import Path
import json
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from smartbio.taxonomy.resolver import (
    NcbiEutilsClient,
    TaxonomyResolver,
    TaxonInfo,
)
from smartbio.taxonomy.lineage import Lineage

ESUMMARY_RESPONSE = {
    "result": {
        "uids": ["562", "623"],
        "562": {
            "taxid": 562,
            "scientificname": "Escherichia coli",
            "rank": "species",
            "lineageex": [
                {"TaxId": 2, "ScientificName": "Bacteria", "Rank": "superkingdom"},
                {"TaxId": 1224, "ScientificName": "Proteobacteria", "Rank": "phylum"},
                {"TaxId": 91347, "ScientificName": "Enterobacterales", "Rank": "order"},
                {"TaxId": 543, "ScientificName": "Enterobacteriaceae", "Rank": "family"},
                {"TaxId": 561, "ScientificName": "Escherichia", "Rank": "genus"},
            ],
        },
        "623": {
            "taxid": 623,
            "scientificname": "Escherichia albertii",
            "rank": "species",
            "lineageex": [
                {"TaxId": 2, "ScientificName": "Bacteria", "Rank": "superkingdom"},
                {"TaxId": 1224, "ScientificName": "Proteobacteria", "Rank": "phylum"},
                {"TaxId": 561, "ScientificName": "Escherichia", "Rank": "genus"},
            ],
        },
    }
}


class FakeResponse:
    def __init__(self, body, status=200):
        self.body = body
        self.status = status

    def read(self):
        return self.body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_client_batch_dedup_and_cache(monkeypatch):
    calls = []

    def fake_urlopen(url, timeout=None):
        calls.append(url)
        return FakeResponse(json.dumps(ESUMMARY_RESPONSE))

    import smartbio.taxonomy.resolver as res_mod
    monkeypatch.setattr(res_mod.urllib.request, "urlopen", fake_urlopen)

    client = NcbiEutilsClient(rate_limit=1000.0, cache={})
    # First call for [562, 623, 562] -> deduplicated to [562, 623], one request.
    out = client.fetch_taxonomy_summaries([562, 623, 562])
    assert "562" in out and "623" in out
    assert out["562"]["scientificname"] == "Escherichia coli"
    assert len(calls) == 1  # one batched request

    # Second call for already-cached 562 -> no network request.
    out2 = client.fetch_taxonomy_summaries([562])
    assert len(calls) == 1  # still one request
    assert out2["562"]["scientificname"] == "Escherichia coli"


def test_client_network_failure_returns_none(monkeypatch):
    def boom(url, timeout=None):
        raise OSError("network down")

    import smartbio.taxonomy.resolver as res_mod
    monkeypatch.setattr(res_mod.urllib.request, "urlopen", boom)

    client = NcbiEutilsClient(rate_limit=1000.0, cache={})
    out = client.fetch_taxonomy_summaries([562])
    assert out["562"] is None


def test_resolver_online_uses_ncbi_when_mapping_misses(monkeypatch):
    def fake_urlopen(url, timeout=None):
        return FakeResponse(json.dumps(ESUMMARY_RESPONSE))

    import smartbio.taxonomy.resolver as res_mod
    monkeypatch.setattr(res_mod.urllib.request, "urlopen", fake_urlopen)

    resolver = TaxonomyResolver(
        mapping_path=Path(__file__).resolve().parents[2]
        / "shared" / "test-cases" / "taxonomy_map.tsv",
        online=True,
        rate_limit=1000.0,
    )
    resolver.load_mapping()
    # 999999 not in mapping -> online lookup
    infos = resolver.resolve_taxids([999999])  # not in esummary either -> missing
    assert infos[999999].source == "missing"

    # 562 is in mapping -> mapping takes precedence, no online call needed
    infos2 = resolver.resolve_taxids([562])
    assert infos2[562].source == "mapping"


def test_resolve_blast_row_online_lineage(monkeypatch):
    def fake_urlopen(url, timeout=None):
        return FakeResponse(json.dumps(ESUMMARY_RESPONSE))

    import smartbio.taxonomy.resolver as res_mod
    monkeypatch.setattr(res_mod.urllib.request, "urlopen", fake_urlopen)

    resolver = TaxonomyResolver(online=True, rate_limit=1000.0)
    # empty mapping path
    row = {
        "qseqid": "q1",
        "sacc": "acc1",
        "staxids": "562",
        "sscinames": "Escherichia coli",
        "pident": 99.0,
        "bitscore": 200,
        "evalue": 1e-50,
        "length": 100,
        "qstart": 1,
        "qend": 100,
        "qlen": 100,
        "qcovs": 100.0,
        "pass_all": True,
        "rank": 1,
    }
    res = resolver.resolve_blast_row(row)
    assert res["has_taxonomy"] is True
    assert res["resolved_taxids"][0]["lineage"]["ranks"]["genus"]["name"] == "Escherichia"
    assert res["resolved_taxids"][0]["source"] == "ncbi"
