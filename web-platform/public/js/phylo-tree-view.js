// Dependency-free interactive Newick tree view. Every drawing is derived from
// the genuine `tree_newick` returned by the run endpoint. There are no sample
// trees, no illustrations and no external libraries.
//
// Public API:
//   parseNewick(text)                 -> root node (independent recursive parser)
//   analyzeTree(root)                 -> deterministic topology metrics
//   renderTree(newick, mount, opts)   -> controller { svg, zoom, reset, exports... }

const NS = "http://www.w3.org/2000/svg";
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const SUPPORT_PREFIX = /^(ufboot|sh-?alrt|bootstrap|support|sh)$/i;

function splitLabel(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { name: null, lengthRaw: null };
  const colon = text.lastIndexOf(":");
  if (colon > 0) {
    const name = text.slice(0, colon).trim();
    const tail = text.slice(colon + 1).trim();
    if (SUPPORT_PREFIX.test(name) && NUMBER.test(tail)) return { name: text, lengthRaw: null };
    return { name, lengthRaw: tail };
  }
  return { name: text, lengthRaw: null };
}

export function parseNewick(text) {
  const source = String(text ?? "").trim();
  if (!source) throw new Error("newick: empty input");
  let pos = 0;
  let count = 0;
  const skipWs = () => { while (pos < source.length && /\s/.test(source[pos])) pos += 1; };
  const quoted = (quote) => {
    pos += 1;
    let out = "";
    while (pos < source.length) {
      const char = source[pos++];
      if (char === "\\" && pos < source.length) { out += source[pos++]; continue; }
      if (char === quote) return out;
      out += char;
    }
    throw new Error("newick: unclosed quoted label");
  };
  const label = () => {
    skipWs();
    if (pos >= source.length) return { name: null, lengthRaw: null };
    if (source[pos] === "'" || source[pos] === '"') {
      const name = quoted(source[pos]);
      skipWs();
      let lengthRaw = null;
      if (source[pos] === ":") {
        pos += 1;
        const start = pos;
        while (pos < source.length && !/[\s(),;]/.test(source[pos])) pos += 1;
        lengthRaw = source.slice(start, pos).trim() || null;
      }
      return { name, lengthRaw };
    }
    if ("(),;:".includes(source[pos])) return { name: null, lengthRaw: null };
    const start = pos;
    while (pos < source.length && !/[\s(),;]/.test(source[pos])) pos += 1;
    return splitLabel(source.slice(start, pos));
  };
  const applyLength = (node, raw) => {
    if (!raw) return;
    node.lengthRaw = raw;
    node.length = NUMBER.test(raw) ? Number(raw) : null;
    node.lengthInvalid = !Number.isFinite(node.length) || node.length < 0;
  };
  const node = (depth) => {
    if (++count > 20000) throw new Error("newick: too many nodes");
    const current = { id: count - 1, name: null, labelRaw: null, length: null, lengthRaw: null,
      lengthInvalid: false, children: [], depth, parent: null };
    skipWs();
    if (pos >= source.length) throw new Error("newick: unexpected end of input");
    if (source[pos] === "(") {
      pos += 1;
      while (true) {
        skipWs();
        if (pos >= source.length) throw new Error("newick: unclosed group");
        if (source[pos] === ")") { pos += 1; break; }
        const child = node(depth + 1);
        child.parent = current;
        current.children.push(child);
        skipWs();
        if (source[pos] === ",") { pos += 1; continue; }
        if (source[pos] === ")") { pos += 1; break; }
        throw new Error("newick: expected ',' or ')'");
      }
    }
    const parsed = label();
    current.name = parsed.name;
    current.labelRaw = parsed.name;
    applyLength(current, parsed.lengthRaw);
    skipWs();
    if (!parsed.lengthRaw && source[pos] === ":") {
      pos += 1;
      const start = pos;
      while (pos < source.length && /[-+0-9.eE]/.test(source[pos])) pos += 1;
      applyLength(current, source.slice(start, pos).trim() || null);
    }
    skipWs();
    if (source[pos] === ";") pos += 1;
    return current;
  };
  const root = node(0);
  skipWs();
  if (pos < source.length) throw new Error("newick: trailing content after root");
  const all = [];
  (function walk(current) { all.push(current); for (const child of current.children) walk(child); })(root);
  for (const item of all) item.isTip = item.children.length === 0;
  return root;
}

export function parseSupport(label) {
  const raw = String(label ?? "").trim();
  if (!raw) return { raw, values: [], format: "none" };
  const numbers = (text) => (String(text).match(/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [])
    .map((value) => Number(value)).filter(Number.isFinite);
  const prefix = raw.split(":")[0];
  const after = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const names = prefix.split("/").map((part) => part.trim()).filter(Boolean);
  if (names.some((part) => /[A-Za-z]/.test(part))) {
    const values = numbers(after);
    return { raw, format: values.length ? "named-numeric" : "named-only",
      values: values.map((value, index) => ({ kind: names[index] ?? names[names.length - 1], value })) };
  }
  const values = numbers(raw);
  return { raw, format: values.length > 1 && /[\/,]/.test(raw) ? "slash-separated" : "plain-number",
    values: values.map((value) => ({ kind: "unspecified", value })) };
}

export function analyzeTree(root) {
  if (!root) return { tipCount: 0, internalNodeCount: 0, branchLengthValid: false, rooting: "unknown" };
  const all = [];
  (function walk(current) { all.push(current); for (const child of current.children) walk(child); })(root);
  const tips = all.filter((item) => item.isTip);
  const lengths = all.filter((item) => item !== root && item.lengthRaw !== null);
  const invalid = lengths.some((item) => item.lengthInvalid);
  const missing = all.filter((item) => item !== root && item.lengthRaw === null).length;
  return {
    tipCount: tips.length,
    internalNodeCount: all.length - tips.length,
    branchLengthValid: !invalid,
    branchLengthsComplete: !invalid && missing === 0,
    usableForLengthLayout: !invalid && missing === 0,
    supportCount: all.filter((item) => !item.isTip && parseSupport(item.labelRaw).values.length).length,
    rooting: root.children.length > 2 ? "unrooted-representation" : "unknown (no outgroup declared)"
  };
}

function element(tag, attributes = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function download(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking on the next task keeps the download alive in Chromium.
  queueMicrotask(() => URL.revokeObjectURL(url));
}

function emptyController(mount, message) {
  mount.replaceChildren();
  const notice = document.createElement("p");
  notice.className = "phylo-tree-empty";
  notice.textContent = message;
  mount.append(notice);
  return { ok: false, svg: null, zoom: () => {}, reset: () => {},
    setHighlight: () => {}, exportNewick: () => {}, exportSvg: () => {},
    exportAlignment: () => {}, exportReport: () => {}, destroy: () => {} };
}

export function renderTree(newick, mount, options = {}) {
  if (!mount) throw new Error("renderTree requires a mount element");
  const treeText = String(newick ?? "").trim();
  if (!treeText) return emptyController(mount, "No tree is available from this run. Nothing is drawn.");
  let root;
  try {
    root = parseNewick(treeText);
  } catch (error) {
    return emptyController(mount, `The returned Newick text could not be parsed (${error?.message ?? error}). No tree is drawn.`);
  }
  const all = [];
  (function walk(node) { all.push(node); for (const child of node.children) walk(child); })(root);
  const tips = all.filter((node) => node.isTip);
  if (!tips.length) return emptyController(mount, "The returned Newick text contains no taxa. No tree is drawn.");

  const metrics = analyzeTree(root);
  const supplied = options.metrics?.tree ?? null;
  const lengthAware = Boolean(supplied?.usable_for_length_layout ?? metrics.usableForLengthLayout)
    && supplied?.branch_length_nonnegative !== false;
  const rowHeight = 30;
  const height = Math.max(140, tips.length * rowHeight + 30);
  let tipIndex = 0;
  (function placeY(node) {
    if (node.isTip) {
      node._y = 20 + (tipIndex + 0.5) * rowHeight;
      tipIndex += 1;
    } else {
      for (const child of node.children) placeY(child);
      node._y = (node.children[0]._y + node.children[node.children.length - 1]._y) / 2;
    }
  })(root);
  const step = 100;
  (function placeX(node) {
    if (lengthAware && node !== root && Number.isFinite(node.length)) {
      node._x = (node.parent._x ?? 20) + Math.max(node.length, 0) * step;
    } else {
      node._x = (node.parent ? node.parent._x : 0) + step;
    }
    for (const child of node.children) placeX(child);
  })(root);
  const maxX = Math.max(...all.map((node) => node._x));
  const width = Math.max(420, Math.ceil(maxX + 190));

  const svg = element("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%",
    height: String(height), role: "img", "aria-label": "Phylogenetic tree rendered from the run's Newick text" });
  const viewport = element("g", { class: "phylo-viewport" });
  svg.append(viewport);
  const tipNodes = new Map();
  const internals = [];
  (function draw(node) {
    for (const child of node.children) {
      viewport.append(element("line", { x1: node._x, y1: child._y, x2: child._x, y2: child._y,
        class: "phylo-branch" }));
      draw(child);
    }
    if (!node.isTip) {
      const first = node.children[0];
      const last = node.children[node.children.length - 1];
      if (Math.abs(first._y - last._y) > 0.5) {
        viewport.append(element("line", { x1: node._x, y1: first._y, x2: node._x, y2: last._y,
          class: "phylo-branch" }));
      }
      const support = parseSupport(node.labelRaw);
      if (support.values.length) {
        const label = element("text", { x: node._x + 4, y: node._y - 5, class: "phylo-support" });
        label.textContent = support.values.map((entry) => entry.value).join("/");
        const title = element("title");
        title.textContent = `${support.raw} (${support.format})`;
        label.append(title);
        viewport.append(label);
        internals.push({ node, label });
      }
      const dot = element("circle", { cx: node._x, cy: node._y, r: 3, class: "phylo-node" });
      dot.dataset.nodeId = String(node.id);
      viewport.append(dot);
    } else {
      const text = element("text", { x: node._x + 7, y: node._y + 4, class: "phylo-tip" });
      text.textContent = node.name ?? "";
      const title = element("title");
      title.textContent = node.name ?? "unnamed tip";
      text.append(title);
      const tipGroup = element("g", { class: "phylo-tip-group" });
      tipGroup.append(text);
      tipGroup.addEventListener("click", () => {
        options.onSelect?.({ kind: "tip", name: node.name, branch_length: node.length, node_id: node.id });
      });
      viewport.append(tipGroup);
      tipNodes.set(node.name, text);
    }
  })(root);

  const wrap = document.createElement("div");
  wrap.className = "phylo-tree-wrap";
  const toolbar = document.createElement("div");
  toolbar.className = "phylo-tree-toolbar";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Tree zoom controls");
  for (const [action, label] of [["zoom-in", "Zoom in"], ["zoom-out", "Zoom out"], ["reset", "Reset view"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.textContent = label;
    button.setAttribute("aria-label", label);
    toolbar.append(button);
  }
  const rooting = document.createElement("p");
  rooting.className = "phylo-rooting";
  const rootingStatus = supplied?.rooting?.status ?? metrics.rooting;
  const rootingBasis = supplied?.rooting?.basis ?? "";
  rooting.textContent = `Rooting status: ${rootingStatus}${rootingBasis ? ` — ${rootingBasis}` : ""}`;
  const mode = document.createElement("p");
  mode.className = "phylo-layout-mode";
  mode.textContent = lengthAware ? "Layout: branch-length aware (all branch lengths finite and non-negative)."
    : "Layout: cladogram; branch lengths are missing, non-finite or negative and are not used for spacing.";
  const inspector = options.inspector ?? document.createElement("div");
  if (!inspector.className) inspector.className = "phylo-inspector";
  inspector.textContent = "Select a taxon or internal node to inspect it.";
  wrap.append(toolbar, mode, rooting, svg, inspector);
  mount.replaceChildren(wrap);

  let scale = 1;
  let tx = 0;
  let ty = 0;
  const applyTransform = () => viewport.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
  const zoom = (factor) => {
    scale = Math.min(6, Math.max(0.4, Math.round(scale * factor * 100) / 100));
    applyTransform();
  };
  const reset = () => { scale = 1; tx = 0; ty = 0; applyTransform(); };
  toolbar.addEventListener("click", (event) => {
    const action = event.target?.dataset?.action;
    if (action === "zoom-in") zoom(1.25);
    if (action === "zoom-out") zoom(0.8);
    if (action === "reset") reset();
  });
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.1 : 0.9);
  }, { passive: false });
  let drag = null;
  svg.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY, tx, ty };
    svg.setPointerCapture?.(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    tx = drag.tx + (event.clientX - drag.x);
    ty = drag.ty + (event.clientY - drag.y);
    applyTransform();
  });
  svg.addEventListener("pointerup", () => { drag = null; });

  const setHighlight = ({ queryTaxon = null, referenceTaxa = [] } = {}) => {
    const query = String(queryTaxon ?? "").trim();
    const references = new Set((referenceTaxa ?? []).map((name) => String(name).trim()).filter(Boolean));
    for (const [name, text] of tipNodes) {
      text.classList.toggle("is-query", Boolean(query) && name === query);
      text.classList.toggle("is-reference", references.has(name));
    }
  };
  setHighlight(options);

  return {
    ok: true, svg, root, metrics, lengthAware, zoom, reset, setHighlight,
    exportNewick: (filename = "phylo-tree.nwk") => download(treeText, filename, "text/plain;charset=utf-8"),
    exportSvg: (filename = "phylo-tree.svg") => {
      const clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", NS);
      download(new XMLSerializer().serializeToString(clone), filename, "image/svg+xml;charset=utf-8");
    },
    exportAlignment: (fasta, filename = "phylo-alignment.fasta") => {
      const text = String(fasta ?? "");
      if (!text.trim()) return false;
      download(text, filename, "text/plain;charset=utf-8");
      return true;
    },
    exportReport: (report, filename = "phylo-analysis.json") => {
      const text = typeof report === "string" ? report : JSON.stringify(report, null, 2);
      download(text, filename, "application/json;charset=utf-8");
    },
    destroy: () => { mount.replaceChildren(); }
  };
}
