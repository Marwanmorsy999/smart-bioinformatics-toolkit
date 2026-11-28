// M7 provider registry.
//
// Builds all three adapters from env flags. Only the literal string "true"
// enables a provider; anything else (including unset) leaves it disabled.
// Disabled providers report AVAILABILITY.DISABLED with empty operations/tools
// and are never contacted. Tool advertising goes through executableTools()
// from the contract: an unavailable or non-executable tool cannot be exposed
// as executable, and smarts.bio stays empty until its written-authorization
// gate is open.

import {
  PROVIDER_IDS, AVAILABILITY, DISCOVERY_MODE, executableTools,
  normalizeProviderError
} from "./common/contract.js";
import { createAdapter as createGalaxy } from "./galaxy/index.js";
import { createAdapter as createSmartBio } from "./smartsbio/index.js";
import { createAdapter as createNinerouter } from "./ninerouter/index.js";

const FACTORIES = Object.freeze({
  galaxy: createGalaxy,
  smartsbio: createSmartBio,
  ninerouter: createNinerouter
});

export function createRegistry(env = {}, deps = {}) {
  const flags = {};
  const providers = {};
  for (const id of PROVIDER_IDS) {
    const flag = `${id.toUpperCase()}_ENABLED`;
    flags[id] = env?.[flag] === "true";
    providers[id] = FACTORIES[id](env, deps);
  }

  function disabledDescriptor(id) {
    return {
      id,
      enabled: false,
      availability: AVAILABILITY.DISABLED,
      operations: [],
      tools: [],
      discovery_mode: DISCOVERY_MODE.UNAVAILABLE
    };
  }

  const registry = {
    id: () => "registry",

    getProvider(id) {
      return providers[id] ?? null;
    },

    isEnabled(id) {
      return flags[id] === true;
    },

    // Async: capability discovery is metadata-only and network-backed. A
    // disabled provider is returned as a descriptor without any network call.
    async listProviders(ctx = {}) {
      const result = [];
      for (const id of PROVIDER_IDS) {
        if (!flags[id]) { result.push(disabledDescriptor(id)); continue; }
        const descriptor = {
          id,
          enabled: true,
          availability: AVAILABILITY.UNKNOWN,
          operations: [],
          tools: [],
          discovery_mode: DISCOVERY_MODE.UNAVAILABLE
        };
        try {
          const capabilities = await providers[id].getCapabilities(ctx);
          descriptor.availability = capabilities?.availability ?? AVAILABILITY.UNKNOWN;
          descriptor.operations = Array.isArray(capabilities?.operations) ? capabilities.operations : [];
          descriptor.tools = Array.isArray(capabilities?.tools) ? capabilities.tools : [];
          descriptor.discovery_mode = capabilities?.discovery_mode ?? DISCOVERY_MODE.UNAVAILABLE;
        } catch {
          descriptor.availability = AVAILABILITY.UNAVAILABLE;
        }
        result.push(descriptor);
      }
      return result;
    },

    // The single source of truth for "which tools may the platform offer".
    async advertisedTools(ctx = {}) {
      const advertised = [];
      for (const id of PROVIDER_IDS) {
        if (!flags[id]) continue;
        let capabilities;
        try { capabilities = await providers[id].getCapabilities(ctx); }
        catch { continue; }
        for (const tool of executableTools(capabilities)) advertised.push({ ...tool, provider: id });
      }
      return advertised;
    },

    async resolveTool(toolId, ctx = {}) {
      const requested = typeof toolId === "string" ? toolId : "";
      if (!requested) return null;
      let wantedProvider = null;
      let wantedId = requested;
      const separator = requested.indexOf(":");
      if (separator > 0) {
        const candidate = requested.slice(0, separator);
        if (PROVIDER_IDS.includes(candidate)) {
          wantedProvider = candidate;
          wantedId = requested.slice(separator + 1);
        }
      }
      const tools = await registry.advertisedTools(ctx);
      const match = tools.find((tool) => tool.id === wantedId && (!wantedProvider || tool.provider === wantedProvider));
      return match ?? null;
    },

    normalizeError(provider, error, meta = {}) {
      return normalizeProviderError(provider, error, meta);
    }
  };

  return registry;
}

export default createRegistry;
