// M7 Provider Usage Governor.
//
// Centralized budget enforcement. Budgets are split by *unit* (API calls,
// compute hours, requests, tokens, bytes) and by *category* (percentage
// allocations). Totals must come from actual discovered provider limits; a
// missing total is treated as UNKNOWN and reservations fail closed. No quota is
// ever invented. Galaxy is governed by operator-configured operational safety
// caps plus the account's real quota data, not fictional monthly credits.
//
// Storage-agnostic: a `storage` object with async load()/save() is injected.

import { PROVIDER_IDS, EMPTY_STATE } from "./contract.js";

// Planning percentages from M7 Part 8. These are planning ratios, not provider
// guarantees. They only allocate a configured total; they never create one.
export const DEFAULT_ALLOCATION = Object.freeze({
  smartsbio: Object.freeze({
    api_calls: Object.freeze({
      discovery_chat: 0.15,
      core_integration: 0.30,
      additional_pipelines: 0.30,
      evaluation: 0.15,
      reserve: 0.10
    }),
    compute_hours: Object.freeze({
      connection_smoke: 0.10,
      existing_workflows: 0.40,
      new_workflow_pilots: 0.30,
      validation: 0.10,
      reserve: 0.10
    })
  }),
  ninerouter: Object.freeze({
    requests: Object.freeze({
      integration: 0.10,
      workflow_planning: 0.35,
      tool_selection: 0.30,
      explanation_evaluation: 0.15,
      reserve: 0.10
    })
  }),
  galaxy: Object.freeze({
    // Operational safety caps only. Not provider credits. Totals, when set,
    // must be derived from the real account quota / concurrency information.
    jobs: Object.freeze({ general: 1.0 }),
    bytes: Object.freeze({ general: 1.0 })
  })
});

function blankState() {
  return JSON.parse(JSON.stringify(EMPTY_STATE));
}

function ensureProviderContainers(state, provider) {
  if (!state.totals[provider]) state.totals[provider] = {};
  if (!state.used[provider]) state.used[provider] = {};
  if (!state.usedByCategory[provider]) state.usedByCategory[provider] = {};
  if (!state.reserved[provider]) state.reserved[provider] = {};
  if (!state.emergency[provider]) state.emergency[provider] = { stopped: false, reason: null, at: null };
}

export class UsageGovernor {
  constructor({
    storage,
    allocation = DEFAULT_ALLOCATION,
    warnThreshold = 0.8,
    onAlert = null,
    now = () => new Date().toISOString()
  } = {}) {
    if (!storage || typeof storage.load !== "function" || typeof storage.save !== "function") {
      throw new Error("UsageGovernor requires storage with load()/save().");
    }
    this.storage = storage;
    this.allocation = allocation;
    this.warnThreshold = warnThreshold;
    this.onAlert = typeof onAlert === "function" ? onAlert : null;
    this.now = now;
    this.state = null;
  }

  async initialize() {
    const loaded = await this.storage.load();
    this.state = loaded && typeof loaded === "object" ? loaded : blankState();
    // Forward-compatible defaults for older snapshots.
    for (const key of Object.keys(EMPTY_STATE)) {
      if (this.state[key] === undefined) this.state[key] = JSON.parse(JSON.stringify(EMPTY_STATE[key]));
    }
    return this.snapshot();
  }

  async snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  async configureTotals(totals) {
    if (!totals || typeof totals !== "object") throw new Error("totals must be an object.");
    for (const [provider, units] of Object.entries(totals)) {
      if (!PROVIDER_IDS.includes(provider)) continue; // ignore unknown providers
      ensureProviderContainers(this.state, provider);
      for (const [unit, value] of Object.entries(units ?? {})) {
        // Explicit null means "unknown": fail closed, never invent a quota.
        if (value === null) this.state.totals[provider][unit] = null;
        else if (Number.isFinite(Number(value)) && Number(value) >= 0) this.state.totals[provider][unit] = Number(value);
      }
    }
    await this.storage.save(this.state);
    return this.snapshot();
  }

  categoryShare(provider, unit, category) {
    const ratio = this.allocation?.[provider]?.[unit]?.[category];
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    const total = this.state.totals[provider]?.[unit];
    if (!Number.isFinite(total) || total == null) return null;
    return total * ratio;
  }

  categoryConsumed(provider, unit, category) {
    // Only this category's *consumed* amount counts against its share. The
    // aggregate used[] is reporting-only; charging it here would make one
    // category borrow another category's allocation (review finding B3).
    let used = Number(this.state.usedByCategory[provider]?.[unit]?.[category] ?? 0);
    for (const reservation of Object.values(this.state.reservations)) {
      if (reservation.provider === provider && reservation.unit === unit && reservation.category === category) {
        used += Number(reservation.amount ?? 0);
      }
    }
    return used;
  }

  async alert(provider, unit, category, ratio, kind) {
    const entry = {
      kind,
      provider,
      unit,
      category,
      ratio: Math.round(ratio * 100) / 100,
      at: this.now()
    };
    this.state.alerts.push(entry);
    if (this.state.alerts.length > 200) this.state.alerts = this.state.alerts.slice(-200);
    await this.storage.save(this.state);
    if (this.onAlert) {
      try { this.onAlert(entry); } catch { /* alerts must never break a job */ }
    }
  }

  // Before each job: availability, budget, reservation, consent, file size and
  // operation checks are performed by the caller; the governor owns budget and
  // reservation state and refuses unknown budgets.
  async reserve({ provider, unit, amount, category = "general", consentVerified = true, operation = null, idFactory = null }) {
    if (!this.state) await this.initialize();
    // Persisted state may have been seeded by an operator row; ensure the
    // per-provider containers exist before any read/write.
    ensureProviderContainers(this.state, provider);
    const denial = (reason, extra = {}) => ({ ok: false, reason, provider, ...extra });

    if (!PROVIDER_IDS.includes(provider)) return denial("unknown_provider");
    if (this.state.emergency[provider]?.stopped) {
      return denial("emergency_stop", { reason_detail: this.state.emergency[provider].reason });
    }
    const quantity = Number(amount);
    if (!Number.isFinite(quantity) || quantity <= 0) return denial("invalid_amount");
    // A consent flag may be supplied by the caller; false blocks the reserve.
    if (consentVerified === false) return denial("consent_required", { operation });

    const share = this.categoryShare(provider, unit, category);
    if (share === null) {
      // Missing total OR missing allocation: fail closed. Never invent quota.
      return denial("budget_unknown", { unit, category });
    }
    const consumed = this.categoryConsumed(provider, unit, category);
    if (consumed + quantity > share) {
      return denial("budget_exhausted", { unit, category, share, consumed, requested: quantity });
    }

    const at = this.now();
    const suffix = typeof idFactory === "function" ? idFactory("rsv") : `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
    const reservationId = `rsv_${String(suffix).replace(/^rsv_/, "")}`;
    this.state.reservations[reservationId] = { provider, unit, amount: quantity, category, at, operation };
    this.state.reserved[provider][unit] = Number(this.state.reserved[provider][unit] ?? 0) + quantity;
    await this.storage.save(this.state);

    const utilization = (consumed + quantity) / share;
    if (utilization >= this.warnThreshold) {
      await this.alert(provider, unit, category, utilization, "threshold_warning");
    }
    return { ok: true, provider, reservation_id: reservationId, unit, category, amount: quantity, at };
  }

  // After each job: record actual consumption and release the unused portion.
  async consume(reservationId, actual) {
    if (!this.state) await this.initialize();
    const reservation = this.state.reservations[reservationId];
    if (!reservation) return { ok: false, reason: "unknown_reservation" };
    const quantity = Math.max(0, Number(actual) || 0);
    const { provider, unit, category, amount } = reservation;
    ensureProviderContainers(this.state, provider);
    this.state.reserved[provider][unit] = Math.max(0, Number(this.state.reserved[provider][unit] ?? 0) - Number(amount));
    this.state.used[provider][unit] = Number(this.state.used[provider][unit] ?? 0) + quantity;
    if (!this.state.usedByCategory[provider]) this.state.usedByCategory[provider] = {};
    if (!this.state.usedByCategory[provider][unit]) this.state.usedByCategory[provider][unit] = {};
    this.state.usedByCategory[provider][unit][category] = Number(this.state.usedByCategory[provider][unit][category] ?? 0) + quantity;
    delete this.state.reservations[reservationId];
    await this.storage.save(this.state);
    return { ok: true, provider, unit, category, actual: quantity, released: Math.max(0, Number(amount) - quantity) };
  }

  async release(reservationId) {
    if (!this.state) await this.initialize();
    const reservation = this.state.reservations[reservationId];
    if (!reservation) return { ok: false, reason: "unknown_reservation" };
    const { provider, unit, amount } = reservation;
    ensureProviderContainers(this.state, provider);
    this.state.reserved[provider][unit] = Math.max(0, Number(this.state.reserved[provider][unit] ?? 0) - Number(amount));
    delete this.state.reservations[reservationId];
    await this.storage.save(this.state);
    return { ok: true, provider, unit, released: Number(amount) };
  }

  async setEmergencyStop(provider, stopped, reason = "") {
    if (!this.state) await this.initialize();
    if (!PROVIDER_IDS.includes(provider)) return { ok: false, reason: "unknown_provider" };
    ensureProviderContainers(this.state, provider);
    this.state.emergency[provider] = { stopped: Boolean(stopped), reason: String(reason).slice(0, 300), at: this.now() };
    await this.storage.save(this.state);
    return { ok: true, provider, ...this.state.emergency[provider] };
  }

  async recordUsage(provider, counters) {
    if (!this.state) await this.initialize();
    if (!PROVIDER_IDS.includes(provider)) return { ok: false, reason: "unknown_provider" };
    const existing = this.state.usage[provider] ?? {};
    this.state.usage[provider] = { ...existing, ...(counters ?? {}), observed_at: this.now() };
    await this.storage.save(this.state);
    return { ok: true, provider, usage: this.state.usage[provider] };
  }

  async getStatus(provider = null) {
    if (!this.state) await this.initialize();
    const providers = provider ? [provider] : PROVIDER_IDS;
    const result = {};
    for (const name of providers) {
      const units = {};
      for (const unit of Object.keys(this.state.totals[name] ?? {})) {
        const total = this.state.totals[name][unit];
        const used = Number(this.state.used[name]?.[unit] ?? 0);
        const reserved = Number(this.state.reserved[name]?.[unit] ?? 0);
        const byCategory = { ...(this.state.usedByCategory[name]?.[unit] ?? {}) };
        for (const reservation of Object.values(this.state.reservations)) {
          if (reservation.provider === name && reservation.unit === unit) {
            byCategory[reservation.category] = Number(byCategory[reservation.category] ?? 0) + Number(reservation.amount ?? 0);
          }
        }
        units[unit] = {
          total: total ?? null,
          used,
          used_by_category: byCategory,
          reserved,
          remaining: total == null ? null : Math.max(0, Number(total) - used - reserved),
          unknown: total == null
        };
      }
      result[name] = {
        units,
        emergency: this.state.emergency[name] ?? { stopped: false, reason: null, at: null },
        usage: this.state.usage[name] ?? null
      };
    }
    return result;
  }
}

export function createGovernor(options) {
  return new UsageGovernor(options);
}
