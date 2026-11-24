# Third-party notices

Inventory audited 2026-11-24 against `python-engine/requirements.txt`,
`web-platform/package.json`, `web-platform/package-lock.json`, `wrangler.toml`, the source
imports, and installed package metadata (`importlib.metadata`). `requirements.txt` declares
version ranges, so the versions below are the ones observed installed in this workspace;
the deployed version depends on resolution at install time because no Python lock/hash file is
committed. npm versions are exact and integrity-pinned by `package-lock.json`.

## Runtime dependencies (needed to run the app / CLI)

| Name | Version | Licence | Reason |
| --- | --- | --- | --- |
| Biopython | 1.88 (constraint `>=1.83,<2.0`) | Biopython License Agreement — SPDX `LicenseRef-Biopython-License-Agreement` in installed metadata; BSD-like, see https://biopython.org/about/license/ | `Bio.SeqIO` FASTA parsing in `python-engine/src/smartbio/fasta.py` and `benchmark/queries.py` |
| pandas | 2.3.3 (constraint `>=2.0,<4.0`) | BSD-3-Clause — https://github.com/pandas-dev/pandas/blob/main/LICENSE | DataFrame-backed CSV/JSON outputs in `exports.py`, `statistics.py`, `blast.py`, `benchmark/evaluate.py`, and `main.py` |
| NCBI BLAST+ (bundled `ncbi-blast-2.17.0+-win64.exe`) | 2.17.0+ | UNVERIFIED in-repo — upstream describes BLAST as public domain, but no licence text or checksum is committed with the binary | Local `blastn` execution via `subprocess` in `python-engine/src/smartbio/blast_runner.py` |

### Transitive runtime dependencies (installed, not imported directly by project code)

These arrive via pandas/Biopython and were observed installed:

| Name | Version | Licence |
| --- | --- | --- |
| numpy | 2.3.4 | BSD (package classifier `License :: OSI Approved :: BSD License`; exact SPDX expression UNVERIFIED in metadata) |
| python-dateutil | 2.9.0.post0 | "Dual License" per installed metadata (upstream Apache-2.0 / BSD-3-Clause) |
| pytz | 2025.2 | MIT |
| tzdata | 2026.2 | Apache-2.0 |
| six | 1.17.0 | MIT |

## Development / test only (NOT required to run the app)

| Name | Version | Licence | Reason |
| --- | --- | --- | --- |
| pytest | 8.4.2 (constraint `>=8.0,<9.0`) | MIT — https://github.com/pytest-dev/pytest/blob/main/LICENSE | Runs `python-engine/tests` in CI and locally; not imported by application code |
| playwright | 1.65.1 (`devDependencies`, `^1.65.1`) | Apache-2.0 (confirmed in `package-lock.json`) | Declared for browser checks; not imported by any app module or `node --test` test, and not required at runtime |
| playwright-core | 1.65.1 | Apache-2.0 (confirmed in `package-lock.json`) | Transitive dev dependency of `playwright` |

`pytest`, `playwright` and `playwright-core` can be omitted from a production deployment without
affecting the CLI or the Pages site.

## Web platform

The web frontend and Pages Functions use only browser-native JavaScript APIs and the Cloudflare
Workers/Pages runtime; `package.json` has **no runtime dependencies** and its only `devDependency`
is `playwright`. Cloudflare Pages, D1 and the browser are platform services, not vendored packages.

## Licence and provenance caveats

- No source code from third-party repositories has been copied into this project. The project
  MIT licence (`LICENSE`) applies to original project code only; it does not replace or override
  dependency, reference-database, dataset or future model-weight licences.
- Reference datasets and NCBI taxonomy dumps referenced by `scripts/` are not committed here; if
  they are redistributed later, record their exact release, source URL and licence in this file.
- Record the exact version/commit and licence of any new dependency before adding it. Do not copy
  source from GPL, unclear or missing-licence repositories without owner review and permission.
- `requirements.txt` is range-based and has no hashes; `package-lock.json` pins exact versions and
  integrity hashes. See `docs/THREAT_MODEL.md` section 4.9 for supply-chain recommendations.
