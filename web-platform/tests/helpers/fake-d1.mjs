// Minimal D1 stand-in implementing exactly prepare/bind/run/all, plus request helpers.
import { SQL, hashInput, issueBlastConsent } from "../../functions/api/blast/_lib.js";
import { SQL_META } from "../../functions/api/ai/_lib.js";

export function createFakeD1(initialRows = []) {
  const state = { rows: initialRows.map((row) => ({ ...row })), consents: [], auditEvents: [], calls: [] };

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
          if (sql === SQL.insertConsent) {
            const [token, input_hash, database, program, granted, expires_at, created_at, used_at] = statement.values;
            const row = { token, input_hash, database, program, granted, expires_at, created_at, used_at };
            const index = state.consents.findIndex((existing) => existing.token === token);
            if (index >= 0) state.consents[index] = row;
            else state.consents.push(row);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql === SQL.insertBlastAudit) {
            const [public_id, actor, action, target, detail_json, timestamp] = statement.values;
            const row = { public_id, actor, action, target, detail_json, timestamp };
            const index = state.auditEvents.findIndex((existing) => existing.public_id === public_id);
            if (index >= 0) state.auditEvents[index] = row;
            else state.auditEvents.push(row);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql === SQL.updateBlastAudit) {
            const [detail_json, public_id] = statement.values;
            const row = state.auditEvents.find((existing) => existing.public_id === public_id);
            if (row) row.detail_json = detail_json;
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }
          if (sql === SQL.claimConsent) {
            // [used_at, now_iso, token, input_hash, database, program]
            const [used_at, nowIso, token, input_hash, database, program] = statement.values;
            const row = state.consents.find((existing) => (
              existing.token === token
              && !existing.used_at
              && existing.granted === 1
              && existing.input_hash === input_hash
              && existing.database === database
              && existing.program === program
              && Date.parse(existing.expires_at) > Date.parse(nowIso)
            ));
            if (row) row.used_at = used_at;
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
          if (sql === SQL.selectConsentByToken) {
            const [token] = statement.values;
            return {
              success: true,
              results: state.consents.filter((row) => row.token === token).map((row) => ({ ...row }))
            };
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

// Issue a fresh single-use token for a payload before calling handleSubmit.
// Each submit consumes its token, so callers that submit twice need two tokens.
export async function withConsent(payload = VALID_PAYLOAD, db, {
  now = Date.now(),
  ttlSeconds,
  granted = true
} = {}) {
  const fasta = payload.fasta ?? payload.sequence ?? payload.query;
  const inputHash = await hashInput(fasta);
  const consentToken = await issueBlastConsent(db, {
    inputHash,
    database: payload.database,
    program: payload.program,
    granted,
    ttlSeconds,
    now
  });
  return { ...payload, consent_token: consentToken };
}

// Generic D1 stand-in for the AI tables, driven by the SQL metadata exported
// from functions/api/ai/_lib.js. Only prepare/bind/run/all are implemented.
export function createFakeD1AI(initialRows = {}) {
  const state = { tables: {}, calls: [] };
  let nextId = 1;
  for (const [table, rows] of Object.entries(initialRows)) {
    state.tables[table] = rows.map((row) => ({ ...row, id: row.id ?? nextId++ }));
  }
  const ensure = (table) => (state.tables[table] ??= []);
  const matchesWhere = (row, columns, values) => columns.every((column, index) => row[column] === values[index]);
  // Mirrors additive migration 0004_blast_consent_unique.sql.
  const uniquePairs = { jobs: ["plan_id", "step_id"], approvals: ["plan_id", "step_id"] };

  const db = {
    prepare(sql) {
      const meta = SQL_META[sql];
      if (!meta) throw new Error(`Unexpected AI SQL: ${sql}`);
      const statement = {
        sql,
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async run() {
          state.calls.push({ sql, kind: "run", values: [...statement.values] });
          const rows = ensure(meta.table);
          if (meta.op === "insert") {
            const uniqueColumns = uniquePairs[meta.table];
            if (uniqueColumns) {
              const values = uniqueColumns.map((column) => statement.values[meta.columns.indexOf(column)]);
              if (rows.some((existing) => matchesWhere(existing, uniqueColumns, values))) {
                throw new Error(`UNIQUE constraint failed: ${meta.table}.${uniqueColumns.join(", ")}`);
              }
            }
            const row = { id: nextId++ };
            meta.columns.forEach((column, index) => { row[column] = statement.values[index] ?? null; });
            rows.push(row);
            return { success: true, meta: { changes: 1 } };
          }
          if (meta.op === "update" || meta.op === "claim") {
            const whereValues = statement.values.slice(-meta.where.length);
            const matches = rows.filter((row) => matchesWhere(row, meta.where, whereValues));
            for (const row of matches) {
              for (const [column, index] of Object.entries(meta.assignments)) row[column] = statement.values[index];
              if (meta.increment) row[meta.increment] = (row[meta.increment] ?? 0) + 1;
            }
            return { success: true, meta: { changes: matches.length } };
          }
          throw new Error(`Unexpected AI run SQL: ${sql}`);
        },
        async all() {
          state.calls.push({ sql, kind: "all", values: [...statement.values] });
          if (meta.op !== "select") throw new Error(`Unexpected AI all SQL: ${sql}`);
          let rows = ensure(meta.table).filter((row) => matchesWhere(row, meta.where, statement.values));
          if (meta.orderBy) rows = [...rows].sort((a, b) => String(a[meta.orderBy]).localeCompare(String(b[meta.orderBy])));
          if (meta.limit) rows = rows.slice(0, statement.values[statement.values.length - 1]);
          return { success: true, results: rows.map((row) => ({ ...row })) };
        }
      };
      return statement;
    }
  };
  return { db, state };
}

export function mockAIEnv(db, token = "test-agent-token") {
  return { AI_DB: db, AI_AGENT_TOKEN: token };
}