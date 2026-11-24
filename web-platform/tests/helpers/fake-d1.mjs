// Minimal D1 stand-in implementing exactly prepare/bind/run/all, plus request helpers.
import { SQL } from "../../functions/api/blast/_lib.js";

export function createFakeD1(initialRows = []) {
  const state = { rows: initialRows.map((row) => ({ ...row })), calls: [] };

  const db = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async run() {
          state.calls.push({ sql, kind: "run", values: [...statement.values] });
          if (sql === SQL.insert) {
            const [rid, status, created_at, last_checked_at, input_hash, result_tsv] = statement.values;
            const row = { rid, status, created_at, last_checked_at, input_hash, result_tsv };
            const index = state.rows.findIndex((existing) => existing.rid === rid);
            if (index >= 0) state.rows[index] = row;
            else state.rows.push(row);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql === SQL.updateStatus) {
            const [status, last_checked_at, rid] = statement.values;
            const row = state.rows.find((existing) => existing.rid === rid);
            if (row) {
              row.status = status;
              row.last_checked_at = last_checked_at;
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }
          if (sql === SQL.cacheResults) {
            const [result_tsv, rid] = statement.values;
            const row = state.rows.find((existing) => existing.rid === rid);
            if (row) {
              row.result_tsv = result_tsv;
              row.status = "complete";
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }
          throw new Error(`Unexpected run SQL: ${sql}`);
        },
        async all() {
          state.calls.push({ sql, kind: "all", values: [...statement.values] });
          if (sql === SQL.selectByRid) {
            const [rid] = statement.values;
            return {
              success: true,
              results: state.rows.filter((row) => row.rid === rid).map((row) => ({ ...row }))
            };
          }
          if (sql === SQL.selectRecent) {
            const [limit] = statement.values;
            const rows = [...state.rows]
              .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
              .slice(0, limit)
              .map((row) => ({ rid: row.rid, status: row.status, created_at: row.created_at }));
            return { success: true, results: rows };
          }
          throw new Error(`Unexpected all SQL: ${sql}`);
        }
      };
      return statement;
    }
  };

  return { db, state };
}

export function mockEnv(db) {
  return {
    BLAST_DB: db,
    MOCK_NCBI: "1",
    NCBI_TOOL: "smart-bioinformatics-toolkit-tests",
    NCBI_EMAIL: "tests@example.invalid"
  };
}

export function makePostRequest(payload, path = "/api/blast/submit", headers = {}) {
  return new Request(`https://blast.example.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload)
  });
}

export function makeGetRequest(path, headers = {}) {
  return new Request(`https://blast.example.test${path}`, { method: "GET", headers });
}

export const VALID_PAYLOAD = {
  fasta: ">seq1 16S mock\nACGTACGTNRYSWKMBDHV\n>seq2\nTTTTacgt\n",
  database: "16S_ribosomal_RNA",
  program: "blastn"
};