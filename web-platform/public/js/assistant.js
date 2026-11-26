/* S Bio Assistant — UI controller.
   UI-only: no provider is contacted from the browser and no text is invented.
   Every rendered assistant message comes from a real gateway response object.
   Untrusted text is written with textContent / DOM APIs only (never innerHTML). */
(() => {
  "use strict";

  const MAX_CHARS = 4000;
  const MAX_HISTORY = 8;
  const BANNER_TEXT = "AI chat is unavailable: no authorized model provider is configured for this deployment.";
  const PUBLIC_ID = /^(proj|ds)_[0-9a-f]{16}$/;

  const byId = (id) => document.getElementById(id);
  const ui = {
    shell: document.querySelector(".assistant-shell"),
    badge: byId("assistant-backend-badge"),
    banner: byId("assistant-banner"),
    bannerDetail: byId("assistant-banner-detail"),
    activity: byId("activity-list"),
    sidebarToggle: byId("sidebar-toggle"),
    sidebar: byId("assistant-sidebar"),
    newConversation: byId("new-conversation"),
    search: byId("conversation-search"),
    list: byId("conversation-list"),
    empty: byId("conversation-empty"),
    context: byId("project-context-input"),
    removeContext: byId("remove-context"),
    current: byId("current-conversation"),
    clearAll: byId("clear-conversations"),
    panelState: byId("assistant-state"),
    timeline: byId("message-list"),
    capabilityStatus: byId("capability-status"),
    capabilityVersion: byId("capability-version"),
    catalogList: byId("tool-catalog-list"),
    catalogReload: byId("catalog-reload"),
    planSelect: byId("plan-tool-select"),
    planOutput: byId("plan-output"),
    activeContext: byId("active-context"),
    error: byId("assistant-error"),
    form: byId("composer"),
    input: byId("message-input"),
    clearDraft: byId("clear-draft"),
    help: byId("composer-help"),
    count: byId("char-count"),
    stop: byId("stop-generation"),
    send: byId("send-message"),
    dialog: byId("assistant-dialog"),
    dialogTitle: byId("dialog-title"),
    dialogMessage: byId("dialog-message"),
    dialogField: byId("dialog-field"),
    dialogInput: byId("dialog-input")
  };

  const state = {
    available: false,
    reason: "no_enabled_llm_provider",
    provider: null,
    model: null,
    conversations: [],
    activeId: null,
    inFlight: false,
    controller: null,
    lastRequest: null,
    projectContext: "",
    catalog: [],
    catalogVersion: null,
    selectedToolId: null
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  // Keep the decorative status dot in the badge while replacing only its text.
  function setBadgeText(text) {
    const dot = ui.badge.querySelector(".status-dot");
    ui.badge.replaceChildren();
    if (dot) ui.badge.append(dot);
    ui.badge.append(document.createTextNode(` ${String(text)}`));
  }

  function activeConversation() {
    return state.conversations.find((item) => item.id === state.activeId) ?? null;
  }

  function nowIso() { return new Date().toISOString(); }

  function timeLabel(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "time unavailable" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function relativeLabel(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "unknown time";
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  function setError(message) {
    ui.error.textContent = message ? String(message).slice(0, 500) : "";
    ui.error.hidden = !message;
  }

  function setPanelState(text) {
    ui.panelState.textContent = text;
  }

  // -------------------------------------------------------------- sidebar
  function setSidebar(open) {
    ui.shell.dataset.sidebarOpen = String(open);
    ui.sidebarToggle.setAttribute("aria-expanded", String(open));
    ui.sidebarToggle.setAttribute("aria-label", open ? "Close conversations" : "Open conversations");
  }

  function newConversation() {
    const existing = activeConversation();
    if (existing && existing.messages.length === 0) {
      selectConversation(existing.id);
      return existing;
    }
    const conversation = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: "New conversation",
      messages: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.conversations.unshift(conversation);
    selectConversation(conversation.id);
    return conversation;
  }

  function selectConversation(id) {
    state.activeId = id;
    renderConversations();
    renderTimeline();
    if (window.matchMedia("(max-width: 980px)").matches) setSidebar(false);
  }

  function titleFor(conversation) {
    const first = conversation.messages.find((message) => message.role === "user");
    if (!first) return "New conversation";
    const title = String(first.text ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
    return title || "New conversation";
  }

  function iconButton(label, text, handler) {
    const button = element("button", "", text);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", handler);
    return button;
  }

  function renderConversations() {
    const query = ui.search.value.trim().toLowerCase();
    const visible = state.conversations.filter((conversation) => {
      if (!query) return true;
      const haystack = [titleFor(conversation), ...conversation.messages.map((m) => m.text ?? "")].join(" ").toLowerCase();
      return haystack.includes(query);
    });

    ui.list.replaceChildren();
    for (const conversation of visible) {
      const item = element("li", "conversation-item");
      if (conversation.id === state.activeId) item.setAttribute("aria-current", "page");

      const main = element("div");
      const title = element("button", "conversation-title", titleFor(conversation));
      title.type = "button";
      title.setAttribute("aria-label", `Open conversation: ${titleFor(conversation)}`);
      title.addEventListener("click", () => selectConversation(conversation.id));
      const meta = element("span", "conversation-meta", `${relativeLabel(conversation.updatedAt)} · ${conversation.messages.length} message${conversation.messages.length === 1 ? "" : "s"}`);
      main.append(title, meta);

      const actions = element("div", "conversation-actions");
      actions.append(
        iconButton(`Search for ${titleFor(conversation)}`, "Search", () => {
          ui.search.value = titleFor(conversation);
          renderConversations();
          ui.search.focus();
        }),
        iconButton(`Rename ${titleFor(conversation)}`, "Rename", () => renameConversation(conversation)),
        iconButton(`Delete ${titleFor(conversation)}`, "Delete", () => deleteConversation(conversation))
      );
      item.append(main, actions);
      ui.list.append(item);
    }

    const none = visible.length === 0;
    ui.empty.hidden = !none;
    ui.empty.textContent = query
      ? "No conversations match this search. Nothing was deleted from any server."
      : "No conversations yet. Nothing has been stored on a server.";

    const active = activeConversation();
    ui.current.textContent = active
      ? `Current conversation: ${titleFor(active)} — ${active.messages.length} message${active.messages.length === 1 ? "" : "s"}, this tab only`
      : "Current conversation: none — no messages";
  }

  // ----------------------------------------------------- modal confirmations
  function openDialog({ title, message, withField = false, value = "", focusReturn, onConfirm }) {
    ui.dialogTitle.textContent = title;
    ui.dialogMessage.textContent = message;
    ui.dialogField.hidden = !withField;
    ui.dialogInput.value = value;
    ui.dialog.returnValue = "";
    ui.dialog.showModal();
    (withField ? ui.dialogInput : ui.dialog.querySelector("#dialog-confirm")).focus();
    ui.dialog.addEventListener("close", () => {
      const confirmed = ui.dialog.returnValue === "confirm";
      if (confirmed) onConfirm(ui.dialogInput.value.trim());
      if (focusReturn && typeof focusReturn.focus === "function") focusReturn.focus();
    }, { once: true });
  }

  function renameConversation(conversation, focusReturn) {
    openDialog({
      title: "Rename conversation",
      message: "This title is stored only in this browser tab. No server record is created.",
      withField: true,
      value: titleFor(conversation),
      focusReturn: focusReturn ?? ui.list.querySelector("button"),
      onConfirm: (value) => {
        if (!value) return;
        conversation.title = value.slice(0, 80);
        conversation.updatedAt = nowIso();
        renderConversations();
      }
    });
  }

  function deleteConversation(conversation, focusReturn) {
    openDialog({
      title: "Delete conversation?",
      message: "This conversation is stored only in this browser; it cannot be recovered. No server-side copy exists.",
      focusReturn: focusReturn ?? ui.list.querySelector("button"),
      onConfirm: () => {
        state.conversations = state.conversations.filter((item) => item.id !== conversation.id);
        if (state.activeId === conversation.id) {
          state.activeId = state.conversations[0]?.id ?? null;
          if (!state.activeId) newConversation();
        }
        renderConversations();
        renderTimeline();
      }
    });
  }

  // ------------------------------------------------------------- markdown
  // Tiny renderer: block lines + inline tokens. All content is DOM/text nodes.
  function safeUrl(raw) {
    const url = String(raw).trim();
    if (!url || /[\u0000-\u001f\u007f]/.test(url)) return null;
    if (/^(https?:\/\/|\/|#|\.\/|\.\.\/)/i.test(url)) return url;
    return null;
  }

  function appendInline(text, target) {
    const source = String(text ?? "");
    const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
    let cursor = 0;
    for (const match of source.matchAll(pattern)) {
      if (match.index > cursor) target.append(document.createTextNode(source.slice(cursor, match.index)));
      const token = match[0];
      if (token.startsWith("`")) {
        target.append(element("code", "inline-code", token.slice(1, -1)));
      } else if (token.startsWith("[")) {
        const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
        const label = parts ? parts[1] : token;
        const href = parts ? safeUrl(parts[2]) : null;
        if (href) {
          const link = element("a", "", label);
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer nofollow";
          target.append(link);
        } else {
          target.append(document.createTextNode(label));
        }
      } else if (token.startsWith("**")) {
        target.append(element("strong", "", token.slice(2, -2)));
      } else {
        target.append(element("em", "", token.slice(1, -1)));
      }
      cursor = match.index + token.length;
    }
    if (cursor < source.length) target.append(document.createTextNode(source.slice(cursor)));
  }

  function splitCells(line) {
    return String(line).trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  }

  function isTableDivider(line) {
    if (!line || !line.includes("|")) return false;
    const cells = splitCells(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function appendCodeBlock(target, code, language) {
    const wrapper = element("div", "code-block");
    const head = element("div", "code-block-head");
    head.append(element("span", "", language || "Code / sequence"));
    const copy = element("button", "", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(code, copy));
    head.append(copy);
    wrapper.append(head);

    const pre = element("pre");
    const codeNode = element("code", "", code);
    pre.append(codeNode);
    if (code.length > 240) {
      const details = element("details");
      details.append(element("summary", "", `Show full block (${code.length} characters)`), pre);
      wrapper.append(details);
    } else {
      wrapper.append(pre);
    }
    target.append(wrapper);
  }

  function appendTable(target, lines, start) {
    const cells = splitCells(lines[start]);
    const divider = splitCells(lines[start + 1]);
    const scroll = element("div", "table-scroll");
    const table = element("table");
    const thead = element("thead");
    const headRow = element("tr");
    cells.forEach((label, index) => {
      const th = element("th", "", label);
      th.scope = "col";
      if (divider[index] === ":---") th.style.textAlign = "left";
      if (divider[index] === "---:") th.style.textAlign = "right";
      headRow.append(th);
    });
    thead.append(headRow);
    const tbody = element("tbody");
    let cursor = start + 2;
    while (cursor < lines.length && lines[cursor].trim() && lines[cursor].includes("|")) {
      const row = element("tr");
      for (const cell of splitCells(lines[cursor])) row.append(element("td", "", cell));
      tbody.append(row);
      cursor += 1;
    }
    table.append(thead, tbody);
    scroll.append(table);
    target.append(scroll);
    return cursor;
  }

  function renderMarkdown(text, target) {
    const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
    const paragraph = [];
    const flush = () => {
      if (paragraph.length === 0) return;
      const p = element("p");
      appendInline(paragraph.join(" "), p);
      target.append(p);
      paragraph.length = 0;
    };

    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (/^```/.test(trimmed)) {
        flush();
        const language = trimmed.slice(3).trim();
        const code = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index].trim())) {
          code.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        appendCodeBlock(target, code.join("\n"), language);
        continue;
      }
      if (!trimmed) { flush(); index += 1; continue; }

      const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (heading) {
        flush();
        const level = Math.min(heading[1].length + 2, 6);
        const node = element(`h${level}`);
        appendInline(heading[2], node);
        target.append(node);
        index += 1;
        continue;
      }
      if (trimmed.includes("|") && isTableDivider(lines[index + 1] ?? "")) {
        flush();
        index = appendTable(target, lines, index);
        continue;
      }
      if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
        flush();
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const list = element(ordered ? "ol" : "ul");
        while (index < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index])) {
          const content = lines[index].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
          const li = element("li");
          appendInline(content, li);
          list.append(li);
          index += 1;
        }
        target.append(list);
        continue;
      }
      paragraph.push(trimmed);
      index += 1;
    }
    flush();
  }

  // ----------------------------------------------------- scientific cards
  // Only ever called for a real response object. No card is synthesized.
  function renderResultCard(card) {
    if (!card || typeof card !== "object" || Array.isArray(card)) return null;
    const root = element("article", "result-card");
    root.append(element("h4", "", "Scientific result — unverified phrasing"));
    const sections = [
      ["Explanation", card.explanation],
      ["Workflow", card.workflow],
      ["Inputs", card.inputs],
      ["Parameters", card.parameters],
      ["Evidence", card.evidence],
      ["Limitations", card.limitations],
      ["Next step", card.next_step]
    ];
    let count = 0;
    for (const [label, value] of sections) {
      if (value === undefined || value === null || value === "") continue;
      const section = element("div", "result-section");
      section.append(element("h5", "", label));
      if (Array.isArray(value)) {
        const list = element("ul");
        for (const entry of value) list.append(element("li", "", entry));
        section.append(list);
      } else {
        section.append(element("p", "", value));
      }
      root.append(section);
      count += 1;
    }
    if (count === 0) return null;
    const note = element("div", "result-section");
    note.append(element("p", "", "AI-generated phrasing only. No scientific measurement or citation is asserted. No execution, approval or consent was performed from this conversation."));
    root.append(note);
    return root;
  }

  async function copyText(text, button) {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(String(text));
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
    button.addEventListener("click", () => { button.textContent = original; }, { once: true });
  }

  // ---------------------------------------------------------------- timeline
  function renderTimeline() {
    ui.timeline.replaceChildren();
    const conversation = activeConversation();
    const messages = conversation ? conversation.messages : [];

    for (const message of messages) {
      const role = ["assistant", "user", "system"].includes(message.role) ? message.role : "system";
      const item = element("li", `message message-${role}`);
      const avatar = role === "assistant"
        ? Object.assign(element("img", "message-avatar"), { src: "brand/sbio-assistant.svg", alt: "" })
        : element("span", "message-avatar message-avatar-user", "You");
      if (role === "assistant") avatar.setAttribute("aria-hidden", "true");

      const main = element("div", "message-main");
      const meta = element("div", "message-meta");
      meta.append(
        element("span", "message-name", role === "assistant" ? "S Bio Assistant said" : role === "user" ? "You said" : "Session note"),
        element("time", "", timeLabel(message.at))
      );
      const content = element("div", "message-content md");
      if (message.text !== undefined) renderMarkdown(message.text, content);
      if (message.card) {
        const card = renderResultCard(message.card);
        if (card) content.append(card);
      }
      main.append(meta, content);

      const actions = element("div", "message-actions");
      const copy = element("button", "", "Copy");
      copy.type = "button";
      copy.addEventListener("click", () => copyText(message.text ?? "", copy));
      actions.append(copy);
      if (role === "user") {
        const retry = element("button", "", "Retry");
        retry.type = "button";
        retry.setAttribute("aria-label", "Retry the same request");
        retry.addEventListener("click", () => sendMessage(message.text ?? ""));
        actions.append(retry);
      }
      main.append(actions);
      item.append(avatar, main);
      ui.timeline.append(item);
    }
    if (messages.length) ui.timeline.scrollTop = ui.timeline.scrollHeight;
  }

  function addMessage(role, text, extra = {}) {
    const conversation = activeConversation() ?? newConversation();
    conversation.messages.push({ role, text, at: nowIso(), ...extra });
    conversation.title = titleFor(conversation);
    conversation.updatedAt = nowIso();
    renderConversations();
    renderTimeline();
  }

  function markStage(id) {
    for (const stage of ui.activity.querySelectorAll(".activity-stage")) {
      stage.dataset.state = stage.dataset.stage === id ? "active" : "not-started";
      const label = stage.querySelector(".stage-state");
      if (label) label.textContent = stage.dataset.state === "active" ? "Observed" : "Not started";
    }
  }

  // ------------------------------------------------- capability catalog
  // The catalog is read-only data from /api/tools/catalog. Nothing here can
  // start a job, grant consent, or turn a plan draft into an approval.
  const stringList = (values) => (Array.isArray(values)
    ? values.filter((value) => typeof value === "string" && value.trim())
    : []);

  function appendField(parent, label, values) {
    const items = stringList(values);
    if (items.length === 0) return;
    const field = element("div", "catalog-field");
    field.append(element("h5", "", label));
    const list = element("ul");
    for (const item of items) list.append(element("li", "", item));
    field.append(list);
    parent.append(field);
  }

  function renderActiveContext() {
    const parts = [];
    if (state.projectContext) parts.push(`Project/dataset: ${state.projectContext}`);
    if (state.selectedToolId) parts.push(`Workflow: ${state.selectedToolId}`);
    ui.activeContext.textContent = parts.length
      ? `Active context: ${parts.join(" · ")} (ids only — no dataset bytes are fetched or sent).`
      : "Active context: none — select a project or dataset id in the sidebar and a capability above.";
  }

  function renderCatalog() {
    ui.catalogList.replaceChildren();
    const empty = element("option", "", "Select a capability…");
    empty.value = "";
    const options = [empty];
    for (const entry of state.catalog) {
      const option = element("option", "", `${entry.id} — ${entry.availability}`);
      option.value = entry.id;
      options.push(option);
    }
    ui.planSelect.replaceChildren(...options);
    ui.planSelect.disabled = state.catalog.length === 0;
    ui.catalogReload.disabled = false;
    ui.capabilityVersion.textContent = `Catalog version: ${state.catalogVersion ?? "unavailable"}`;
    ui.capabilityStatus.textContent = `${state.catalog.length} real capabilities loaded from /api/tools/catalog. Availability describes where a capability runs, not a claim that this page executed it.`;

    for (const entry of state.catalog) {
      const card = element("li", "tool-card");
      const head = element("div", "tool-card-head");
      head.append(element("span", "tool-id", entry.id));
      const chip = element("span", `availability-${String(entry.availability).replace(/[^a-z-]/g, "")}`, entry.availability);
      head.append(chip);
      if (entry.production_ready === true) head.append(element("span", "tool-ready", "production ready"));
      if (entry.production_ready === false) head.append(element("span", "tool-not-ready", "NOT production ready"));
      if (entry.workflow_context?.production_ready === false) head.append(element("span", "tool-not-ready", "workflow NOT production ready"));
      card.append(head);
      card.append(element("p", "tool-purpose", entry.scientific_purpose ?? ""));
      card.append(element("p", "tool-description", entry.description ?? ""));

      const schemaInputs = Object.keys(entry.input_schema?.properties ?? {});
      const schemaOutputs = Object.keys(entry.output_schema?.properties ?? {});
      appendField(card, "Inputs", entry.input_schema?.required?.length ? entry.input_schema.required : schemaInputs);
      appendField(card, "Outputs", entry.output_schema?.required?.length ? entry.output_schema.required : schemaOutputs);
      appendField(card, "Supported formats", entry.supported_formats);
      appendField(card, "Validation requirements", stringList(entry.validation_requirements).slice(0, 3));
      appendField(card, "Execution location", entry.execution_location);
      appendField(card, "Dependencies", entry.dependencies);
      appendField(card, "Limitations", stringList(entry.limitations).slice(0, 2));

      const footer = element("div", "tool-card-footer");
      const href = safeUrl(entry.entry_point?.href ?? "");
      if (href) {
        const link = element("a", "tool-entry", entry.entry_point?.label ?? "Open tool");
        link.href = href;
        if (/^https?:\/\//i.test(href)) {
          link.target = "_blank";
          link.rel = "noopener noreferrer nofollow";
        }
        footer.append(link);
      }
      const draft = element("button", "quiet-button", "Draft plan");
      draft.type = "button";
      draft.setAttribute("aria-label", `Draft a plan for ${entry.id}`);
      draft.addEventListener("click", () => {
        ui.planSelect.value = entry.id;
        renderPlanDraft();
        ui.planOutput.scrollIntoView({ block: "nearest" });
      });
      footer.append(draft);
      card.append(footer);
      ui.catalogList.append(card);
    }
  }

  function renderPlanDraft() {
    const entry = state.catalog.find((tool) => tool.id === ui.planSelect.value) ?? null;
    state.selectedToolId = entry ? entry.id : null;
    renderActiveContext();
    ui.planOutput.replaceChildren();
    if (!entry) {
      ui.planOutput.hidden = true;
      return;
    }
    ui.planOutput.hidden = false;
    ui.planOutput.append(element("h4", "", `Deterministic draft for ${entry.id}`));
    const outputs = entry.output_schema?.required?.length
      ? entry.output_schema.required
      : Object.keys(entry.output_schema?.properties ?? {});
    const sections = [
      ["Objective", [entry.scientific_purpose]],
      ["Input requirements", entry.validation_requirements],
      ["Recommended workflow", entry.recommended_workflow],
      ["Expected outputs", outputs],
      ["Validation", entry.validation_requirements],
      ["Limitations", entry.limitations],
      ["External destination (if any)", stringList(entry.external_destinations).length
        ? entry.external_destinations
        : ["None declared by the registry."]],
      ["Approval requirement", [
        "This draft grants nothing. Execution requires the existing approval and consent flow through the tool's own page."
      ]]
    ];
    for (const [label, values] of sections) appendField(ui.planOutput, label, values);
    if (entry.workflow_context) {
      appendField(ui.planOutput, "Workflow readiness", [
        `${entry.workflow_context.workflow_id}: ${entry.workflow_context.availability}`,
        entry.workflow_context.production_ready === true ? "production ready" : "NOT production ready"
      ]);
    }
  }

  async function loadCatalog() {
    // /api/tools/catalog only exists on the platform origin. A file:// preview
    // is an offline fixture: show the limitation instead of inventing tools.
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      ui.capabilityStatus.textContent = "Offline preview: /api/tools/catalog is available when this page is served by the platform. No capabilities are listed here.";
      ui.capabilityVersion.textContent = "Catalog version: unavailable offline";
      ui.catalogList.replaceChildren(element("li", "tool-empty", "Open assistant.html from the running platform to load the real capability registry."));
      ui.planSelect.disabled = true;
      renderPlanDraft();
      return;
    }
    try {
      const response = await fetch("api/tools/catalog", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      });
      const data = response.ok ? await response.json().catch(() => null) : null;
      if (!data || !Array.isArray(data.tools) || typeof data.catalog_version !== "string") {
        throw new Error("invalid catalog response");
      }
      state.catalog = data.tools;
      state.catalogVersion = data.catalog_version;
      renderCatalog();
    } catch {
      state.catalog = [];
      ui.capabilityStatus.textContent = "Capability catalog could not be loaded from /api/tools/catalog. No tools are listed until it is reachable.";
      ui.capabilityVersion.textContent = "Catalog version: unavailable";
      ui.catalogList.replaceChildren(element("li", "tool-empty", "Registry unavailable — no capabilities are fabricated."));
      ui.planSelect.disabled = true;
    }
    renderPlanDraft();
  }

  // ------------------------------------------------------------ composer
  function updateCount() {
    const length = ui.input.value.length;
    const over = length > MAX_CHARS;
    ui.count.textContent = `${length} / ${MAX_CHARS}`;
    ui.count.classList.toggle("over", over);
    ui.input.classList.toggle("is-over-limit", over);
    ui.clearDraft.disabled = length === 0;
    ui.send.disabled = !state.available || state.inFlight || over || length === 0;
    return !over;
  }

  function setUnavailable(reason) {
    state.available = false;
    state.provider = null;
    state.model = null;
    state.reason = typeof reason === "string" && reason.length < 120 ? reason : "no_enabled_llm_provider";
    ui.banner.hidden = false;
    ui.bannerDetail.textContent = `Status: ${state.reason}. No input is accepted; no demo reply is offered. Nothing is generated, sent to a model, or simulated.`;
    setBadgeText("AI chat unavailable");
    ui.badge.classList.add("unavailable");
    setPanelState("Unavailable — no authorized model provider");
    ui.input.disabled = true;
    ui.stop.disabled = true;
    ui.input.setAttribute("aria-disabled", "true");
    ui.help.textContent = `Enter sends · Shift+Enter adds a new line. Maximum ${MAX_CHARS} characters. Chat is disabled until a provider is authorized.`;
    markStage(null);
    updateCount();
  }

  // Only a real gateway status response can enable the composer. The model
  // name shown here is the one the Worker actually selected, never a guess.
  function setAvailable(data) {
    state.available = true;
    state.reason = null;
    state.provider = typeof data.provider === "string" ? data.provider : "ninerouter";
    state.model = typeof data.selected_model === "string" ? data.selected_model : null;
    ui.banner.hidden = true;
    setBadgeText(state.model
      ? `${state.provider} · ${state.model}`
      : `${state.provider} · model not reported`);
    ui.badge.classList.remove("unavailable");
    setPanelState(`Connected to ${state.provider}${state.model ? ` · model ${state.model}` : ""} — phrasing unverified.`);
    ui.bannerDetail.textContent = "";
    ui.input.disabled = false;
    ui.input.removeAttribute("aria-disabled");
    ui.help.textContent = `Enter sends · Shift+Enter adds a new line. Maximum ${MAX_CHARS} characters. Replies are AI-generated phrasing; scientific values come only from executed tools.`;
    markStage(null);
    updateCount();
  }

  async function loadStatus() {
    let reason = "status_check_failed";
    try {
      const response = await fetch("api/assistant/status", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.available === true && data.provider === "ninerouter") {
          setAvailable(data);
          return;
        }
        reason = typeof data.reason === "string" ? data.reason : "no_enabled_llm_provider";
      }
    } catch {
      reason = "status_check_failed";
    }
    // Fail closed for every status outcome, including an unreachable status
    // endpoint or an unexpected "available" claim from a proxy.
    setUnavailable(reason);
  }

  function buildHistory() {
    const conversation = activeConversation();
    if (!conversation) return [];
    return conversation.messages
      .filter((item) => (item.role === "user" || item.role === "assistant") && typeof item.text === "string")
      .slice(-MAX_HISTORY)
      .map((item) => ({ role: item.role, content: item.text.slice(0, MAX_CHARS) }));
  }

  function removeMessage(message) {
    const conversation = activeConversation();
    if (!conversation || !message) return;
    conversation.messages = conversation.messages.filter((item) => item !== message);
    renderTimeline();
  }

  // Raw SSE reader. Every text fragment comes from a real upstream data frame;
  // malformed frames are ignored rather than turned into invented text.
  async function consumeAssistantStream(response, contentNode, toolEvents) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let errorText = "";
    let meta = null;
    let done = false;

    const handleFrame = (block) => {
      let eventName = "message";
      const dataLines = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) return;
      const payload = dataLines.join("\n");
      if (payload === "[DONE]") { done = true; return; }
      let data;
      try { data = JSON.parse(payload); } catch { return; }
      if (eventName === "tool") {
        toolEvents.push(data);
        markStage(data.status === "ok" ? "validating" : "reviewing_evidence");
        return;
      }
      if (eventName === "meta") { meta = data; return; }
      if (eventName === "error") {
        errorText = String(data.error ?? "The provider returned an error.").slice(0, 500);
        return;
      }
      const delta = data?.choices?.[0]?.delta;
      if (typeof delta?.content === "string" && delta.content) {
        text += delta.content;
        if (contentNode) {
          contentNode.replaceChildren();
          renderMarkdown(text, contentNode);
        }
        ui.timeline.scrollTop = ui.timeline.scrollHeight;
      }
    };

    try {
      for (;;) {
        const { value, done: readDone } = await reader.read();
        if (readDone) break;
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
        let index;
        while ((index = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          handleFrame(block);
          if (done) break;
        }
        if (done) break;
      }
      if (!done && buffer.trim()) handleFrame(buffer);
    } finally {
      try { await reader.cancel(); } catch { /* stream already closed */ }
    }
    return { text, errorText, meta };
  }

  async function sendMessage(text) {
    const message = String(text ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, MAX_CHARS);
    if (!message) {
      setError("Enter a message before sending.");
      return;
    }
    if (message.length > MAX_CHARS) {
      setError(`Message exceeds the ${MAX_CHARS} character limit.`);
      return;
    }
    if (!state.available) {
      setError(BANNER_TEXT);
      return;
    }
    if (state.inFlight) return;

    const history = buildHistory();
    state.lastRequest = { message, projectContext: state.projectContext };
    state.inFlight = true;
    state.controller = new AbortController();
    ui.send.disabled = true;
    ui.stop.disabled = false;
    setError("");
    addMessage("user", message);
    setPanelState("Request sent — waiting for the first real response token.");

    const body = { message, history, stream: true };
    if (/^(proj|ds)_[0-9a-f]{16}$/.test(state.projectContext)) body.project_context = state.projectContext;
    let placeholder = null;

    try {
      const response = await fetch("api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        credentials: "same-origin",
        body: JSON.stringify(body),
        signal: state.controller.signal
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const typed = data.type || "assistant_provider_unavailable";
        setError(`${data.error || BANNER_TEXT} (${typed}; ${data.reason || "unavailable"}). No response was generated.`);
        addMessage("system", "No response was generated. No model provider was contacted.");
        setPanelState("Unavailable — no model response was completed.");
        return;
      }

      const contentType = String(response.headers.get("Content-Type") ?? "");
      if (contentType.includes("text/event-stream") && response.body && typeof response.body.getReader === "function") {
        addMessage("assistant", "");
        placeholder = activeConversation().messages.at(-1);
        const contentNode = ui.timeline.lastElementChild?.querySelector(".message-content") ?? null;
        const toolEvents = [];
        markStage("understanding");
        const result = await consumeAssistantStream(response, contentNode, toolEvents);
        for (const event of toolEvents) {
          const id = typeof event.tool_id === "string" ? event.tool_id.slice(0, 120) : "tool";
          addMessage("system", `Tool activity: ${id} — ${event.status === "ok" ? "completed" : "failed"} (${event.execution_location ?? "location unreported"}).`);
        }
        if (result.meta && typeof result.meta.model === "string") {
          state.model = result.meta.model;
          setBadgeText(`${state.provider ?? "ninerouter"} · ${result.meta.model}`);
        }
        if (result.errorText) {
          removeMessage(placeholder);
          placeholder = null;
          setError(`${result.errorText} No response was generated.`);
          addMessage("system", "No response was generated. Nothing was simulated.");
          setPanelState("Unavailable — no model response was completed.");
          return;
        }
        if (!result.text) {
          removeMessage(placeholder);
          placeholder = null;
          setError("The gateway returned no response text. Nothing was generated or simulated.");
          addMessage("system", "No response text was returned. Nothing was generated.");
          return;
        }
        placeholder.text = result.text;
        placeholder.card = result.meta?.result_card && typeof result.meta.result_card === "object" ? result.meta.result_card : null;
        placeholder.evidenceStatus = result.meta?.evidence_status ?? null;
        placeholder.validated = result.meta?.validated ?? null;
        renderTimeline();
        setPanelState(`Response received from ${state.provider ?? "ninerouter"}${state.model ? ` · ${state.model}` : ""} — phrasing unverified.`);
      } else {
        // Legacy JSON fallback when the gateway cannot stream.
        const data = await response.json().catch(() => ({}));
        const reply = typeof data.reply === "string" ? data.reply.trim() : "";
        if (!reply) {
          setError("The gateway returned no response text. Nothing was generated or simulated.");
          addMessage("system", "No response text was returned. Nothing was generated.");
          return;
        }
        if (typeof data.model === "string") {
          state.model = data.model;
          setBadgeText(`${state.provider ?? "ninerouter"} · ${data.model}`);
        }
        addMessage("assistant", reply, {
          card: data.result_card && typeof data.result_card === "object" ? data.result_card : null,
          evidenceStatus: data.evidence_status ?? null,
          validated: data.validated ?? null
        });
        setPanelState("Response received — phrasing is unverified.");
      }
    } catch (error) {
      if (placeholder && !placeholder.text) { removeMessage(placeholder); placeholder = null; }
      if (error && error.name === "AbortError") {
        setError("Stopped — no model response was completed. The server job, if any, is unchanged.");
        addMessage("system", "Stopped — no model response was completed.");
      } else {
        setError("The gateway could not be reached. No response was generated or simulated.");
        addMessage("system", "Request failed — no model response was completed.");
      }
      setPanelState("Unavailable — no model response was completed.");
    } finally {
      state.inFlight = false;
      state.controller = null;
      ui.stop.disabled = true;
      ui.input.value = "";
      updateCount();
      ui.input.focus();
    }
  }

  // ------------------------------------------------------------- listeners
  ui.newConversation.addEventListener("click", () => {
    newConversation();
    setError("");
    ui.input.focus();
  });

  ui.search.addEventListener("input", renderConversations);

  ui.sidebarToggle.addEventListener("click", () => {
    setSidebar(ui.sidebarToggle.getAttribute("aria-expanded") !== "true");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ui.shell.dataset.sidebarOpen === "true") {
      setSidebar(false);
      ui.sidebarToggle.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (ui.shell.dataset.sidebarOpen !== "true") return;
    const target = event.target;
    if (target instanceof Element && !ui.sidebar.contains(target) && !ui.sidebarToggle.contains(target)) setSidebar(false);
  });

  ui.removeContext.addEventListener("click", () => {
    ui.context.value = "";
    ui.context.removeAttribute("aria-invalid");
    state.projectContext = "";
    renderActiveContext();
    ui.context.focus();
  });
  ui.context.addEventListener("input", () => {
    const value = ui.context.value.trim();
    state.projectContext = value;
    const invalid = value !== "" && !PUBLIC_ID.test(value);
    ui.context.setAttribute("aria-invalid", String(invalid));
    renderActiveContext();
  });

  ui.planSelect.addEventListener("change", renderPlanDraft);
  ui.catalogReload.addEventListener("click", () => loadCatalog());

  ui.clearAll.addEventListener("click", () => {
    openDialog({
      title: "Clear all conversations?",
      message: "Conversations are stored only in this browser; they cannot be recovered. No server-side copy exists and nothing was deleted from a server.",
      focusReturn: ui.clearAll,
      onConfirm: () => {
        state.conversations = [];
        state.activeId = null;
        renderConversations();
        renderTimeline();
        setError("");
      }
    });
  });

  ui.dialog.querySelector("#dialog-form").addEventListener("submit", (event) => {
    // method="dialog" sets returnValue from the clicked submit button.
    if (!event.submitter) event.preventDefault();
  });

  document.querySelectorAll(".suggested-prompt").forEach((button) => {
    button.addEventListener("click", () => {
      ui.input.value = button.dataset.prompt ?? "";
      updateCount();
      setError("");
      ui.input.focus();
    });
  });

  ui.input.addEventListener("input", updateCount);
  ui.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!ui.form.querySelector(":invalid") && !ui.send.disabled) ui.form.requestSubmit();
    }
  });
  ui.clearDraft.addEventListener("click", () => {
    ui.input.value = "";
    updateCount();
    ui.input.focus();
  });
  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(ui.input.value);
  });
  ui.stop.addEventListener("click", () => {
    if (state.controller) state.controller.abort();
  });

  // Initial honest state: nothing generated, nothing stored, chat disabled.
  for (const stage of ui.activity.querySelectorAll(".activity-stage")) {
    stage.dataset.stage = stage.querySelector(".stage-name")?.textContent?.toLowerCase().replace(/\s+/g, "_") ?? "";
  }
  newConversation();
  setUnavailable(state.reason);
  loadStatus();
  loadCatalog();
})();
