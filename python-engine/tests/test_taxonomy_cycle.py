from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from smartbio.taxonomy.resolver import TaxonomyResolver


def test_mapping_cycle_rejected(tmp_path):
    cyc = tmp_path / "cycle.tsv"
    cyc.write_text(
        "taxid\tscientific_name\trank\tparent_taxid\tfull_lineage\n"
        "1\tA\tspecies\t2\tA\n"
        "2\tB\tgenus\t1\tB\n",
        encoding="utf-8",
    )
    resolver = TaxonomyResolver(mapping_path=cyc)
    rep = resolver.load_mapping()
    assert rep["valid"] is False
    assert any("cycle" in e.lower() for e in rep["errors"])
