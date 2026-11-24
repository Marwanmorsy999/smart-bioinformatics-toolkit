# Name drift and valid-name notes (TAXONOMY agent)

Status: **NOT IMPLEMENTED / UNVERIFIED.** No valid-name or name-drift flag is
emitted by the pipeline. No rule was adopted in this change because no
*verified, free, offline* source giving an exact "is this name currently
valid / accepted" rule was found in the material opened below (see ledger).

## 1. How the current code treats name-like strings

Both verdict implementations are reported as behaviourally identical in
`docs/SCIENTIFIC_RULES.md` (line 43). I confirmed the following directly in
`python-engine/src/smartbio/taxonomy/verdict.py` (`_is_uninformative_species`,
lines 56-69 and 184-185) and `web-platform/public/js/verdict.js`
(`norm` / `isUninformativeSpecies`, lines 17-27 and ~119):

- Names are normalized by collapsing whitespace and lowercasing. The original
  display name is retained for reporting.
- **"uncultured"**: any normalized species name *containing* the substring
  `uncultured` is treated as uninformative and is skipped when the qualifying /
  below-threshold species sets are built.
- **"sp."**: the regex `\bsp\.?\b` marks a name uninformative (matches both
  `sp.` and `sp`). Such names cannot support a species-level call.
- **"Candidatus"**: names whose normalized form *starts with* `candidatus` are
  uninformative and are skipped.
- The literal names `bacterium` and `uncultured bacterium` are also
  uninformative (the second is already covered by the `uncultured` rule).
- An empty name is uninformative as well.

Important: this is an **uninformative-name filter, not a nomenclatural validity
check** and not a name-drift check. Skipping one of these names does not set a
caution flag, does not compare it with an accepted-name list, and does not
report a synonym, a misapplied name, or a renamed taxon.

**Subspecies and strain names.** `docs/SCIENTIFIC_RULES.md` line 55 states:
"Subspecies/strain names count as distinct species unless they share a taxid."
I confirmed how this is actually realized:

- Neither verdict.py nor verdict.js contains any taxid reference (`grep` for
  `taxid` returned no matches in either file). In the verdict layer, species
  distinctness is decided solely by the normalized species-name string, so a
  subspecies or strain suffix that reaches the verdict as part of the species
  name is simply part of that string; different suffixes count as different
  species.
- The "unless they share a taxid" part happens *upstream*, in
  `python-engine/src/smartbio/taxonomy/consensus.py` (`_species_key`, lines
  114-124): grouping prefers `taxid:<species taxid>` and only falls back to
  `name:<species name>` when the species taxid is absent.
- No code parses, strips or flags the substrings `subsp.`, `subspecies` or
  strain designations, and no code compares them against a name authority.

## 2. What the NCBI taxdump files actually contain

Opened: the official NCBI taxonomy dump readme at
`https://ftp.ncbi.nlm.nih.gov/pub/taxonomy/taxdump_readme.txt` (2026-11-24).
Quoted field definitions from that readme:

- `merged.dmp` — two fields: `old_tax_id` = "id of nodes which has been
  merged"; `new_tax_id` = "id of nodes which is result of merging".
- `delnodes.dmp` — one field: `tax_id` = "deleted node id". The readme labels
  these "Deleted nodes (nodes that existed but were deleted)".
- `names.dmp` — `tax_id`, `name_txt`, `unique name`, `name class`
  ("(synonym, common name, ...)").
- Records end with `\t|\n`; fields are delimited by `\t|\t`.

Conclusion from the source: `merged.dmp` and `delnodes.dmp` describe **taxid
merges and taxid deletions**, not nomenclatural name validity and not a mapping
from a superseded *name* to an accepted *name*. An NCBI `name class` of
`synonym` is a taxdump label, not an authoritative prokaryotic nomenclatural
status. `scripts/build_taxonomy_map.py` currently ignores merged.dmp and
delnodes.dmp and, in its names path, only prefers the `scientific name` name
class.

## 3. LPSN terms checked

Opened (2026-11-24):

- `https://lpsn.dsmz.de/` — LPSN describes itself as providing comprehensive
  information on the nomenclature of prokaryotes, and as an ICSP-supported
  Global Core Biodata Resource / ELIXIR Core Data Resource.
- `https://lpsn.dsmz.de/text/copyright` — LPSN data (site, download page and
  API) are distributed under **CC BY-SA 4.0**; redistribution requires
  attribution and a link back to the specific LPSN page; automated download is
  permitted only via the LPSN download page or the LPSN API; the access date
  must be mentioned when citing. LPSN states it is authoritative for
  prokaryotic nomenclature but **not** for clinical, medical, veterinary or
  legal conclusions.
- `https://api.lpsn.dsmz.de/` — the API returns JSON and has detail,
  advanced-search and flexible-search views, but the page states that a user
  **must log in / register** to use the web services.

(`https://lpsn.dsmz.de/copyright` and `https://lpsn.dsmz.de/api` were attempted
first and returned 404; the working URLs above were found from the site's own
navigation.)

## 4. Rule decision

- **Adopted: none.** No source opened above supplies an exact, offline,
  machine-applicable rule for deciding whether an arbitrary species string is
  a currently valid/accepted name or has undergone name drift.
- **Rejected: LPSN-based valid-name lookup.** Reason: although LPSN is the
  authoritative nomenclature source and its data are CC BY-SA 4.0, the API
  requires registration, no exact status rule was verified in the pages
  opened, and a runtime lookup would break the offline design. Implementing it
  would also require changing verdict.py / verdict.js, which are outside this
  task's owned files.
- **Rejected: merged.dmp / delnodes.dmp as a valid-name rule.** Reason: the
  official readme defines them as taxid merge/deletion records; they do not
  carry nomenclatural validity or old-name-to-accepted-name pairs. Treating a
  taxid merge as "name drift" would be an unverified inference.
- Therefore valid-name / name-drift flagging remains **NOT IMPLEMENTED** and is
  marked **UNVERIFIED**. This note is documentation only; no verdict code was
  changed.

## 5. Ledger

| claim | source URL opened | date | agent | verified-by |
|---|---|---|---|---|
| NCBI `merged.dmp` has `old_tax_id` and `new_tax_id`; `delnodes.dmp` has `tax_id` (deleted node id); `names.dmp` has a `name class` field including synonym/common name | https://ftp.ncbi.nlm.nih.gov/pub/taxonomy/taxdump_readme.txt | 2026-11-24 | TAXONOMY | UNVERIFIED |
| LPSN is authoritative for prokaryotic nomenclature; data are CC BY-SA 4.0 with attribution/link-back and API-only automated access; API requires login/register; not for clinical conclusions | https://lpsn.dsmz.de/ ; https://lpsn.dsmz.de/text/copyright ; https://api.lpsn.dsmz.de/ | 2026-11-24 | TAXONOMY | UNVERIFIED |
| "uncultured", "sp.", "Candidatus" and `bacterium` names are skipped as uninformative in both verdict implementations | N/A - local file: python-engine/src/smartbio/taxonomy/verdict.py ; web-platform/public/js/verdict.js | 2026-11-24 | TAXONOMY | UNVERIFIED |
| Subspecies/strain names count as distinct species unless they share a taxid; upstream grouping uses species taxid with name fallback | N/A - local file: docs/SCIENTIFIC_RULES.md ; python-engine/src/smartbio/taxonomy/consensus.py ; python-engine/src/smartbio/taxonomy/verdict.py ; web-platform/public/js/verdict.js | 2026-11-24 | TAXONOMY | UNVERIFIED |
| `shared/difficult-groups.json` contains 3 groups, each with illustrative species lists, a source URL and `needs_curator_review: true`; groups trigger cautions, never identifications | N/A - local file: shared/difficult-groups.json | 2026-11-24 | TAXONOMY | UNVERIFIED |
| Valid-name / name-drift flagging is NOT IMPLEMENTED: no verified free rule with an exact algorithm was found | N/A - synthesis of the sources in the rows above | 2026-11-24 | TAXONOMY | UNVERIFIED |

