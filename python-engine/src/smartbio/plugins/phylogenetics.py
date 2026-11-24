"""Real, local phylogenetics adapters built on Biopython.

The pipeline is: validate -> progressive MSA -> neighbour joining -> report.
Every value in the artifacts is computed from the supplied FASTA by Biopython
(``Bio.Align.PairwiseAligner``, ``Bio.Phylo.TreeConstruction``, ``Bio.AlignIO``
and ``Bio.Phylo``), or by the existing ``smartbio.fasta`` parsers. No tool is
stubbed and no result is canned: invalid input fails closed.

The alignment uses a deterministic progressive/profile scheme:

1. Pairwise global identities from ``PairwiseAligner`` become p-distances.
2. ``DistanceTreeConstructor.upgma`` builds the guide tree from those distances.
3. Child profiles are merged by aligning their consensus strings with the same
   ``PairwiseAligner``; gaps from each consensus alignment are projected back
   onto every row of the corresponding profile.

Scoring (documented in the manifest and in docs/plugins/PHYLOGENETICS_TOOLING.md):
match +2, mismatch -1, gap open -5, gap extend -2, and the same penalties for
terminal gaps so that end gaps are not free. All scores are fixed constants;
there is no randomness and no external process or network access.
"""

from __future__ import annotations

import hashlib
import html
import json
from io import StringIO
from typing import Any

import Bio
from Bio import AlignIO, Phylo
from Bio.Align import MultipleSeqAlignment, PairwiseAligner
from Bio.Phylo.TreeConstruction import (
    DistanceCalculator,
    DistanceMatrix,
    DistanceTreeConstructor,
)
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord

from smartbio.fasta import parse_fasta_file, validate_records
from smartbio.plugins import failure_result, json_artifact, text_artifact, write_input

_TOOL_VERSION = "1.0.0"
_MIN_SEQUENCES = 3
_MIN_LENGTH = 50
_MATCH_SCORE = 2.0
_MISMATCH_SCORE = -1.0
_OPEN_GAP_SCORE = -5.0
_EXTEND_GAP_SCORE = -2.0

_QC_LIMITATIONS = [
    "Validation accepts the IUPAC DNA alphabet; ambiguous bases are not resolved into a single nucleotide.",
    "Length and alphabet checks cannot assess sequencing quality or contamination.",
]
_ALIGNMENT_LIMITATIONS = [
    "Progressive multiple sequence alignment is a heuristic and does not guarantee a global optimum.",
    "The guide tree depends on the fixed scoring scheme; alternative scores may produce a different alignment.",
    "Conserved columns are counted only where every sequence shares the same non-gap residue.",
]
_TREE_LIMITATIONS = [
    "Neighbour joining is a distance-based heuristic, not a maximum-likelihood or Bayesian inference.",
    "The identity distance model ignores substitution saturation and rate variation.",
    "An unrooted NJ tree is stored with a trifurcating root; internal branches are hypotheses, not proof of ancestry.",
]
_REPORT_LIMITATIONS = [
    "This report is for research use only and is not a clinical or diagnostic result.",
    "Artifact hashes cover the artifacts bundled in this report, not the source FASTA itself.",
] + _ALIGNMENT_LIMITATIONS[:1] + _TREE_LIMITATIONS[:1]

REFERENCES = [
    {
        "key": "cock2009_biopython",
        "title": "Biopython: freely available Python tools for computational molecular biology and bioinformatics",
        "url": "https://doi.org/10.1093/bioinformatics/btp163",
        "verified": True,
    },
    {
        "key": "saitou1987_neighbor_joining",
        "title": "The neighbor-joining method: a new method for reconstructing phylogenetic trees",
        "url": "https://doi.org/10.1093/oxfordjournals.molbev.a040454",
        "verified": True,
    },
    {
        "key": "thompson1994_clustalw",
        "title": "CLUSTAL W: improving the sensitivity of progressive multiple sequence alignment",
        "url": "https://doi.org/10.1093/nar/22.22.4673",
        "verified": True,
    },
]


def _aligner() -> PairwiseAligner:
    """Return a fresh, fully specified deterministic global aligner."""
    aligner = PairwiseAligner()
    aligner.mode = "global"
    aligner.match_score = _MATCH_SCORE
    aligner.mismatch_score = _MISMATCH_SCORE
    aligner.open_gap_score = _OPEN_GAP_SCORE
    aligner.extend_gap_score = _EXTEND_GAP_SCORE
    aligner.open_end_gap_score = _OPEN_GAP_SCORE
    aligner.extend_end_gap_score = _EXTEND_GAP_SCORE
    return aligner


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _fasta_text(inputs: dict[str, Any]) -> str | None:
    value = inputs.get("fasta_text")
    if isinstance(value, str) and value.strip():
        return value
    return None


def _prepare_sequences(
    inputs: dict[str, Any], context: dict[str, Any]
) -> tuple[dict[str, Any] | None, str | None]:
    """Stage the FASTA and enforce the phylogenetics QC gates with smartbio."""
    text = _fasta_text(inputs)
    if text is None:
        return None, "No FASTA text was provided in job inputs."
    try:
        path = write_input(context["workspace"], "phylo_input.fasta", text)
    except (ValueError, OSError) as exc:
        return None, f"Could not stage FASTA input: {exc}"
    try:
        parsed = parse_fasta_file(path)
        validation = validate_records(parsed, "dna")
    except (ValueError, OSError, RuntimeError) as exc:
        return None, f"FASTA validation failed: {exc}"

    records = [record for record in validation["records"] if record["valid"]]
    problems: list[str] = []
    if not validation["file_valid"]:
        problems.append("FASTA structure or alphabet validation failed.")
    if len(records) < _MIN_SEQUENCES:
        problems.append(
            f"At least {_MIN_SEQUENCES} valid DNA sequences are required; "
            f"{len(records)} were found."
        )
    if any(record["length"] < _MIN_LENGTH for record in records):
        problems.append(f"Every sequence must be at least {_MIN_LENGTH} bp.")
    if len({record["id"] for record in records}) != len(records):
        problems.append("Sequence identifiers must be unique.")
    if problems:
        return None, " ".join(problems)

    return {
        "text": text,
        "path": path,
        "validation": validation,
        "records": records,
        "input_sha256": _sha256(text),
        "filename": inputs.get("filename") or path.name,
    }, None


def _validation_document(prepared: dict[str, Any]) -> dict[str, Any]:
    lengths = [record["length"] for record in prepared["records"]]
    return {
        "tool": "Smart Bioinformatics Toolkit",
        "tool_version": _TOOL_VERSION,
        "input_file": prepared["filename"],
        "input_sha256": prepared["input_sha256"],
        "sequence_type": "dna",
        "fasta_validation": prepared["validation"],
        "sequence_count": len(lengths),
        "min_length_bp": min(lengths),
        "max_length_bp": max(lengths),
        "min_required_sequences": _MIN_SEQUENCES,
        "min_required_length_bp": _MIN_LENGTH,
        "requirements_met": True,
        "notes": list(_QC_LIMITATIONS),
    }


def _identity_distance(left: str, right: str, aligner: PairwiseAligner) -> float:
    """p-distance from an actual global pairwise alignment."""
    alignment = aligner.align(left, right)[0]
    aligned_left, aligned_right = alignment[0], alignment[1]
    comparable = [
        (a, b)
        for a, b in zip(aligned_left, aligned_right)
        if a != "-" and b != "-"
    ]
    if not comparable:
        return 1.0
    identities = sum(1 for a, b in comparable if a == b)
    return round(1.0 - identities / len(comparable), 10)


def _guide_tree(records: list[dict[str, Any]]) -> Any:
    names = [record["id"] for record in records]
    aligner = _aligner()
    lower = [
        [
            _identity_distance(
                records[i]["sequence"], records[j]["sequence"], aligner
            )
            for j in range(i + 1)
        ]
        for i in range(len(records))
    ]
    return DistanceTreeConstructor().upgma(DistanceMatrix(names, lower))


def _consensus(rows: list[str]) -> str:
    """Column-wise majority residue; ties break by alphabetical order."""
    if not rows:
        return ""
    columns: list[str] = []
    for column in zip(*rows):
        counts: dict[str, int] = {}
        for symbol in column:
            if symbol != "-":
                counts[symbol] = counts.get(symbol, 0) + 1
        if not counts:
            columns.append("-")
            continue
        best = max(counts.values())
        columns.append(sorted(symbol for symbol, count in counts.items() if count == best)[0])
    return "".join(columns)


def _merge_profiles(
    left_rows: list[str], right_rows: list[str], aligner: PairwiseAligner
) -> list[str]:
    """Profile merge driven by a real pairwise alignment of the two consensuses."""
    alignment = aligner.align(_consensus(left_rows), _consensus(right_rows))[0]
    aligned_left, aligned_right = alignment[0], alignment[1]
    merged_left: list[list[str]] = [[] for _ in left_rows]
    merged_right: list[list[str]] = [[] for _ in right_rows]
    left_index = right_index = 0
    for symbol_left, symbol_right in zip(aligned_left, aligned_right):
        if symbol_left == "-" and symbol_right == "-":
            continue
        if symbol_left == "-":
            for columns in merged_left:
                columns.append("-")
            for columns, row in zip(merged_right, right_rows):
                columns.append(row[right_index])
            right_index += 1
        elif symbol_right == "-":
            for columns, row in zip(merged_left, left_rows):
                columns.append(row[left_index])
            for columns in merged_right:
                columns.append("-")
            left_index += 1
        else:
            for columns, row in zip(merged_left, left_rows):
                columns.append(row[left_index])
            for columns, row in zip(merged_right, right_rows):
                columns.append(row[right_index])
            left_index += 1
            right_index += 1
    if left_index != len(left_rows[0]) or right_index != len(right_rows[0]):
        raise ValueError("Profile merge did not consume every input column.")
    return ["".join(columns) for columns in merged_left] + [
        "".join(columns) for columns in merged_right
    ]


def _progressive_alignment(
    records: list[dict[str, Any]],
) -> tuple[MultipleSeqAlignment, dict[str, Any], Any]:
    guide = _guide_tree(records)
    aligner = _aligner()
    leaves = {record["id"]: record["sequence"] for record in records}

    def build(clade: Any) -> list[str]:
        if clade.is_terminal():
            return [leaves[clade.name]]
        children = list(clade.clades)
        if not children:
            raise ValueError("Guide tree contains an internal node without children.")
        rows = build(children[0])
        for child in children[1:]:
            rows = _merge_profiles(rows, build(child), aligner)
        return rows

    rows = build(guide.root)
    ids: list[str] = []

    def collect(clade: Any) -> None:
        if clade.is_terminal():
            ids.append(clade.name)
        else:
            for child in clade.clades:
                collect(child)

    collect(guide.root)
    if set(ids) != set(leaves) or len(ids) != len(leaves):
        raise ValueError("Guide tree traversal lost or duplicated a sequence.")
    by_id = dict(zip(ids, rows))
    ordered_ids = [record["id"] for record in records]
    msa = MultipleSeqAlignment(
        [
            SeqRecord(
                Seq(by_id[name]), id=name, name=name, description=name
            )
            for name in ordered_ids
        ]
    )
    columns = list(zip(*(str(record.seq) for record in msa)))
    conserved = sum(1 for column in columns if len(set(column)) == 1 and column[0] != "-")
    gaps = sum(row.count("-") for row in (str(record.seq) for record in msa))
    guide_handle = StringIO()
    Phylo.write(guide, guide_handle, "newick")
    summary = {
        "tool": "Smart Bioinformatics Toolkit",
        "tool_version": _TOOL_VERSION,
        "biopython_version": Bio.__version__,
        "method": "deterministic progressive profile alignment",
        "sequence_count": len(ordered_ids),
        "alignment_columns": len(columns),
        "conserved_sites": conserved,
        "variable_sites": len(columns) - conserved,
        "gap_count": gaps,
        "scoring": {
            "match": _MATCH_SCORE,
            "mismatch": _MISMATCH_SCORE,
            "gap_open": _OPEN_GAP_SCORE,
            "gap_extend": _EXTEND_GAP_SCORE,
            "mode": "global",
        },
        "guide_tree_method": "UPGMA on pairwise identity p-distances",
        "guide_tree_newick": guide_handle.getvalue().strip(),
        "notes": list(_ALIGNMENT_LIMITATIONS),
    }
    return msa, summary, guide


def _alignment_fasta(msa: MultipleSeqAlignment) -> str:
    handle = StringIO()
    AlignIO.write(msa, handle, "fasta")
    return handle.getvalue()


def _msa_from_text(text: str) -> MultipleSeqAlignment:
    handle = StringIO(text)
    msa = AlignIO.read(handle, "fasta")
    if len(msa) < _MIN_SEQUENCES:
        raise ValueError("An alignment needs at least three sequences.")
    widths = {len(record.seq) for record in msa}
    if len(widths) != 1:
        raise ValueError("Aligned sequences must all have the same length.")
    return msa


def _distance_matrix(msa: MultipleSeqAlignment) -> DistanceMatrix:
    calculator = DistanceCalculator("identity")
    compute = getattr(calculator, "get_distance", None) or calculator.compute_distances
    return compute(msa)


def _newick(tree: Any) -> str:
    handle = StringIO()
    Phylo.write(tree, handle, "newick")
    return handle.getvalue().strip()


def _tree_svg(tree: Any) -> str:
    """Deterministic rectangular SVG drawn from the computed tree."""
    tips = list(tree.get_terminals())
    y_positions = {clade.name: 30 + index * 26 for index, clade in enumerate(tips)}
    depths: dict[int, int] = {}
    parents: dict[int, Any] = {}

    def assign(clade: Any, depth: int) -> None:
        depths[id(clade)] = depth
        for child in clade.clades:
            parents[id(child)] = clade
            assign(child, depth + 1)

    assign(tree.root, 0)

    def y_of(clade: Any) -> float:
        if clade.is_terminal():
            return float(y_positions[clade.name])
        children = [y_of(child) for child in clade.clades]
        return sum(children) / len(children)

    def x_of(depth: int) -> int:
        return 30 + depth * 110

    lines: list[str] = []
    for clade in tree.find_clades():
        x = x_of(depths[id(clade)])
        y = y_of(clade)
        if clade is not tree.root:
            parent_x = x_of(depths[id(parents[id(clade)])])
            lines.append(
                f'    <line x1="{parent_x}" y1="{y:.1f}" x2="{x}" y2="{y:.1f}" '
                'stroke="#333"/>'
            )
        if not clade.is_terminal():
            children_y = [y_of(child) for child in clade.clades]
            lines.append(
                f'    <line x1="{x}" y1="{min(children_y):.1f}" x2="{x}" '
                f'y2="{max(children_y):.1f}" stroke="#333"/>'
            )
        else:
            label = html.escape(str(clade.name or ""))
            lines.append(
                f'    <text x="{x + 6}" y="{y + 4:.1f}" font-family="monospace" '
                f'font-size="12">{label}</text>'
            )
    width = x_of(max(depths.values())) + 160
    height = 30 + len(tips) * 26 + 20
    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}">',
            '  <rect width="100%" height="100%" fill="white"/>',
            *lines,
            "</svg>",
        ]
    ) + "\n"


def _tree_stats(tree: Any, newick: str, msa: MultipleSeqAlignment, dm: DistanceMatrix) -> dict[str, Any]:
    tips = [clade.name for clade in tree.get_terminals()]
    internals = [clade for clade in tree.get_nonterminals()]
    branches = [
        clade.branch_length if clade.branch_length is not None else 0.0
        for clade in tree.find_clades()
    ]
    bipartitions = []
    for clade in internals:
        clade_tips = sorted(leaf.name for leaf in clade.get_terminals())
        if len(clade_tips) >= 2:
            bipartitions.append(clade_tips)
    matrix = [
        [float(dm[i, j]) for j in range(i + 1)] for i in range(len(dm.names))
    ]
    return {
        "tool": "Smart Bioinformatics Toolkit",
        "tool_version": _TOOL_VERSION,
        "biopython_version": Bio.__version__,
        "method": "neighbor joining on identity distances (Biopython)",
        "tip_count": len(tips),
        "tip_names": sorted(tips),
        "internal_node_count": len(internals),
        "total_branch_length": round(sum(branches), 10),
        "max_branch_length": round(max(branches), 10),
        "min_branch_length": round(min(branches), 10),
        "newick_length": len(newick),
        "newick": newick,
        "alignment_columns": len(msa[0]),
        "distance_matrix_names": list(dm.names),
        "distance_matrix_lower_triangle": matrix,
        "bipartitions": bipartitions,
        "notes": list(_TREE_LIMITATIONS),
    }


def _check_tree(tree: Any, msa: MultipleSeqAlignment, newick: str) -> None:
    tips = [clade.name for clade in tree.get_terminals()]
    expected = [record.id for record in msa]
    if len(tips) != len(expected) or set(tips) != set(expected):
        raise ValueError("Tree tips do not exactly match the input sequence IDs.")
    for clade in tree.find_clades():
        if clade.branch_length is not None and clade.branch_length < 0:
            raise ValueError("Tree contains a negative branch length.")
    for clade in tree.get_nonterminals():
        if clade is tree.root and len(clade.clades) == 3:
            continue  # unrooted NJ representation
        if len(clade.clades) != 2:
            raise ValueError("Tree is not bifurcating where expected.")
    round_trip = Phylo.read(StringIO(newick), "newick")
    if len(list(round_trip.get_terminals())) != len(expected):
        raise ValueError("Newick round-trip changed the number of tips.")


def _evidence(items: list[tuple[str, str, str]]) -> list[dict[str, str]]:
    """Build framework-compatible evidence hints.

    ``text`` is the documented shape; ``text_template`` is the alias consumed
    by the plugin-agnostic explanation seam. Both carry the same template so
    only the cited field value is ever interpolated into the prose.
    """
    return [
        {
            "text": text,
            "text_template": text,
            "artifact": artifact,
            "field_path": field_path,
        }
        for text, artifact, field_path in items
    ]


def _meta(
    adapter: Any,
    *,
    functions: tuple[str, ...],
    artifacts: list[dict[str, Any]],
    limitations: list[str],
    evidence: list[dict[str, str]],
    required: list[str],
    parameters: dict[str, Any] | None = None,
    input_file: str | None = None,
) -> dict[str, Any]:
    return {
        "status": "succeeded",
        "tool_id": adapter.TOOL_ID,
        "version": adapter.VERSION,
        "execution_mode": "real",
        "functions": list(functions),
        "parameters": parameters or {},
        "input_file": input_file,
        "artifact_names": [artifact["name"] for artifact in artifacts],
        "limitations": list(limitations),
        "logs": [],
        "evidence_hints": evidence,
        "required_artifacts": list(required),
    }


class _BasePhylogeneticsAdapter:
    VERSION = _TOOL_VERSION
    _functions: tuple[str, ...] = ()
    _limitations: list[str] = []

    def _prepare_or_fail(
        self, inputs: dict[str, Any], context: dict[str, Any]
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        prepared, reason = _prepare_sequences(inputs, context)
        if reason is not None:
            return None, failure_result(
                self, reason, limitations=self._limitations
            )
        return prepared, None


class PhylogeneticsValidatePlugin(_BasePhylogeneticsAdapter):
    TOOL_ID = "phylogenetics.validate"
    _functions = ("smartbio.fasta.parse_fasta_file", "smartbio.fasta.validate_records")
    _limitations = _QC_LIMITATIONS

    def run(
        self, step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        prepared, failed = self._prepare_or_fail(inputs, context)
        if failed is not None:
            return failed
        document = _validation_document(prepared)
        artifacts = [json_artifact("phylo_validation.json", document)]
        meta = _meta(
            self,
            functions=self._functions,
            artifacts=artifacts,
            limitations=self._limitations,
            evidence=_evidence(
                [
                    (
                        "Validation accepted {value} DNA sequences for phylogenetic analysis.",
                        "phylo_validation.json",
                        "sequence_count",
                    ),
                    (
                        "The shortest accepted sequence is {value} base pairs.",
                        "phylo_validation.json",
                        "min_length_bp",
                    ),
                ]
            ),
            required=["phylo_validation.json"],
            parameters={"sequence_type": "dna"},
            input_file=prepared["filename"],
        )
        return {"artifacts": artifacts, "tool_run_meta": meta}


class PhylogeneticsAlignPlugin(_BasePhylogeneticsAdapter):
    TOOL_ID = "phylogenetics.align"
    _functions = (
        "smartbio.fasta.parse_fasta_file",
        "smartbio.fasta.validate_records",
        "Bio.Align.PairwiseAligner",
        "Bio.Phylo.TreeConstruction.DistanceTreeConstructor",
        "Bio.AlignIO.write",
    )
    _limitations = _ALIGNMENT_LIMITATIONS

    def run(
        self, step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        prepared, failed = self._prepare_or_fail(inputs, context)
        if failed is not None:
            return failed
        try:
            msa, summary, _ = _progressive_alignment(prepared["records"])
            alignment_text = _alignment_fasta(msa)
        except (ValueError, RuntimeError) as exc:
            return failure_result(
                self, f"Progressive alignment failed: {exc}", limitations=self._limitations
            )
        artifacts = [
            text_artifact("alignment.fasta", alignment_text, "fasta"),
            json_artifact("alignment_summary.json", summary),
        ]
        meta = _meta(
            self,
            functions=self._functions,
            artifacts=artifacts,
            limitations=self._limitations,
            evidence=_evidence(
                [
                    (
                        "The multiple sequence alignment spans {value} columns.",
                        "alignment_summary.json",
                        "alignment_columns",
                    ),
                    (
                        "The alignment contains {value} conserved sites.",
                        "alignment_summary.json",
                        "conserved_sites",
                    ),
                    (
                        "The alignment contains {value} gap characters.",
                        "alignment_summary.json",
                        "gap_count",
                    ),
                ]
            ),
            required=["alignment.fasta", "alignment_summary.json"],
            parameters={
                "mode": "global",
                "match": _MATCH_SCORE,
                "mismatch": _MISMATCH_SCORE,
                "gap_open": _OPEN_GAP_SCORE,
                "gap_extend": _EXTEND_GAP_SCORE,
            },
            input_file=prepared["filename"],
        )
        return {"artifacts": artifacts, "tool_run_meta": meta}


class PhylogeneticsTreePlugin(_BasePhylogeneticsAdapter):
    TOOL_ID = "phylogenetics.tree"
    _functions = (
        "Bio.AlignIO.read",
        "Bio.Phylo.TreeConstruction.DistanceCalculator",
        "Bio.Phylo.TreeConstruction.DistanceTreeConstructor",
        "Bio.Phylo.write",
    )
    _limitations = _TREE_LIMITATIONS

    def run(
        self, step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        alignment_text = inputs.get("alignment_text")
        if isinstance(alignment_text, str) and alignment_text.strip():
            try:
                msa = _msa_from_text(alignment_text)
            except (ValueError, RuntimeError) as exc:
                return failure_result(
                    self, f"Alignment input is invalid: {exc}", limitations=self._limitations
                )
            input_file = "alignment_text"
        else:
            prepared, failed = self._prepare_or_fail(inputs, context)
            if failed is not None:
                return failed
            try:
                msa, _, _ = _progressive_alignment(prepared["records"])
            except (ValueError, RuntimeError) as exc:
                return failure_result(
                    self, f"Progressive alignment failed: {exc}", limitations=self._limitations
                )
            input_file = prepared["filename"]
        try:
            dm = _distance_matrix(msa)
            tree = DistanceTreeConstructor().nj(dm)
            newick = _newick(tree)
            _check_tree(tree, msa, newick)
            stats = _tree_stats(tree, newick, msa, dm)
            svg = _tree_svg(tree)
        except (ValueError, RuntimeError, KeyError, IndexError) as exc:
            return failure_result(
                self, f"Neighbor-joining tree failed validation: {exc}",
                limitations=self._limitations,
            )
        artifacts = [
            text_artifact("tree.nwk", newick + "\n", "newick"),
            text_artifact("tree.svg", svg, "svg"),
            json_artifact("tree_stats.json", stats),
        ]
        meta = _meta(
            self,
            functions=self._functions,
            artifacts=artifacts,
            limitations=self._limitations,
            evidence=_evidence(
                [
                    (
                        "The inferred tree has {value} tips.",
                        "tree_stats.json",
                        "tip_count",
                    ),
                    (
                        "The inferred tree has {value} internal nodes.",
                        "tree_stats.json",
                        "internal_node_count",
                    ),
                    (
                        "The serialized Newick string is {value} characters long.",
                        "tree_stats.json",
                        "newick_length",
                    ),
                ]
            ),
            required=["tree.nwk", "tree.svg", "tree_stats.json"],
            parameters={"distance_model": "identity", "method": "neighbor-joining"},
            input_file=input_file,
        )
        return {"artifacts": artifacts, "tool_run_meta": meta}


class PhylogeneticsReportPlugin(_BasePhylogeneticsAdapter):
    TOOL_ID = "phylogenetics.report"
    _functions = (
        "smartbio.fasta.parse_fasta_file",
        "smartbio.fasta.validate_records",
        "Bio.Align.PairwiseAligner",
        "Bio.Phylo.TreeConstruction.DistanceTreeConstructor",
        "Bio.AlignIO.write",
        "Bio.Phylo.write",
    )
    _limitations = _REPORT_LIMITATIONS

    def run(
        self, step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        prepared, failed = self._prepare_or_fail(inputs, context)
        if failed is not None:
            return failed
        try:
            validation_doc = _validation_document(prepared)
            msa, alignment_summary, _ = _progressive_alignment(prepared["records"])
            alignment_text = _alignment_fasta(msa)
            dm = _distance_matrix(msa)
            tree = DistanceTreeConstructor().nj(dm)
            newick = _newick(tree)
            _check_tree(tree, msa, newick)
            tree_stats = _tree_stats(tree, newick, msa, dm)
            svg = _tree_svg(tree)
        except (ValueError, RuntimeError, KeyError, IndexError) as exc:
            return failure_result(
                self, f"Reproducible phylogenetics report failed: {exc}",
                limitations=self._limitations,
            )

        documents = {
            "phylo_validation.json": validation_doc,
            "alignment_summary.json": alignment_summary,
            "tree_stats.json": tree_stats,
        }
        hashes = {
            name: _sha256(json.dumps(document, indent=2, ensure_ascii=False))
            for name, document in documents.items()
        }
        hashes["alignment.fasta"] = _sha256(alignment_text)
        hashes["tree.nwk"] = _sha256(newick + "\n")
        hashes["tree.svg"] = _sha256(svg)
        params = {
            "sequence_type": "dna",
            "mode": "global",
            "match": _MATCH_SCORE,
            "mismatch": _MISMATCH_SCORE,
            "gap_open": _OPEN_GAP_SCORE,
            "gap_extend": _EXTEND_GAP_SCORE,
            "distance_model": "identity",
            "tree_method": "neighbor-joining",
        }
        report = {
            "tool": "Smart Bioinformatics Toolkit",
            "tool_version": _TOOL_VERSION,
            "execution_mode": "real",
            "artifact_count": len(hashes),
            "input_sha256": prepared["input_sha256"],
            "tool_versions": {
                "phylogenetics_adapter": _TOOL_VERSION,
                "biopython": Bio.__version__,
            },
            "parameters": params,
            "pipeline": [
                "phylogenetics.validate",
                "phylogenetics.align",
                "phylogenetics.tree",
                "phylogenetics.report",
            ],
            "validation": validation_doc,
            "alignment_summary": alignment_summary,
            "tree_stats": tree_stats,
            "artifact_hashes": hashes,
            "references": REFERENCES,
            "limitations": list(_REPORT_LIMITATIONS),
        }
        html_rows = "\n".join(
            f"<li><code>{html.escape(name)}</code> sha256={html.escape(digest)}</li>"
            for name, digest in sorted(hashes.items())
        )
        report_html = "\n".join(
            [
                "<!doctype html>",
                '<html lang="en"><head><meta charset="utf-8">',
                "<title>Phylogenetics report</title></head><body>",
                "<h1>Phylogenetics report</h1>",
                "<p>Generated locally from the supplied FASTA with Biopython; "
                "execution mode: real.</p>",
                f"<p>Input SHA-256: <code>{html.escape(prepared['input_sha256'])}</code></p>",
                f"<p>Biopython version: <code>{html.escape(Bio.__version__)}</code></p>",
                f"<p>Alignment columns: {alignment_summary['alignment_columns']}; "
                f"conserved sites: {alignment_summary['conserved_sites']}; "
                f"gap characters: {alignment_summary['gap_count']}; "
                f"tree tips: {tree_stats['tip_count']}.</p>",
                "<h2>Artifact hashes</h2><ul>",
                html_rows,
                "</ul>",
                "<h2>References</h2><ul>",
                *(
                    f'<li>{html.escape(ref["title"])} '
                    f'(<a href="{html.escape(ref["url"])}">{html.escape(ref["url"])}</a>)</li>'
                    for ref in REFERENCES
                ),
                "</ul>",
                "<h2>Limitations and reproducibility notes</h2><ul>",
                *(f"<li>{html.escape(item)}</li>" for item in _REPORT_LIMITATIONS),
                "<li>Guide-tree and tree topology are deterministic for a fixed "
                "Biopython version and fixed scoring parameters.</li>",
                "</ul></body></html>",
            ]
        )
        artifacts = [
            json_artifact("phylo_report.json", report),
            text_artifact("phylo_report.html", report_html, "html"),
        ]
        meta = _meta(
            self,
            functions=self._functions,
            artifacts=artifacts,
            limitations=self._limitations,
            evidence=_evidence(
                [
                    (
                        "Report bundles {value} upstream artifact hashes.",
                        "phylo_report.json",
                        "artifact_count",
                    ),
                    (
                        "The reported alignment has {value} columns.",
                        "phylo_report.json",
                        "alignment_summary.alignment_columns",
                    ),
                    (
                        "The reported tree has {value} tips.",
                        "phylo_report.json",
                        "tree_stats.tip_count",
                    ),
                ]
            ),
            required=["phylo_report.json", "phylo_report.html"],
            parameters=params,
            input_file=prepared["filename"],
        )
        return {"artifacts": artifacts, "tool_run_meta": meta}


__all__ = [
    "PhylogeneticsValidatePlugin",
    "PhylogeneticsAlignPlugin",
    "PhylogeneticsTreePlugin",
    "PhylogeneticsReportPlugin",
]
