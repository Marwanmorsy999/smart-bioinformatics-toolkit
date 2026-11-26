// M7.13 interactive protein architecture viewer.
//
// Every coordinate comes from genuine provider evidence. No feature is
// synthesised, merged or shifted. Overlapping matches get separate lanes so
// all source-reported intervals stay visible. The pure model builder is DOM
// free and is used by both the page and offline tests.

const SVG_NS = "http://www.w3.org/2000/svg";

function validInterval(start, end) {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start;
}

/** Deterministic layout from real residue coordinates. */
export function buildViewerModel(annotation, { width = 960, padding = 12, laneHeight = 26 } = {}) {
  const features = Array.isArray(annotation?.features) ? annotation.features : [];
  const length = Number.isInteger(annotation?.protein_length) && annotation.protein_length > 0
    ? annotation.protein_length
    : Math.max(0, ...features.flatMap((feature) => feature.locations.map((location) => location.end ?? 0)));
  const usable = Math.max(1, Number(width) - padding * 2);
  const scale = length > 0 ? usable / length : 0;
  const xFor = (residue) => padding + ((residue - 1) * scale);
  const sorted = [...features].sort((left, right) => {
    const a = left.locations?.[0]?.start ?? Number.MAX_SAFE_INTEGER;
    const b = right.locations?.[0]?.start ?? Number.MAX_SAFE_INTEGER;
    return a - b
      || String(left.source ?? "").localeCompare(String(right.source ?? ""))
      || String(left.signature?.accession ?? "").localeCompare(String(right.signature?.accession ?? ""));
  });
  const laneEnds = [];
  const tracks = [];
  const sites = [];
  let skipped = 0;
  for (const feature of sorted) {
    const intervals = (feature.locations ?? []).filter((location) => validInterval(location.start, location.end));
    if (!intervals.length) { skipped += 1; continue; }
    const isSite = ["site", "conserved_site"].includes(feature.category) || feature.feature_type === "Conserved_site";
    let lane = 0;
    if (!isSite) {
      const firstStart = Math.min(...intervals.map((location) => location.start));
      while (lane < laneEnds.length && laneEnds[lane] >= firstStart) lane += 1;
      laneEnds[lane] = Math.max(...intervals.map((location) => location.end));
    } else {
      lane = laneEnds.length;
    }
    for (const location of intervals) {
      const track = {
        feature, isSite, lane,
        start: location.start, end: location.end,
        x: Number(xFor(location.start).toFixed(2)),
        w: Number(Math.max(1, (location.end - location.start + 1) * scale).toFixed(2)),
        category: feature.category ?? "other",
        source: feature.source ?? null,
        accession: feature.signature?.accession ?? null
      };
      if (isSite) sites.push(track);
      else tracks.push(track);
    }
  }
  const lanes = Math.max(1, ...tracks.map((item) => item.lane + 1), sites.length ? 1 : 0);
  const top = 34;
  const height = top + lanes * laneHeight + 34;
  const ticks = [];
  if (length > 0) {
    const step = length <= 50 ? 10 : length <= 200 ? 50 : length <= 1000 ? 100 : 500;
    for (let residue = 1; residue <= length; residue += step) ticks.push({ residue, x: Number(xFor(residue).toFixed(2)) });
  }
  return {
    protein_length: length || null,
    width: Number(width), height, padding, laneHeight, lanes, scale: Number(scale.toFixed(6)),
    tracks, sites, ticks, skipped_features: skipped,
    basis: "genuine_source_reported_residue_coordinates"
  };
}

function element(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function labelFor(track) {
  const feature = track.feature;
  return `${feature.category ?? "feature"} ${feature.signature?.accession ?? "no accession"} ` +
    `from ${feature.source ?? "unknown source"}, residues ${track.start}-${track.end}` +
    `${feature.entry?.accession ? `, integrated entry ${feature.entry.accession}` : ""}`;
}

/** Render the pure model into an accessible SVG. Returns export helpers. */
export function renderProteinViewer(container, annotation, options = {}) {
  if (!container) return null;
  const model = buildViewerModel(annotation, options);
  const svg = element("svg", {
    viewBox: `0 0 ${model.width} ${model.height}`,
    class: "pv-svg", role: "img",
    "aria-label": model.protein_length
      ? `Protein architecture of ${model.protein_length} residues from source-reported coordinates`
      : "No protein architecture is available"
  });
  const axis = element("line", { x1: model.padding, x2: model.width - model.padding,
    y1: model.height - 24, y2: model.height - 24, class: "pv-axis" });
  svg.append(axis);
  for (const tick of model.ticks) {
    svg.append(element("line", { x1: tick.x, x2: tick.x, y1: model.height - 28, y2: model.height - 20, class: "pv-tick" }));
    const text = element("text", { x: tick.x, y: model.height - 8, class: "pv-label", "text-anchor": "middle" });
    text.textContent = String(tick.residue);
    svg.append(text);
  }
  const addShape = (track) => {
    const y = 34 + track.lane * model.laneHeight;
    const shape = track.isSite
      ? element("line", { x1: track.x, x2: track.x, y1: y, y2: y + model.laneHeight - 6,
        class: `pv-site pv-${track.category}`, tabindex: "0", role: "button", "aria-label": labelFor(track) })
      : element("rect", { x: track.x, y, width: track.w, height: model.laneHeight - 8, rx: 3,
        class: `pv-block pv-${track.category}`, tabindex: "0", role: "button", "aria-label": labelFor(track) });
    const title = element("title");
    title.textContent = labelFor(track);
    shape.append(title);
    const select = () => options.onSelect?.(track.feature, track);
    shape.addEventListener("click", select);
    shape.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
    });
    svg.append(shape);
  };
  for (const track of model.tracks) addShape(track);
  for (const track of model.sites) addShape(track);
  container.replaceChildren(svg);
  if (!model.tracks.length && !model.sites.length) {
    const note = document.createElement("p");
    note.className = "panel-note";
    note.textContent = "No source-reported coordinates are available; no feature is drawn.";
    container.append(note);
  }
  const markup = () => new XMLSerializer().serializeToString(svg);
  return {
    model, svg,
    exportSvg(filename = "protein-architecture.svg") {
      const blob = new Blob([markup()], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL?.(url);
    },
    svgMarkup: markup
  };
}

if (typeof window !== "undefined") {
  window.__proteinViewer = { buildViewerModel, renderProteinViewer };
}
