// M7 cloud service transparency panel.
// No network call is made until the visitor clicks "Check cloud services".
// All text is rendered with textContent: provider data is untrusted.

const button = document.getElementById("check-cloud");
const statusLine = document.getElementById("cloud-status");
const providerList = document.getElementById("cloud-providers");
const transferList = document.getElementById("cloud-transfer-list");

function renderProviders(providers) {
  providerList.replaceChildren();
  for (const provider of providers) {
    const row = document.createElement("div");
    row.className = "step-item";
    const name = document.createElement("strong");
    name.textContent = provider.id;
    const availability = document.createElement("span");
    availability.textContent = ` — ${provider.availability}`;
    const detail = document.createElement("p");
    const executable = Array.isArray(provider.tools) ? provider.tools.length : 0;
    const mode = provider.discovery_mode || "unavailable";
    detail.textContent = `Enabled: ${provider.enabled ? "yes" : "no"} · executable tools: ${executable} · discovery: ${mode}`;
    const health = document.createElement("p");
    health.className = "results-note";
    health.textContent = provider.health?.error
      ? `Health: ${provider.health.error}`
      : provider.id === "smartsbio"
        ? "Public API access is disabled pending written provider authorization."
        : "No provider text is treated as a scientific conclusion.";
    row.append(name, availability, detail, health);
    providerList.appendChild(row);
  }
}

function renderTransfers(transfers) {
  if (!Array.isArray(transfers) || transfers.length === 0) {
    transferList.textContent = "No recorded external transfers.";
    return;
  }
  transferList.replaceChildren();
  for (const transfer of transfers) {
    const line = document.createElement("p");
    line.textContent = `${transfer.created_at} · ${transfer.source} → ${transfer.destination} · ${transfer.byte_count} bytes · consent ${transfer.consent_id ?? "none"} · ${transfer.status}`;
    transferList.appendChild(line);
  }
}

async function check() {
  if (!button || !statusLine) return;
  button.disabled = true;
  statusLine.textContent = "Checking registered cloud services…";
  try {
    const [providersResponse, transfersResponse] = await Promise.all([
      fetch("/api/providers", { headers: { Accept: "application/json" } }),
      fetch("/api/providers/transfers", { headers: { Accept: "application/json" } })
    ]);
    if (!providersResponse.ok) throw new Error(`Provider status request failed (${providersResponse.status}).`);
    const providersBody = await providersResponse.json();
    renderProviders(providersBody.providers ?? []);
    if (transfersResponse.ok) {
      const transfersBody = await transfersResponse.json();
      renderTransfers(transfersBody.transfers ?? []);
    } else {
      transferList.textContent = "Transfer ledger requires operator authorization.";
    }
    statusLine.textContent = providersBody.execution_mode === "mock"
      ? "Mock mode: these services are not executing real jobs."
      : "Cloud service status checked. Files leave the platform only with explicit, dataset-scoped consent.";
  } catch (error) {
    statusLine.textContent = `Cloud status unavailable: ${error?.message ?? error}`;
  } finally {
    button.disabled = false;
  }
}

button?.addEventListener("click", check);
