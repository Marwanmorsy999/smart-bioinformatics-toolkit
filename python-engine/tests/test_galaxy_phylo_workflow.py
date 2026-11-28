"""M7.3 scientific reference tests for the Galaxy phylogenetics workflow.

Use an INDEPENDENT reference implementation (a small Newick parser written
here, not the Worker's validator) to check the expected clades of a curated
dataset. These tests never contact Galaxy and never fabricate a remote run.
"""
import json
from pathlib import Path

from smartbio.fasta import parse_fasta_file

REPO = Path(__file__).resolve().parents[2]
REF_DIR = REPO / "shared" / "test-cases" / "phylo_reference"
FASTA = REF_DIR / "reference.fasta"
TOPOLOGY = REF_DIR / "expected_topology.json"


def parse_newick(text):
    s = text.strip()
    pos = 0

    def node():
        nonlocal pos
        result = {"name": "", "children": []}
        if s[pos] == "(":
            pos += 1
            while pos < len(s) and s[pos] != ")":
                result["children"].append(node())
                if pos < len(s) and s[pos] == ",":
                    pos += 1
            pos += 1
        start = pos
        while pos < len(s) and s[pos] not in "(),:;":
            pos += 1
        result["name"] = s[start:pos].strip()
        if pos < len(s) and s[pos] == ":":
            pos += 1
            while pos < len(s) and (s[pos].isdigit() or s[pos] in ".eE+-"):
                pos += 1
        return result

    tree = node()
    return tree


def clades(root):
    out = []

    def walk(n):
        if not n["children"]:
            return [n["name"]]
        labels = []
        for child in n["children"]:
            labels.extend(walk(child))
        out.append(sorted(labels))
        return labels

    walk(root)
    return {tuple(c) for c in out}


def test_reference_records_are_all_present_and_valid():
    parsed = parse_fasta_file(FASTA)
    expected = json.loads(TOPOLOGY.read_text(encoding="utf-8"))
    records = parsed["records"] if isinstance(parsed, dict) else parsed
    assert not parsed.get("errors") if isinstance(parsed, dict) else True
    assert len(records) == len(expected["expected_taxa"])
    assert {r["id"] if isinstance(r, dict) else r.name for r in records} == set(expected["expected_taxa"])
    seqs = [r["sequence"] if isinstance(r, dict) else r.sequence for r in records]
    assert {len(s) for s in seqs} == {60}
    assert all(set(s.upper()) <= set("ACGT") for s in seqs)


def test_expected_clades_are_recoverable_by_independent_parser():
    expected = json.loads(TOPOLOGY.read_text(encoding="utf-8"))
    tree = parse_newick(expected["example_newick"])
    found = clades(tree)
    for clade in expected["expected_clades"]:
        assert tuple(sorted(clade)) in found
    assert tuple(sorted(expected["expected_taxa"])) in found


def test_workflow_does_not_silently_drop_taxa():
    expected = json.loads(TOPOLOGY.read_text(encoding="utf-8"))
    tree = parse_newick(expected["example_newick"])
    found = clades(tree)
    leaves = {name for clade in found for name in clade}
    assert leaves == set(expected["expected_taxa"])


def test_reference_documented_limitations_are_present():
    expected = json.loads(TOPOLOGY.read_text(encoding="utf-8"))
    assert expected["limitations"]
    assert any("publication" in item.lower() or "bootstrap" in item.lower() for item in expected["limitations"])
