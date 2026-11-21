import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildReportHtml } from "../public/js/report.js";

const shared = new URL("../../shared/test-cases/", import.meta.url);
const expected = JSON.parse(await readFile(new URL("report_metadata_keys.json", shared), "utf8"));

test("report metadata keys match shared fixture (JS)", async () => {
  const analysis = { top_n: 10, min_consensus: 0.8, verdict_settings: { species_threshold: 98.65, min_coverage: 80, min_query_length: 500, near_threshold_margin: 0.35, difficult_groups_loaded: 3 }, summary: {}, verdict_counts: {}, flags: [], per_query: {}, no_hit_queries: {} };
  const html = await buildReportHtml(analysis, { inputText: "x", inputFileName: "x.tsv" });
  for (const key of expected.top_level_keys) assert.ok(html.includes(`&quot;${key}&quot;`) || html.includes(`"${key}"`), key);
  for (const key of expected.parameter_keys) assert.ok(html.includes(`&quot;${key}&quot;`) || html.includes(`"${key}"`), key);
});
