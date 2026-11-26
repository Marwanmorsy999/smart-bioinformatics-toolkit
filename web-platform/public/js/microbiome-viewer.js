// M7.14 pure view renderers. Every point, bar and cell comes from data passed
// in by the controller; nothing here synthesises a measurement. The SVG PCoA
// is drawn from REAL coordinates and coloured only by supplied metadata.

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

export function renderTable(container, columns, rows, { empty = "No data available." } = {}) {
  if (!container) return null;
  if (!rows?.length) { container.textContent = empty; return null; }
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = column.label ?? column.key;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
      const value = row[column.key];
      if (column.numeric) { td.className = "number"; td.textContent = value === null || value === undefined ? "—" : String(value); }
      else td.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  container.replaceChildren(table);
  return table;
}

export function renderComposition(container, composition, { rank = "phylum" } = {}) {
  if (!container) return null;
  if (!composition?.available || !composition.samples?.length) {
    container.textContent = composition?.reason ?? "No composition data is available.";
    return null;
  }
  const rows = [];
  for (const sample of composition.samples) {
    for (const taxon of sample.taxa ?? []) {
      rows.push({ sample: sample.sample_id, taxon: taxon.taxon, count: taxon.count,
        fraction: typeof taxon.fraction === "number" ? `${(taxon.fraction * 100).toFixed(2)}%` : "—",
        total: sample.total });
    }
  }
  renderTable(container, [
    { key: "sample", label: "Sample" }, { key: "taxon", label: composition.rank ?? rank },
    { key: "count", label: "Reads", numeric: true }, { key: "fraction", label: "Relative" },
    { key: "total", label: "Sample total", numeric: true }
  ], rows);
  return rows;
}

export function renderCompositionChart(container, composition, { sample = null } = {}) {
  if (!container) return null;
  const samples = composition?.samples ?? [];
  const chosen = samples.find((item) => item.sample_id === sample) ?? samples[0] ?? null;
  if (!chosen?.taxa?.length) {
    container.textContent = composition?.reason ?? "No composition bars are available.";
    return null;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "composition-chart";
  const heading = document.createElement("p");
  heading.className = "panel-note";
  heading.textContent = `Sample ${chosen.sample_id} · ${chosen.total} assigned reads · rank ${composition.rank ?? "phylum"}`;
  wrapper.append(heading);
  for (const taxon of chosen.taxa.slice(0, 20)) {
    const row = document.createElement("div");
    row.className = "bar-row";
    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = taxon.taxon;
    const track = document.createElement("span");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    fill.style.width = `${Math.max(0, Math.min(100, (taxon.fraction ?? 0) * 100))}%`;
    track.append(fill);
    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = `${((taxon.fraction ?? 0) * 100).toFixed(1)}%`;
    row.append(label, track, value);
    wrapper.append(row);
  }
  container.replaceChildren(wrapper);
  return wrapper;
}

const PALETTE = ["#0b6b78", "#7b3fa1", "#c2691b", "#2f7d32", "#b33158", "#1565c0", "#8d6e63", "#546e7a"];

export function renderPcoa(container, pcoa, metadata = [], { colorBy = "" } = {}) {
  if (!container) return null;
  if (!pcoa?.available || !pcoa.coordinates?.length) {
    container.textContent = pcoa?.reason ?? "No PCoA coordinates were retrieved; no points are drawn.";
    return null;
  }
  const axes = (pcoa.axes ?? Object.keys(pcoa.coordinates[0]?.values ?? {})).slice(0, 2);
  if (axes.length < 2) {
    container.textContent = "Fewer than two PCoA axes were reported; a 2D plot cannot be drawn.";
    return null;
  }
  const values = pcoa.coordinates
    .map((entry) => ({ sample: entry.sample_id, x: entry.values?.[axes[0]], y: entry.values?.[axes[1]] }))
    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));
  if (!values.length) {
    container.textContent = "The stored PCoA coordinates contain no finite values; no points are drawn.";
    return null;
  }
  const minX = Math.min(...values.map((entry) => entry.x));
  const maxX = Math.max(...values.map((entry) => entry.x));
  const minY = Math.min(...values.map((entry) => entry.y));
  const maxY = Math.max(...values.map((entry) => entry.y));
  const width = 640;
  const height = 420;
  const pad = 46;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const sx = (value) => pad + ((value - minX) / spanX) * (width - pad * 2);
  const sy = (value) => height - pad - ((value - minY) / spanY) * (height - pad * 2);
  const metaById = new Map(metadata.map((row) => [row.sample_id ?? row["sample-id"], row]));
  const categoryOf = (sample) => (colorBy ? metaById.get(sample)?.[colorBy] : null) ?? "Unlabelled";
  const categories = [...new Set(values.map((entry) => categoryOf(entry.sample)))].sort();
  const colorOf = (category) => PALETTE[categories.indexOf(category) % PALETTE.length];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `PCoA ${axes[0]} versus ${axes[1]} from ${values.length} stored sample coordinates`);
  const ns = "http://www.w3.org/2000/svg";
  const addLine = (x1, y1, x2, y2) => {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", "#9aa5af"); line.setAttribute("stroke-width", "1");
    svg.append(line);
  };
  addLine(pad, height - pad, width - pad, height - pad);
  addLine(pad, pad, pad, height - pad);
  const axisLabelX = document.createElementNS(ns, "text");
  axisLabelX.setAttribute("x", width / 2); axisLabelX.setAttribute("y", height - 12);
  axisLabelX.setAttribute("text-anchor", "middle"); axisLabelX.textContent = axes[0];
  const axisLabelY = document.createElementNS(ns, "text");
  axisLabelY.setAttribute("x", 12); axisLabelY.setAttribute("y", height / 2);
  axisLabelY.setAttribute("text-anchor", "middle"); axisLabelY.setAttribute("transform", `rotate(-90 12 ${height / 2})`);
  axisLabelY.textContent = axes[1];
  svg.append(axisLabelX, axisLabelY);
  for (const entry of values) {
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", sx(entry.x)); circle.setAttribute("cy", sy(entry.y));
    circle.setAttribute("r", "5"); circle.setAttribute("fill", colorOf(categoryOf(entry.sample)));
    const title = document.createElementNS(ns, "title");
    title.textContent = `${entry.sample} · ${axes[0]} ${entry.x} · ${axes[1]} ${entry.y} · ${colorBy ? `${colorBy}=${categoryOf(entry.sample)}` : "no metadata colour"}`;
    circle.append(title);
    svg.append(circle);
  }
  container.replaceChildren(svg);
  return { svg, categories, axes };
}

export function renderDistance(container, distance, { limit = 12 } = {}) {
  if (!container) return null;
  if (!distance?.available) { container.textContent = distance?.reason ?? "No distance matrix is available."; return null; }
  const columns = [{ key: "sample", label: "Sample" },
    ...distance.samples.slice(0, limit).map((sample) => ({ key: sample, label: sample, numeric: true }))];
  const rows = distance.samples.slice(0, limit).map((sample, index) => {
    const row = { sample };
    distance.samples.slice(0, limit).forEach((other, otherIndex) => {
      row[other] = distance.matrix?.[index]?.[otherIndex] ?? null;
    });
    return row;
  });
  renderTable(container, columns, rows, { empty: "No distance rows were retrieved." });
  return rows;
}

export function renderAlpha(container, alpha) {
  if (!container) return null;
  return renderTable(container, [
    { key: "sample_id", label: "Sample" },
    { key: "observed_features", label: "Observed features", numeric: true },
    { key: "shannon", label: "Shannon", numeric: true },
    { key: "faith_pd", label: "Faith's PD", numeric: true }
  ], alpha?.samples ?? [], { empty: alpha?.reason ?? "No alpha diversity values are available." });
}

export function renderQc(container, qc) {
  if (!container) return null;
  if (qc?.samples?.length) {
    return renderTable(container, [
      { key: "sample_id", label: "Sample" },
      { key: "read_count", label: "Reads", numeric: true }
    ], qc.samples, { empty: "No per-sample QC rows." });
  }
  const raw = qc?.reads ?? null;
  container.textContent = raw
    ? `Raw uploaded reads: ${raw.read_count} records, ${raw.total_bases} bases, lengths ${raw.min_length}–${raw.max_length} bp. Source: ${qc.basis ?? "worker"}. ${qc.reason ?? ""}`
    : (qc?.reason ?? "No QC summary is available.");
  return null;
}

export function renderNotes(container, notes = []) {
  if (!container) return null;
  const list = document.createElement("ul");
  list.className = "note-list";
  for (const note of notes) {
    const item = document.createElement("li");
    item.textContent = typeof note === "string" ? note : (note.reason ?? note.step ?? JSON.stringify(note));
    list.append(item);
  }
  if (!notes.length) list.append(Object.assign(document.createElement("li"), { textContent: "No limitations were reported." }));
  container.replaceChildren(list);
  return list;
}

export const MICROBIOME_VIEWER_VERSION = "1.0.0-m7.14";
