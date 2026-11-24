// GENERATED FILE - do not edit by hand.
// Source: shared/plugins/*.json (validated by scripts/check_plugins.py).
// Regenerate with: python scripts/generate_plugin_registry.py

export const TOOLS = [
  {
    "id": "phylogenetics.validate",
    "name": "phylogenetics.validate",
    "description": "Parse FASTA with the existing smartbio parser; require at least three unique, non-empty DNA sequences of at least 50 bp. Fails closed.",
    "version": "1.0.0",
    "backend": "local-python",
    "domain": "phylogenetics",
    "available": true,
    "unavailable_reason": null,
    "external_egress": false,
    "requirements": [
      "python-package:biopython"
    ],
    "estimated_seconds": 2,
    "params_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "input_schema": {
      "type": "object",
      "required": [
        "dataset_id",
        "fasta_text",
        "filename"
      ],
      "properties": {
        "dataset_id": {
          "type": "string"
        },
        "fasta_text": {
          "type": "string",
          "maxLength": 65536
        },
        "filename": {
          "type": "string"
        }
      }
    },
    "output_schema": {
      "type": "object",
      "required": [
        "phylo_validation.json"
      ],
      "properties": {
        "phylo_validation.json": {
          "type": "string"
        }
      }
    },
    "references": [
      {
        "key": "cock2009_biopython",
        "title": "Biopython: freely available Python tools for computational molecular biology and bioinformatics",
        "url": "https://doi.org/10.1093/bioinformatics/btp163",
        "verified": true
      }
    ],
    "limitations": [
      "Validation accepts the IUPAC DNA alphabet; ambiguous bases are not resolved into a single nucleotide.",
      "Length and alphabet checks cannot assess sequencing quality or contamination.",
      "Research use only; this is not a clinical diagnostic result."
    ]
  },
  {
    "id": "phylogenetics.align",
    "name": "phylogenetics.align",
    "description": "Deterministic progressive multiple sequence alignment: UPGMA guide tree from real pairwise-aligner identity distances, then consensus-driven profile merges with Bio.Align.PairwiseAligner (match +2, mismatch -1, gap open -5, gap extend -2).",
    "version": "1.0.0",
    "backend": "local-python",
    "domain": "phylogenetics",
    "available": true,
    "unavailable_reason": null,
    "external_egress": false,
    "requirements": [
      "python-package:biopython"
    ],
    "estimated_seconds": 5,
    "params_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "input_schema": {
      "type": "object",
      "required": [
        "dataset_id",
        "fasta_text",
        "filename"
      ],
      "properties": {
        "dataset_id": {
          "type": "string"
        },
        "fasta_text": {
          "type": "string",
          "maxLength": 65536
        },
        "filename": {
          "type": "string"
        }
      }
    },
    "output_schema": {
      "type": "object",
      "required": [
        "alignment.fasta",
        "alignment_summary.json"
      ],
      "properties": {
        "alignment.fasta": {
          "type": "string"
        },
        "alignment_summary.json": {
          "type": "string"
        }
      }
    },
    "references": [
      {
        "key": "cock2009_biopython",
        "title": "Biopython: freely available Python tools for computational molecular biology and bioinformatics",
        "url": "https://doi.org/10.1093/bioinformatics/btp163",
        "verified": true
      },
      {
        "key": "thompson1994_clustalw",
        "title": "CLUSTAL W: improving the sensitivity of progressive multiple sequence alignment",
        "url": "https://doi.org/10.1093/nar/22.22.4673",
        "verified": true
      }
    ],
    "limitations": [
      "Progressive multiple sequence alignment is a heuristic and does not guarantee a global optimum.",
      "The guide tree depends on the fixed scoring scheme; alternative scores may produce a different alignment.",
      "Conserved columns are counted only where every sequence shares the same non-gap residue."
    ]
  },
  {
    "id": "phylogenetics.tree",
    "name": "phylogenetics.tree",
    "description": "Real neighbor-joining tree from Biopython identity distances (DistanceCalculator + DistanceTreeConstructor), emitted as Newick, deterministic SVG and validated statistics.",
    "version": "1.0.0",
    "backend": "local-python",
    "domain": "phylogenetics",
    "available": true,
    "unavailable_reason": null,
    "external_egress": false,
    "requirements": [
      "python-package:biopython"
    ],
    "estimated_seconds": 5,
    "params_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "input_schema": {
      "type": "object",
      "required": [
        "dataset_id"
      ],
      "properties": {
        "dataset_id": {
          "type": "string"
        },
        "fasta_text": {
          "type": "string",
          "maxLength": 65536
        },
        "alignment_text": {
          "type": "string",
          "maxLength": 65536
        },
        "filename": {
          "type": "string"
        }
      }
    },
    "output_schema": {
      "type": "object",
      "required": [
        "tree.nwk",
        "tree.svg",
        "tree_stats.json"
      ],
      "properties": {
        "tree.nwk": {
          "type": "string"
        },
        "tree.svg": {
          "type": "string"
        },
        "tree_stats.json": {
          "type": "string"
        }
      }
    },
    "references": [
      {
        "key": "cock2009_biopython",
        "title": "Biopython: freely available Python tools for computational molecular biology and bioinformatics",
        "url": "https://doi.org/10.1093/bioinformatics/btp163",
        "verified": true
      },
      {
        "key": "saitou1987_neighbor_joining",
        "title": "The neighbor-joining method: a new method for reconstructing phylogenetic trees",
        "url": "https://doi.org/10.1093/oxfordjournals.molbev.a040454",
        "verified": true
      }
    ],
    "limitations": [
      "Neighbor joining is a distance-based heuristic, not a maximum-likelihood or Bayesian inference.",
      "The identity distance model ignores substitution saturation and rate variation.",
      "An unrooted NJ tree is stored with a trifurcating root; internal branches are hypotheses, not proof of ancestry."
    ]
  },
  {
    "id": "phylogenetics.report",
    "name": "phylogenetics.report",
    "description": "Reproducible HTML + JSON report bundling input SHA-256, real tool versions, parameters, artifact hashes, literature references and limitations; execution_mode real.",
    "version": "1.0.0",
    "backend": "local-python",
    "domain": "phylogenetics",
    "available": true,
    "unavailable_reason": null,
    "external_egress": false,
    "requirements": [
      "python-package:biopython"
    ],
    "estimated_seconds": 10,
    "params_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "input_schema": {
      "type": "object",
      "required": [
        "dataset_id",
        "fasta_text",
        "filename"
      ],
      "properties": {
        "dataset_id": {
          "type": "string"
        },
        "fasta_text": {
          "type": "string",
          "maxLength": 65536
        },
        "filename": {
          "type": "string"
        }
      }
    },
    "output_schema": {
      "type": "object",
      "required": [
        "phylo_report.json",
        "phylo_report.html"
      ],
      "properties": {
        "phylo_report.json": {
          "type": "string"
        },
        "phylo_report.html": {
          "type": "string"
        }
      }
    },
    "references": [
      {
        "key": "cock2009_biopython",
        "title": "Biopython: freely available Python tools for computational molecular biology and bioinformatics",
        "url": "https://doi.org/10.1093/bioinformatics/btp163",
        "verified": true
      },
      {
        "key": "saitou1987_neighbor_joining",
        "title": "The neighbor-joining method: a new method for reconstructing phylogenetic trees",
        "url": "https://doi.org/10.1093/oxfordjournals.molbev.a040454",
        "verified": true
      },
      {
        "key": "thompson1994_clustalw",
        "title": "CLUSTAL W: improving the sensitivity of progressive multiple sequence alignment",
        "url": "https://doi.org/10.1093/nar/22.22.4673",
        "verified": true
      }
    ],
    "limitations": [
      "This report is for research use only and is not a clinical or diagnostic result.",
      "Artifact hashes cover the artifacts bundled in this report, not the source FASTA itself.",
      "Progressive multiple sequence alignment is a heuristic and does not guarantee a global optimum.",
      "Neighbor joining is a distance-based heuristic, not a maximum-likelihood or Bayesian inference."
    ]
  },
  {
    "id": "sequence-stats.validate",
    "name": "FASTA Validator",
    "description": "FASTA structure and IUPAC alphabet validation.",
    "version": "1.0.0",
    "backend": "local-python",
    "domain": "sequence-analysis",
    "available": true,
    "unavailable_reason": null,
    "external_egress": false,
    "requirements": [],
    "estimated_seconds": 2,
    "params_schema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sequence_type"
      ],
      "properties": {
        "sequence_type": {
          "type": "string",
          "enum": [
            "dna",
            "protein"
          ]
        }
      }
    },
    "input_schema": {
      "type": "object",
      "required": [
        "dataset_id",
        "fasta_text",
        "filename"
      ],
      "properties": {
        "dataset_id": {
          "type": "string"
        },
        "fasta_text": {
          "type": "string",
          "maxLength": 65536
        },
        "filename": {
          "type": "string"
        }
      }
    },
    "output_schema": {
      "type": "object",
      "required": [
        "validation"
      ],
      "properties": {
        "validation": {
          "type": "object"
        }
      }
    },
    "references": [
      {
        "key": "iupac_1984_ambiguity",
        "title": "Nomenclature for incompletely specified bases in nucleic acid sequences: recommendations 1984",
        "url": "https://doi.org/10.1093/nar/13.9.3021",
        "verified": true,
        "verified_by": "CrossRef metadata for DOI 10.1093/nar/13.9.3021 (Cornish-Bowden, Nucleic Acids Research 13(9):3021-3030, 1985), checked 2026-11-24"
      }
    ],
    "limitations": [
      "Validation checks FASTA structure and alphabet only; it does not assess sequencing quality or biological correctness.",
      "Ambiguity codes are interpreted with the IUPAC 1984 recommendation; the alphabet must be chosen explicitly.",
      "Inline FASTA text is capped at 64 KiB by the Worker transport contract."
    ]
  },
  {
    "id": "sequence-stats.profile",
    "name": "Sequence Statistics",
    "description": "FASTA validation plus per-record statistics and collection summaries (length, GC%, composition, N50).",
    "version": "1.0.0",
    "backend": "local-python",
    "domain": "sequence-analysis",
    "available": true,
    "unavailable_reason": null,
    "external_egress": false,
    "requirements": [],
    "estimated_seconds": 5,
    "params_schema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sequence_type"
      ],
      "properties": {
        "sequence_type": {
          "type": "string",
          "enum": [
            "dna",
            "protein"
          ]
        }
      }
    },
    "input_schema": {
      "type": "object",
      "required": [
        "dataset_id",
        "fasta_text",
        "filename"
      ],
      "properties": {
        "dataset_id": {
          "type": "string"
        },
        "fasta_text": {
          "type": "string",
          "maxLength": 65536
        },
        "filename": {
          "type": "string"
        }
      }
    },
    "output_schema": {
      "type": "object",
      "required": [
        "validation",
        "statistics"
      ],
      "properties": {
        "validation": {
          "type": "object"
        },
        "statistics": {
          "type": "object"
        }
      }
    },
    "references": [
      {
        "key": "iupac_1984_ambiguity",
        "title": "Nomenclature for incompletely specified bases in nucleic acid sequences: recommendations 1984",
        "url": "https://doi.org/10.1093/nar/13.9.3021",
        "verified": true,
        "verified_by": "CrossRef metadata for DOI 10.1093/nar/13.9.3021 (Cornish-Bowden, Nucleic Acids Research 13(9):3021-3030, 1985), checked 2026-11-24"
      },
      {
        "key": "smartbio_gc_definition",
        "title": "Smart Bioinformatics Toolkit: DNA GC percentage definition",
        "url": "python-engine/src/smartbio/statistics.py#calculate_statistics",
        "verified": true,
        "verified_by": "in-tree source: smartbio/statistics.py::calculate_statistics"
      }
    ],
    "limitations": [
      "Statistics include valid, non-empty records only.",
      "DNA GC percentage uses canonical A/C/G/T bases as its denominator; ambiguous bases are excluded.",
      "N50 and composition describe only the supplied records; they are not assembly quality measures.",
      "FASTA input does not contain per-base sequencing quality scores."
    ]
  },
  {
    "id": "microbiome-16s.blast-parse",
    "name": "BLAST TSV Parser",
    "description": "Parse a BLAST TSV into normalized hits (requires a TSV dataset, not FASTA).",
    "version": "1.0.0",
    "backend": "local-python",
    "domain": "microbiome-16s",
    "available": false,
    "unavailable_reason": "Requires a BLAST TSV dataset and a locally configured BLAST database; not wired into the MVP planner. Unsatisfied runtime requirement(s): requirement 'tsv_dataset' uses no statically verifiable form; use python-package:NAME or executable:NAME; requirement 'local_database' uses no statically verifiable form; use python-package:NAME or executable:NAME.",
    "external_egress": false,
    "requirements": [
      "tsv_dataset",
      "local_database"
    ],
    "estimated_seconds": 5,
    "params_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "schema": {
          "type": "string",
          "enum": [
            "auto",
            "standard",
            "extended",
            "blastn_local_v1"
          ]
        },
        "min_identity": {
          "type": "number",
          "minimum": 0,
          "maximum": 100
        },
        "min_query_coverage": {
          "type": "number",
          "minimum": 0,
          "maximum": 100
        }
      }
    },
    "input_schema": {
      "type": "object",
      "required": [
        "dataset_id",
        "tsv_text",
        "filename"
      ],
      "properties": {
        "dataset_id": {
          "type": "string"
        },
        "tsv_text": {
          "type": "string",
          "maxLength": 65536
        },
        "filename": {
          "type": "string"
        }
      }
    },
    "output_schema": {
      "type": "object",
      "required": [
        "parse"
      ],
      "properties": {
        "parse": {
          "type": "object"
        }
      }
    },
    "references": [
      {
        "key": "altschul1990_blast",
        "title": "Basic local alignment search tool",
        "url": "https://doi.org/10.1016/S0022-2836(05)80360-2",
        "verified": true,
        "verified_by": "CrossRef metadata for DOI 10.1016/S0022-2836(05)80360-2 (Altschul et al., J Mol Biol 215(3):403-410, 1990), checked 2026-11-24"
      }
    ],
    "limitations": [
      "The adapter parses an existing BLAST TSV; it does not run a new BLAST search.",
      "Parsed similarity is not proof of taxonomic identity.",
      "Malformed TSV rows are excluded from the analysis and reported as input quality flags, not fabricated hits."
    ]
  },
  {
    "id": "microbiome-16s.taxonomy",
    "name": "Taxonomic Consensus",
    "description": "Conservative per-query taxonomic verdict from parsed BLAST hits.",
    "version": "1.0.0",
    "backend": "local-python",
    "domain": "microbiome-16s",
    "available": false,
    "unavailable_reason": "Requires parsed BLAST TSV hits from a locally configured database; not wired into the MVP planner. Unsatisfied runtime requirement(s): requirement 'tsv_dataset' uses no statically verifiable form; use python-package:NAME or executable:NAME; requirement 'local_database' uses no statically verifiable form; use python-package:NAME or executable:NAME.",
    "external_egress": false,
    "requirements": [
      "tsv_dataset",
      "local_database"
    ],
    "estimated_seconds": 5,
    "params_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "schema": {
          "type": "string",
          "enum": [
            "auto",
            "standard",
            "extended",
            "blastn_local_v1"
          ]
        },
        "min_identity": {
          "type": "number",
          "minimum": 0,
          "maximum": 100
        },
        "min_query_coverage": {
          "type": "number",
          "minimum": 0,
          "maximum": 100
        },
        "top_n": {
          "type": "integer",
          "minimum": 1
        },
        "min_consensus": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "species_threshold": {
          "type": "number",
          "minimum": 0,
          "maximum": 100
        }
      }
    },
    "input_schema": {
      "type": "object",
      "required": [
        "dataset_id",
        "tsv_text",
        "filename"
      ],
      "properties": {
        "dataset_id": {
          "type": "string"
        },
        "tsv_text": {
          "type": "string",
          "maxLength": 65536
        },
        "filename": {
          "type": "string"
        }
      }
    },
    "output_schema": {
      "type": "object",
      "required": [
        "taxonomy"
      ],
      "properties": {
        "taxonomy": {
          "type": "object"
        }
      }
    },
    "references": [
      {
        "key": "altschul1990_blast",
        "title": "Basic local alignment search tool",
        "url": "https://doi.org/10.1016/S0022-2836(05)80360-2",
        "verified": true,
        "verified_by": "CrossRef metadata for DOI 10.1016/S0022-2836(05)80360-2 (Altschul et al., J Mol Biol 215(3):403-410, 1990), checked 2026-11-24"
      },
      {
        "key": "kim2014_16s_species_threshold",
        "title": "Towards a taxonomic coherence between average nucleotide identity and 16S rRNA gene sequence similarity for species demarcation of prokaryotes",
        "url": "https://doi.org/10.1099/ijs.0.059774-0",
        "verified": false,
        "note": "Bibliographic record exists (PubMed 24505072), but a 98.65% 16S identity cutoff is a screening proposal, not a universal species boundary; this claim is deliberately not marked verified."
      }
    ],
    "limitations": [
      "16S identity thresholds are screening references, not universal species boundaries.",
      "A verdict interprets BLAST similarity evidence; it is not proof of species identity or a clinical diagnosis.",
      "No network taxonomy lookup is performed; only the supplied TSV and optional local taxonomy map are used.",
      "Queries without hits remain unresolved and are reported as such rather than assigned a taxon."
    ]
  }
];
