from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from smartbio.blast import parse_blast_text, analyze_blast
from smartbio.taxonomy import (
    Lineage,
    TAXONOMIC_RANKS,
    lowest_common_ancestor,
    run_taxonomy_analysis,
    TaxonomyResolver,
    compute_consensus,
    select_candidates,
    report_ambiguity,
)
from smartbio.taxonomy.lineage import (
    lineage_from_mapping,
    lineage_from_ncbi_lineage_ex,
    rank_entry,
)
from smartbio.taxonomy.resolver import TaxonInfo

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "test-cases"


def make_hit(qseqid, sacc, staxids, sscinames, pident, bitscore, evalue=1e-50,
             length=100, qstart=1, qend=100, qlen=100, qcovs=100.0, rank=1):
    return {
        "qseqid": qseqid,
        "sacc": sacc,
        "staxids": staxids,
        "sscinames": sscinames,
        "pident": pident,
        "length": length,
        "qstart": qstart,
        "qend": qend,
        "qlen": qlen,
        "evalue": evalue,
        "bitscore": bitscore,
        "qcovs": qcovs,
        "pass_all": True,
        "rank": rank,
        "query_coverage": qcovs,
    }


# --------------------------------------------------------------------------- lineage
def test_lineage_get_and_deepest():
    lin = Lineage(taxid=562, name="Escherichia coli", source="mapping")
    lin.ranks["species"] = rank_entry(562, "Escherichia coli")
    lin.ranks["genus"] = rank_entry(561, "Escherichia")
    assert lin.rank_name("species") == "Escherichia coli"
    assert lin.rank_name("genus") == "Escherichia"
    assert lin.deepest_classified_rank() == "species"
    assert lin.classified_ranks() == ["genus", "species"]


def test_lineage_to_dict():
    lin = Lineage(taxid=562, name="Escherichia coli", ranks={"species": rank_entry(562, "Escherichia coli")})
    d = lin.to_dict()
    assert d["taxid"] == 562
    assert d["ranks"]["species"]["name"] == "Escherichia coli"


def test_lineage_from_mapping_terminal_rank():
    lin = lineage_from_mapping(
        taxid=562, scientific_name="Escherichia coli", rank="species",
        full_lineage="Bacteria;Proteobacteria;Escherichia;Escherichia coli",
    )
    assert lin.rank_name("species") == "Escherichia coli"
    assert lin.rank_taxid("genus") is None  # partial lineage not split


def test_lineage_from_mapping_parent_walk():
    mapping = {
        562: {"taxid": 562, "scientific_name": "Escherichia coli", "rank": "species", "parent_taxid": 561},
        561: {"taxid": 561, "scientific_name": "Escherichia", "rank": "genus", "parent_taxid": 543},
        543: {"taxid": 543, "scientific_name": "Enterobacteriaceae", "rank": "family", "parent_taxid": None},
    }
    lin = lineage_from_mapping(
        taxid=562, scientific_name="Escherichia coli", rank="species",
        full_lineage=None, parent_taxid=561, mapping=mapping,
    )
    assert lin.rank_name("species") == "Escherichia coli"
    assert lin.rank_taxid("species") == 562
    assert lin.rank_name("genus") == "Escherichia"
    assert lin.rank_taxid("genus") == 561
    assert lin.rank_name("family") == "Enterobacteriaceae"
    assert lin.deepest_classified_rank() == "species"


def test_lineage_from_mapping_terminal_only_without_mapping():
    lin = lineage_from_mapping(
        taxid=562, scientific_name="Escherichia coli", rank="species",
        full_lineage=None,
    )
    assert lin.rank_name("species") == "Escherichia coli"
    assert lin.rank_taxid("genus") is None


def test_lca_agreement():
    lin1 = Lineage(taxid=562, name="E. coli")
    lin1.ranks["genus"] = rank_entry(561, "Escherichia")
    lin1.ranks["species"] = rank_entry(562, "Escherichia coli")
    lin2 = Lineage(taxid=623, name="E. albertii")
    lin2.ranks["genus"] = rank_entry(561, "Escherichia")
    lin2.ranks["species"] = rank_entry(623, "Escherichia albertii")
    lca = lowest_common_ancestor([lin1, lin2])
    assert lca is not None
    assert lca["rank"] == "genus"
    assert lca["taxid"] == 561
    assert lca["name"] == "Escherichia"


def test_lca_no_agreement():
    lin1 = Lineage(taxid=562, name="E. coli")
    lin1.ranks["species"] = rank_entry(562, "Escherichia coli")
    lin2 = Lineage(taxid=1234, name="B. subtilis")
    lin2.ranks["species"] = rank_entry(1234, "Bacillus subtilis")
    lca = lowest_common_ancestor([lin1, lin2])
    assert lca is None


# --------------------------------------------------------------------------- resolver / mapping
def test_mapping_load_valid():
    resolver = TaxonomyResolver(mapping_path=FIXTURES / "taxonomy_map.tsv")
    rep = resolver.load_mapping()
    assert rep["valid"] is True
    assert rep["taxid_count"] > 0
    assert 562 in resolver.mapping
    assert resolver.mapping[562]["scientific_name"] == "Escherichia coli"


def test_mapping_missing_file():
    resolver = TaxonomyResolver(mapping_path=FIXTURES / "does_not_exist.tsv")
    rep = resolver.load_mapping()
    assert rep["valid"] is False
    assert rep["errors"]


def test_mapping_bad_columns(tmp_path):
    bad = tmp_path / "bad.tsv"
    bad.write_text("taxid\tname\n1\tX\n", encoding="utf-8")
    resolver = TaxonomyResolver(mapping_path=bad)
    rep = resolver.load_mapping()
    assert rep["valid"] is False


def test_resolve_single_taxid_from_mapping():
    resolver = TaxonomyResolver(mapping_path=FIXTURES / "taxonomy_map.tsv")
    resolver.load_mapping()
    infos = resolver.resolve_taxids([562])
    info = infos[562]
    assert info.scientific_name == "Escherichia coli"
    assert info.source == "mapping"
    assert info.lineage.rank_name("species") == "Escherichia coli"


def test_resolve_missing_taxid_offline():
    resolver = TaxonomyResolver(mapping_path=FIXTURES / "taxonomy_map.tsv")
    resolver.load_mapping()
    infos = resolver.resolve_taxids([999999])
    info = infos[999999]
    assert info.source == "missing"
    assert info.lineage is not None


def test_resolve_blast_row_single_taxids():
    resolver = TaxonomyResolver(mapping_path=FIXTURES / "taxonomy_map.tsv")
    resolver.load_mapping()
    row = make_hit("q1", "acc1", "562", "Escherichia coli", 99.0, 200)
    res = resolver.resolve_blast_row(row)
    assert res["ambiguous"] is False
    assert res["has_taxonomy"] is True
    assert len(res["resolved_taxids"]) == 1


def test_resolve_blast_row_multiple_taxids():
    resolver = TaxonomyResolver(mapping_path=FIXTURES / "taxonomy_map.tsv")
    resolver.load_mapping()
    row = make_hit("q1", "acc1", "562;623", "Escherichia coli;Escherichia albertii", 99.0, 200)
    res = resolver.resolve_blast_row(row)
    assert res["ambiguous"] is True
    assert len(res["resolved_taxids"]) == 2


def test_resolve_blast_row_names_no_taxids():
    resolver = TaxonomyResolver(mapping_path=FIXTURES / "taxonomy_map.tsv")
    resolver.load_mapping()
    row = make_hit("q1", "acc1", "", "Escherichia coli", 99.0, 200)
    # staxids empty -> names only -> unresolved
    res = resolver.resolve_blast_row(row)
    assert res["has_taxonomy"] is False


# --------------------------------------------------------------------------- consensus
def test_select_candidates_top_n_ties():
    hits = [make_hit("q1", f"acc{i}", "562", "E. coli", 99.0, 200 - i) for i in range(5)]
    # all different bit scores -> top 3
    cands = select_candidates(hits, top_n=3)
    assert len(cands) == 3
    assert cands[0].bitscore == 200

    # ties at cutoff: two hits with same bitscore as the 3rd
    hits2 = [
        make_hit("q1", "a", "562", "x", 99.0, 200),
        make_hit("q1", "b", "562", "x", 99.0, 200),
        make_hit("q1", "c", "562", "x", 99.0, 199),
        make_hit("q1", "d", "562", "x", 99.0, 199),
        make_hit("q1", "e", "562", "x", 99.0, 100),
    ]
    cands2 = select_candidates(hits2, top_n=3)
    # 200,200,199,199 all >= cutoff 199 => 4 candidates
    assert len(cands2) == 4


def test_consensus_species_agreement():
    lin = Lineage(taxid=562, name="Escherichia coli")
    lin.ranks["genus"] = rank_entry(561, "Escherichia")
    lin.ranks["species"] = rank_entry(562, "Escherichia coli")
    cands = [
        _candidate("acc1", 200, lin),
        _candidate("acc2", 190, lin),
    ]
    result = compute_consensus(cands)
    assert result.status == "species_agreement"
    assert result.supported_rank == "species"
    assert result.consensus_taxon == "Escherichia coli"
    assert result.support["unique_species"] == 1
    assert result.support["species_support"] == 1.0


def test_consensus_ambiguous_species_genus_agreement():
    lin_ecoli = Lineage(taxid=562, name="Escherichia coli")
    lin_ecoli.ranks["genus"] = rank_entry(561, "Escherichia")
    lin_ecoli.ranks["species"] = rank_entry(562, "Escherichia coli")
    lin_albertii = Lineage(taxid=623, name="Escherichia albertii")
    lin_albertii.ranks["genus"] = rank_entry(561, "Escherichia")
    lin_albertii.ranks["species"] = rank_entry(623, "Escherichia albertii")
    cands = [_candidate("acc1", 200, lin_ecoli), _candidate("acc2", 190, lin_albertii)]
    result = compute_consensus(cands, min_consensus=0.8)
    assert result.status == "ambiguous_species"
    assert result.supported_rank == "genus"
    assert result.consensus_taxon == "Escherichia"
    assert result.support["unique_species"] == 2
    assert result.support["genus_support"] == 1.0
    assert result.support["species_support"] == 0.5


def test_consensus_higher_rank_only():
    # Two different genera in same family -> family agreement only
    lin_a = Lineage(taxid=1, name="A")
    lin_a.ranks["family"] = rank_entry(10, "FamilyX")
    lin_a.ranks["genus"] = rank_entry(20, "GenusA")
    lin_a.ranks["species"] = rank_entry(100, "SpeciesA")
    lin_b = Lineage(taxid=2, name="B")
    lin_b.ranks["family"] = rank_entry(10, "FamilyX")
    lin_b.ranks["genus"] = rank_entry(30, "GenusB")
    lin_b.ranks["species"] = rank_entry(200, "SpeciesB")
    result = compute_consensus([_candidate("a", 200, lin_a), _candidate("b", 190, lin_b)], min_consensus=0.8)
    assert result.status == "higher_rank_only"
    assert result.supported_rank == "family"
    assert result.support["unique_species"] == 2


def test_consensus_insufficient_evidence():
    result = compute_consensus([])
    assert result.status == "insufficient_evidence"


def test_ambiguity_report_flags():
    result = compute_consensus(
        [_candidate("a", 200, None)],
        min_consensus=0.8,
    )
    rep = report_ambiguity(result, multiple_taxids_per_hit=True, missing_taxids=True)
    assert "multiple_taxids_per_hit" in rep["flags"]
    assert "missing_taxids" in rep["flags"]
    assert rep["status"] == "insufficient_evidence"


def _candidate(accession, bitscore, lineage):
    from smartbio.taxonomy.consensus import Candidate
    return Candidate(
        accession=accession,
        bitscore=bitscore,
        evalue=1e-50,
        pident=99.0,
        query_coverage=100.0,
        rank=1,
        lineage=lineage,
    )


# --------------------------------------------------------------------------- end-to-end analysis
def test_run_taxonomy_analysis_end_to_end():
    tsv = (FIXTURES / "blast_taxonomy.tsv").read_text(encoding="utf-8-sig")
    parsed = parse_blast_text(tsv, schema="blastn_local_v1")
    report = analyze_blast(parsed, query_ids=["q1", "q2", "q3"])

    resolver = TaxonomyResolver(mapping_path=FIXTURES / "taxonomy_map.tsv")
    resolver.load_mapping()

    analysis = run_taxonomy_analysis(report, resolver, top_n=10, min_consensus=0.8)

    assert analysis["summary"]["queries_without_hits"] == 1
    assert "q3" in analysis["no_hit_queries"]
    assert analysis["no_hit_queries"]["q3"]["consensus"]["status"] == "insufficient_evidence"

    q1 = analysis["per_query"]["q1"]
    assert q1["consensus"]["status"] == "ambiguous_species"
    assert q1["consensus"]["supported_rank"] == "genus"
    assert q1["consensus"]["consensus_taxon"] == "Escherichia"

    q2 = analysis["per_query"]["q2"]
    assert q2["consensus"]["status"] == "species_agreement"
    assert q2["consensus"]["consensus_taxon"] == "Bacillus subtilis"


def test_unique_species_not_dominated_by_accessions():
    """Many accessions from one species must not outweigh a single different species.

    9 accessions of Escherichia coli vs 1 accession of Escherichia albertii:
    raw hit count would suggest 90% E. coli, but unique-species support gives
    50% for each species because consensus is computed over unique species.
    """
    lin_ecoli = Lineage(taxid=562, name="Escherichia coli")
    lin_ecoli.ranks["genus"] = rank_entry(561, "Escherichia")
    lin_ecoli.ranks["species"] = rank_entry(562, "Escherichia coli")
    lin_albertii = Lineage(taxid=623, name="Escherichia albertii")
    lin_albertii.ranks["genus"] = rank_entry(561, "Escherichia")
    lin_albertii.ranks["species"] = rank_entry(623, "Escherichia albertii")
    # 9 accessions E. coli, 1 accession E. albertii (same genus, different species)
    cands = [_candidate(f"acc_ec{i}", 200 - i, lin_ecoli) for i in range(9)]
    cands.append(_candidate("acc_alb", 100, lin_albertii))
    result = compute_consensus(cands)
    # unique_species = 2; species_support = max(1,1)/2 = 0.5, NOT 0.9
    assert result.support["unique_species"] == 2
    assert result.support["reference_hits"] == 10
    assert result.support["species_support"] == 0.5
    assert result.support["genus_support"] == 1.0
    assert result.status == "ambiguous_species"


def test_report_ambiguity_structure():
    result = compute_consensus([_candidate("a", 200, None)])
    rep = report_ambiguity(result)
    assert "status" in rep
    assert "flags" in rep
    assert "messages" in rep
    assert "support" in rep


def test_taxon_info_to_dict():
    info = TaxonInfo(taxid=562, scientific_name="E. coli", rank="species",
                     lineage=Lineage(taxid=562, name="E. coli"), source="mapping")
    d = info.to_dict()
    assert d["taxid"] == 562
    assert d["source"] == "mapping"
