/* =========================================================================
   Contact Roles — Widget Logic (one-line rows, inline editing)
   Reads the contact's companies with the Deluge function `contact_roles_widget`
   and adds / edits / deletes rows with `contact_roles_save`.
   ========================================================================= */

(function () {
  "use strict";

  var CONFIG = {
    PAGE_SIZE: 50,
    LOAD_TIMEOUT_MS: 10000,
    DEBUG: false,
    CAN_EDIT: true,                       // false = read-only (hides +, pencil and bin)
    FUNCTION_NAME: "contact_roles_widget",
    SAVE_FUNCTION_NAME: "contact_roles_save",
    LIST_KEY: "shareholder",
    ACCOUNT_URL: "https://crm.zoho.com/crm/org682300086/tab/Accounts/",
    ACCOUNTS_MODULE: "Accounts",
    SEARCH_MIN_CHARS: 2,
    SEARCH_DELAY_MS: 300,
    TOAST_MS: 2600,
    TOAST_ERR_MS: 5000,
    SIZE_FULL_FALLBACK: { width: "400px", height: "500px" },
    MIN_HEIGHT: "65px",
    ROLE_FIELDS: [
      { key: "pic", label: "PIC" },
      { key: "pc", label: "PC" },
      { key: "shareholder", label: "Shareholder" },
      { key: "officer", label: "Officer" }
    ]
  };

  var TAG = "[Contact_Roles]";
  var state = {
    contactId: null,
    contactName: "",
    roles: [],
    shown: CONFIG.PAGE_SIZE,
    minimized: false,
    fullSize: null,
    edit: null,            // { id, isNew, account, saving, refs }
    confirm: null,         // { id, busy }
    clearOnRender: false,  // clear edit/confirm once the refreshed list arrives
    searchToken: 0
  };
  var searchTimer = null;
  var toastTimer = null;

  /* ---------------- Logging ---------------- */

  function log() {
    if (!CONFIG.DEBUG) return;
    var args = [TAG].concat([].slice.call(arguments));
    try { console.log.apply(console, args); } catch (e) {}
  }

  function logErr() {
    var args = [TAG].concat([].slice.call(arguments));
    try { console.error.apply(console, args); } catch (e) {}
  }

  function safe(value, max) {
    var s;
    try { s = typeof value === "string" ? value : JSON.stringify(value, null, 2); }
    catch (e) { s = String(value); }
    if (s === undefined) s = String(value);
    if (max && s.length > max) s = s.slice(0, max) + "\n… (truncated, " + s.length + " chars total)";
    return s;
  }

  /* ---------------- Icons ---------------- */

  function svg(inner, sw) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2.2) +
      '" stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>";
  }

  var ICONS = {
    tick: svg('<path d="m5 12.5 4.5 4.5L19 7.5"></path>', 3.2),
    dash: svg('<path d="M7 12h10"></path>', 3.2),
    x: svg('<path d="M18 6 6 18M6 6l12 12"></path>', 2.8),
    building: svg('<rect x="5" y="3" width="14" height="18" rx="1.5"></rect><path d="M9 7.5h.01M15 7.5h.01M9 11.5h.01M15 11.5h.01"></path><path d="M10 21v-4h4v4"></path>', 2.4),
    edit: svg('<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>', 2.3),
    trash: svg('<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path>', 2.3)
  };

  /* ---------------- Elements ---------------- */

  function $(id) { return document.getElementById(id); }

  var el = {
    card: $("card"),
    closeBtns: document.querySelectorAll(".js-close"),
    minBtns: document.querySelectorAll(".js-min"),

    hero: $("hero"), meta: $("meta"),
    titleText: $("titleText"), contactName: $("contactName"), contactWrap: $("contactWrap"),
    countBadge: $("countBadge"),

    loader: $("loader"), main: $("main-view"), error: $("error-view"),
    table: $("table"), rows: $("rows"), thead: $("thead"),
    empty: $("empty"), emptyText: $("emptyText"),
    more: $("more"), moreBtn: $("moreBtn"),
    addRow: $("addRow"),

    errorTitle: $("error-title"), errorMessage: $("error-message"),
    debug: $("debug"), copyBtn: $("copyBtn"),

    toast: $("toast")
  };

  el.card.classList.toggle("no-edit", !CONFIG.CAN_EDIT);

  /* ---------------- Boot ---------------- */

  function captureFullSize() {
    if (state.fullSize || state.minimized) return;
    var w = window.innerWidth, h = window.innerHeight;
    if (w > 100 && h > 150) {
      state.fullSize = { width: w + "px", height: h + "px" };
    }
    log("full size captured:", safe(state.fullSize));
  }

  var noDataTimer = setTimeout(function () {
    logErr("PageLoad never fired within " + CONFIG.LOAD_TIMEOUT_MS + "ms");
    showError("No data received",
      "The widget didn't receive the contact ID. Please reopen it from the contact record.",
      { reason: "PageLoad event did not fire within " + CONFIG.LOAD_TIMEOUT_MS + "ms" });
  }, CONFIG.LOAD_TIMEOUT_MS);

  ZOHO.embeddedApp.on("PageLoad", function (entity) {
    clearTimeout(noDataTimer);
    captureFullSize();
    log("PageLoad entity (raw):", safe(entity));

    state.contactId = findKey(entity, "contact_id") || findId(entity, "EntityId");
    log("contact_id received by widget:", state.contactId);

    load(false);
  });

  ZOHO.embeddedApp.init();

  Array.prototype.forEach.call(el.closeBtns, function (b) { b.addEventListener("click", closeWidget); });
  Array.prototype.forEach.call(el.minBtns, function (b) {
    b.addEventListener("click", function () { setMinimized(!state.minimized); });
  });
  el.copyBtn.addEventListener("click", copyDebug);

  el.moreBtn.addEventListener("click", function () {
    state.shown += CONFIG.PAGE_SIZE;
    renderList();
  });
  el.addRow.addEventListener("click", startAdd);

  /* ---------------- Minimize / restore ---------------- */

  function setMinimized(min) {
    captureFullSize();
    state.minimized = min;
    el.card.classList.toggle("is-min", min);

    Array.prototype.forEach.call(el.minBtns, function (b) {
      var label = min ? "Expand" : "Minimize";
      b.setAttribute("aria-label", label);
      b.setAttribute("title", label);
    });

    var full = state.fullSize || CONFIG.SIZE_FULL_FALLBACK;
    resizeFlyout(min
      ? { width: full.width, height: CONFIG.MIN_HEIGHT }
      : { width: full.width, height: full.height });
  }

  function resizeFlyout(size) {
    log("resize →", safe(size));
    if (window.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && typeof ZOHO.CRM.UI.Resize === "function") {
      ZOHO.CRM.UI.Resize(size)
        .then(function (res) { log("[Resize] response:", safe(res)); })
        .catch(function (err) { logErr("[Resize] error:", err); });
    }
  }

  /* ---------------- Calling Deluge functions ---------------- */

  function callFunction(name, args) {
    var request = { arguments: JSON.stringify(args) };
    log("ZOHO.CRM.FUNCTIONS.execute →", name, safe(request));
    return ZOHO.CRM.FUNCTIONS.execute(name, request);
  }

  // Load the list. silent = true keeps the screen as is (used after a save).
  function load(silent) {
    if (!state.contactId) {
      showError("Missing contact ID",
        "The widget didn't receive a contact ID from the record page.",
        { contactIdInWidget: state.contactId });
      return;
    }

    if (!silent) setMode("loading");

    callFunction(CONFIG.FUNCTION_NAME, { contact_id: state.contactId })
      .then(function (res) {
        log("function result (value):", safe(res));
        handleRaw(res, { function: CONFIG.FUNCTION_NAME }, silent);
      })
      .catch(function (err) {
        logErr("function call failed", err);
        fail(silent, "Couldn't call the function",
          (err && err.message) || "ZOHO.CRM.FUNCTIONS.execute failed.",
          { function: CONFIG.FUNCTION_NAME, error: err });
      });
  }

  // Run the save function; resolves on success, rejects with an Error on failure.
  function runWrite(args) {
    return callFunction(CONFIG.SAVE_FUNCTION_NAME, args).then(function (res) {
      log("save result:", safe(res));
      var r = extractResult(res);
      if (!r) {
        var code = res && res.code;
        throw new Error(code && code !== "success"
          ? "The save function failed (" + code + ")."
          : "The save function returned an unexpected response.");
      }
      if (r.error) throw new Error(r.message || "The save failed.");
      return r;
    });
  }

  // After a save, the refresh failed: unlock the row and tell the user.
  function fail(silent, title, message, debug) {
    if (silent) {
      state.clearOnRender = false;
      state.edit = null;
      state.confirm = null;
      renderList();
      toast("Saved, but the list couldn't refresh. " + message, "err");
    } else {
      showError(title, message, debug);
    }
  }

  /* ---------------- Payload handling ---------------- */

  function handleRaw(raw, ctx, silent) {
    var payload;
    try {
      payload = extractPayload(raw);
    } catch (e) {
      logErr("extractPayload threw", e);
      fail(silent, "Couldn't read the response", "Error while reading the response: " + e.message,
        { call: ctx, received: raw, stack: e.stack });
      return;
    }

    if (!payload) {
      logErr("No payload found in response");
      fail(silent, "Couldn't read the response",
        "The function responded, but the contact roles payload wasn't found in it.",
        { call: ctx, received: raw });
      return;
    }

    if (payload.error) {
      fail(silent, "Couldn't load roles", payload.message || "Failed to load contact roles.",
        { call: ctx, received: raw });
      return;
    }

    try {
      render(payload, silent);
    } catch (err) {
      logErr("render failed", err);
      fail(silent, "Couldn't display roles", "Render error: " + err.message,
        { call: ctx, received: raw, payload: payload, stack: err.stack });
    }
  }

  // Searches the response (breadth-first) for the object that has the roles list.
  function extractPayload(root) {
    return bfs(root, function (v) {
      if (v[CONFIG.LIST_KEY] && typeof v[CONFIG.LIST_KEY] === "object") return true;
      if (v.error === true) return true;
      return false;
    });
  }

  // Finds the save function's {error: true|false, message} object.
  function extractResult(root) {
    return bfs(root, function (v) { return typeof v.error === "boolean"; });
  }

  function bfs(root, test) {
    var queue = [root];
    var seen = [];
    var steps = 0;

    while (queue.length && steps++ < 300) {
      var v = queue.shift();
      if (v === null || v === undefined) continue;

      if (typeof v === "string") {
        var parsed = tryParse(v);
        if (parsed !== null) queue.push(parsed);
        continue;
      }
      if (typeof v !== "object" || seen.indexOf(v) !== -1) continue;
      seen.push(v);

      if (test(v)) return v;
      Object.keys(v).forEach(function (k) { queue.push(v[k]); });
    }
    return null;
  }

  function tryParse(str) {
    var s = String(str).trim();
    if (!s || (s.charAt(0) !== "{" && s.charAt(0) !== "[")) return null;
    try {
      return JSON.parse(s);
    } catch (e1) {
      var a = s.indexOf("{");
      var b = s.lastIndexOf("}");
      if (a !== -1 && b > a) {
        try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) { /* fall through */ }
      }
      logErr("String looked like JSON but could not be parsed:", s.slice(0, 500));
      return null;
    }
  }

  function findKey(root, key) {
    var queue = [root];
    var seen = [];
    var steps = 0;
    while (queue.length && steps++ < 300) {
      var v = queue.shift();
      if (!v || typeof v !== "object" || seen.indexOf(v) !== -1) continue;
      seen.push(v);
      if (v[key] !== undefined && v[key] !== null && typeof v[key] !== "object") return String(v[key]);
      Object.keys(v).forEach(function (k) { queue.push(v[k]); });
    }
    return null;
  }

  // Like findKey, but also accepts a value that is an array (Zoho's EntityId can be one).
  function findId(root, key) {
    var direct = findKey(root, key);
    if (direct) return direct;
    var queue = [root];
    var seen = [];
    var steps = 0;
    while (queue.length && steps++ < 300) {
      var v = queue.shift();
      if (!v || typeof v !== "object" || seen.indexOf(v) !== -1) continue;
      seen.push(v);
      if (Array.isArray(v[key]) && v[key].length) return String(v[key][0]);
      Object.keys(v).forEach(function (k) { queue.push(v[k]); });
    }
    return null;
  }

  /* ---------------- Modes ---------------- */

  function setMode(mode) {
    toggle(el.loader, mode === "loading");
    toggle(el.main, mode === "main");
    toggle(el.error, mode === "error");
    toggle(el.meta, mode === "main");
    toggle(el.hero, mode === "main");
  }

  function showError(title, message, debug) {
    el.errorTitle.textContent = title;
    el.errorMessage.textContent = message;
    el.debug.textContent = safe(debug || {}, 8000);
    setMode("error");
  }

  /* ---------------- Render ---------------- */

  function render(payload, keepPaging) {
    if (state.clearOnRender) {
      state.edit = null;
      state.confirm = null;
      state.clearOnRender = false;
    }

    state.contactName = (payload.contact && payload.contact.name) || payload.contact_name || "";
    state.roles = normalizeRoles(payload[CONFIG.LIST_KEY]).sort(byPriority);
    if (!keepPaging) state.shown = CONFIG.PAGE_SIZE;

    renderHeader();
    renderList();

    setMode("main");
  }

  function renderHeader() {
    el.titleText.textContent = "Contact Roles";
    el.contactName.textContent = state.contactName;
    toggle(el.contactWrap, !!state.contactName);

    el.countBadge.innerHTML = "";
    var label = h("span", "recv__label");
    label.innerHTML = ICONS.building;
    label.appendChild(h("span", "", "Companies"));
    el.countBadge.appendChild(label);
    el.countBadge.appendChild(h("span", "recv__amt", String(state.roles.length)));
    toggle(el.countBadge, true);
  }

  /* ---------------- List ---------------- */

  function renderList() {
    clearTimeout(searchTimer);
    state.searchToken++;

    var list = state.roles;
    var visible = list.slice(0, state.shown);
    var addingNew = !!(state.edit && state.edit.isNew);

    el.rows.innerHTML = "";
    visible.forEach(function (r) {
      if (state.edit && !state.edit.isNew && state.edit.id === r.id) {
        el.rows.appendChild(buildEditRow(r));
      } else if (state.confirm && state.confirm.id === r.id) {
        el.rows.appendChild(buildConfirmRow(r));
      } else {
        el.rows.appendChild(buildRow(r));
      }
    });
    if (addingNew) el.rows.appendChild(buildEditRow(null));

    var hasRows = list.length > 0;
    toggle(el.thead, hasRows || addingNew);
    toggle(el.empty, !hasRows && !addingNew);
    if (!hasRows && !addingNew) {
      el.emptyText.textContent = CONFIG.CAN_EDIT
        ? "Use Add company below to link one."
        : "This contact isn't linked to any company yet.";
    }

    var remaining = list.length - visible.length;
    toggle(el.more, remaining > 0);
    if (remaining > 0) {
      el.moreBtn.textContent = "Show " + Math.min(CONFIG.PAGE_SIZE, remaining) + " more (" + remaining + " remaining)";
    }

    toggle(el.addRow, CONFIG.CAN_EDIT && !addingNew);
  }

  function buildRow(r) {
    var row = h("div", "trow grid-cols" + (r.pc ? " is-pc" : ""));

    // Account (opens the Account record in a new tab)
    var acc = h("div", "c-acc");
    if (r.accountId) {
      var link = h("a", "acc-link", r.accountName || "(No account name)");
      link.href = CONFIG.ACCOUNT_URL + r.accountId;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = r.accountName || "";
      acc.appendChild(link);
    } else {
      acc.appendChild(h("span", "acc-link", r.accountName || "(No account name)"));
    }

    // Email
    var email = h("div", "c-email");
    if (r.email) {
      var a = h("a", "txt", r.email);
      a.href = "mailto:" + r.email;
      a.title = r.email;
      email.appendChild(a);
    } else {
      email.appendChild(h("span", "txt txt--empty", "—"));
    }

    // Phone
    var phone = h("div", "c-phone");
    if (r.phone) {
      var p = h("a", "txt", r.phone);
      p.href = "tel:" + r.phone.replace(/[^\d+]/g, "");
      p.title = r.phone;
      phone.appendChild(p);
    } else {
      phone.appendChild(h("span", "txt txt--empty", "—"));
    }

    row.appendChild(acc);
    row.appendChild(email);
    row.appendChild(phone);

    // Roles
    var group = h("div", "c-role-group");
    CONFIG.ROLE_FIELDS.forEach(function (f) {
      var on = !!r[f.key];
      var cell = h("div", "c-role");
      var role = h("span", "role role--" + (on ? "on" : "off"));
      role.setAttribute("title", f.label + ": " + (on ? "Yes" : "No"));
      role.setAttribute("aria-label", f.label + ": " + (on ? "Yes" : "No"));
      var ico = h("span", "role__ico");
      ico.innerHTML = on ? ICONS.tick : ICONS.dash;
      role.appendChild(ico);
      cell.appendChild(role);
      group.appendChild(cell);
    });
    row.appendChild(group);

    // Actions
    if (CONFIG.CAN_EDIT) {
      var actions = h("div", "c-actions");
      actions.appendChild(iconBtn("edit", "Edit", "", function () { startEdit(r); }));
      actions.appendChild(iconBtn("trash", "Remove", "is-danger", function () { startConfirm(r); }));
      row.appendChild(actions);
    }

    return row;
  }

  function iconBtn(iconKey, label, extra, onClick) {
    var b = h("button", "ico-btn" + (extra ? " " + extra : ""));
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = ICONS[iconKey];
    b.addEventListener("click", onClick);
    return b;
  }

  /* ---------------- Inline edit / add ---------------- */

  function busy() {
    return !!((state.edit && state.edit.saving) || (state.confirm && state.confirm.busy));
  }

  function startEdit(r) {
    if (!CONFIG.CAN_EDIT || busy()) return;
    state.confirm = null;
    state.edit = {
      id: r.id,
      isNew: false,
      account: r.accountId ? { id: r.accountId, name: r.accountName } : null,
      saving: false,
      refs: null
    };
    renderList();
    if (state.edit && state.edit.refs) {
      state.edit.refs.row.scrollIntoView({ block: "nearest" });
      state.edit.refs.email.focus();
    }
  }

  function startAdd() {
    if (!CONFIG.CAN_EDIT || busy()) return;
    state.confirm = null;
    state.edit = { id: "", isNew: true, account: null, saving: false, refs: null };
    renderList();
    if (state.edit && state.edit.refs) {
      state.edit.refs.row.scrollIntoView({ block: "nearest" });
      state.edit.refs.acc.focus();
    }
  }

  function cancelEdit() {
    if (!state.edit || state.edit.saving) return;
    state.edit = null;
    renderList();
  }

  function buildEditRow(r) {
    var ed = state.edit;
    var row = h("div", "trow grid-cols is-edit");
    var refs = { row: row, roles: {}, controls: [], results: null, pickFirst: null };

    // Account lookup
    var acc = h("div", "c-acc");
    var accInput = h("input", "input" + (ed.account ? " is-picked" : ""));
    accInput.type = "text";
    accInput.placeholder = "Search account…";
    accInput.autocomplete = "off";
    accInput.setAttribute("aria-label", "Account name");
    accInput.value = ed.account ? ed.account.name : "";
    var results = h("div", "results hidden");
    acc.appendChild(accInput);
    acc.appendChild(results);
    refs.acc = accInput;
    refs.results = results;
    refs.controls.push(accInput);

    accInput.addEventListener("input", function () {
      ed.account = null;
      accInput.classList.remove("is-picked");
      onAccountInput(refs);
    });
    accInput.addEventListener("blur", function () {
      setTimeout(function () { hideResults(refs); }, 150);
    });
    accInput.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (!ed.account && refs.pickFirst) refs.pickFirst();
      else if (ed.account) submitEdit();
    });

    // Email
    var email = h("div", "c-email");
    var emailInput = h("input", "input");
    emailInput.type = "text";
    emailInput.setAttribute("inputmode", "email");
    emailInput.placeholder = "Email address";
    emailInput.autocomplete = "off";
    emailInput.setAttribute("aria-label", "Email address");
    emailInput.value = r ? r.email : "";
    email.appendChild(emailInput);
    refs.email = emailInput;
    refs.controls.push(emailInput);

    // Phone
    var phone = h("div", "c-phone");
    var phoneInput = h("input", "input");
    phoneInput.type = "text";
    phoneInput.setAttribute("inputmode", "tel");
    phoneInput.placeholder = "Contact number";
    phoneInput.autocomplete = "off";
    phoneInput.setAttribute("aria-label", "Contact number");
    phoneInput.value = r ? r.phone : "";
    phone.appendChild(phoneInput);
    refs.phone = phoneInput;
    refs.controls.push(phoneInput);

    row.appendChild(acc);
    row.appendChild(email);
    row.appendChild(phone);

    // Roles (checkboxes)
    var group = h("div", "c-role-group");
    CONFIG.ROLE_FIELDS.forEach(function (f) {
      var cell = h("div", "c-role");
      var lab = h("label", "chk");
      lab.title = f.label;
      var inp = document.createElement("input");
      inp.type = "checkbox";
      inp.setAttribute("aria-label", f.label);
      inp.checked = r ? !!r[f.key] : false;
      var box = h("span", "chk__box");
      box.innerHTML = ICONS.tick;
      lab.appendChild(inp);
      lab.appendChild(box);
      cell.appendChild(lab);
      group.appendChild(cell);
      refs.roles[f.key] = inp;
      refs.controls.push(inp);
    });
    row.appendChild(group);

    // Actions: save / cancel
    var actions = h("div", "c-actions");
    var saveBtn = iconBtn("tick", ed.isNew ? "Add" : "Save", "is-ok", submitEdit);
    var cancelBtn = iconBtn("x", "Cancel", "", cancelEdit);
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    row.appendChild(actions);
    refs.saveBtn = saveBtn;
    refs.controls.push(saveBtn, cancelBtn);

    row.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      } else if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type === "text" && e.target !== accInput) {
        e.preventDefault();
        submitEdit();
      }
    });

    ed.refs = refs;
    if (ed.saving) setEditBusy(true);
    return row;
  }

  // Errors never add a second line: the row turns red and a toast explains why.
  function setRowError(msg) {
    var refs = state.edit && state.edit.refs;
    if (!refs) return;
    refs.row.classList.toggle("is-invalid", !!msg);
    if (msg) toast(msg, "err");
  }

  function setEditBusy(on) {
    var refs = state.edit && state.edit.refs;
    if (!refs) return;
    refs.row.classList.toggle("is-saving", on);
    refs.controls.forEach(function (c) { c.disabled = on; });
    refs.saveBtn.innerHTML = on ? '<span class="mini-spin"></span>' : ICONS.tick;
  }

  /* ---- Account lookup (searches the Accounts module) ---- */

  function onAccountInput(refs) {
    var q = refs.acc.value.trim();
    clearTimeout(searchTimer);
    if (q.length < CONFIG.SEARCH_MIN_CHARS) {
      state.searchToken++;
      hideResults(refs);
      return;
    }
    searchTimer = setTimeout(function () { searchAccounts(q, refs); }, CONFIG.SEARCH_DELAY_MS);
  }

  function searchAccounts(q, refs) {
    var token = ++state.searchToken;
    showResultsMessage(refs, "Searching…");

    ZOHO.CRM.API.searchRecord({
      Entity: CONFIG.ACCOUNTS_MODULE,
      Type: "word",
      Query: q,
      page: 1,
      per_page: 10
    })
      .then(function (res) {
        if (token !== state.searchToken) return;
        renderResults((res && res.data) || [], refs);
      })
      .catch(function (err) {
        if (token !== state.searchToken) return;
        log("[Account search] error:", err);
        renderResults([], refs);
      });
  }

  function renderResults(records, refs) {
    refs.results.innerHTML = "";
    refs.pickFirst = null;
    if (!records.length) {
      showResultsMessage(refs, "No accounts found");
      return;
    }
    records.forEach(function (rec, i) {
      var b = h("button", "result", rec.Account_Name || "(No name)");
      b.type = "button";
      var pick = function () { pickAccount(rec, refs); };
      b.addEventListener("mousedown", function (e) { e.preventDefault(); pick(); });
      if (i === 0) refs.pickFirst = pick;
      refs.results.appendChild(b);
    });
    toggle(refs.results, true);
    refs.results.scrollIntoView({ block: "nearest" });
  }

  function pickAccount(rec, refs) {
    var ed = state.edit;
    if (!ed || ed.refs !== refs) return;
    ed.account = { id: String(rec.id), name: rec.Account_Name || "" };
    refs.acc.value = ed.account.name;
    refs.acc.classList.add("is-picked");
    hideResults(refs);
    refs.row.classList.remove("is-invalid");
    refs.email.focus();
  }

  function showResultsMessage(refs, msg) {
    refs.results.innerHTML = "";
    refs.pickFirst = null;
    refs.results.appendChild(h("div", "results__msg", msg));
    toggle(refs.results, true);
  }

  function hideResults(refs) {
    refs.results.innerHTML = "";
    refs.pickFirst = null;
    toggle(refs.results, false);
  }

  /* ---- Save ---- */

  function submitEdit() {
    var ed = state.edit;
    if (!ed || ed.saving || !ed.refs) return;
    var refs = ed.refs;

    setRowError("");

    if (!ed.account) {
      setRowError("Please pick an account from the search results.");
      refs.acc.focus();
      return;
    }
    if (!ed.isNew && !ed.id) {
      setRowError("This row has no ID. Make sure the loader function returns the subform row id.");
      return;
    }

    var duplicate = state.roles.some(function (r) {
      return r.accountId === ed.account.id && (ed.isNew || r.id !== ed.id);
    });
    if (duplicate) {
      setRowError("This contact is already linked to that company.");
      return;
    }

    var email = refs.email.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRowError("Please enter a valid email address.");
      refs.email.focus();
      return;
    }

    var args = {
      contact_id: state.contactId,
      action: ed.isNew ? "add" : "update",
      row_id: ed.isNew ? "" : ed.id,
      account_id: ed.account.id,
      pc_email: email,
      contact_number: refs.phone.value.trim()
    };
    CONFIG.ROLE_FIELDS.forEach(function (f) {
      args[f.key] = String(refs.roles[f.key].checked);
    });

    ed.saving = true;
    setEditBusy(true);
    var wasNew = ed.isNew;

    runWrite(args)
      .then(function () {
        state.clearOnRender = true;
        toast(wasNew ? "Company added" : "Company updated", "ok");
        load(true);
      })
      .catch(function (err) {
        logErr("save failed", err);
        if (state.edit === ed) {
          ed.saving = false;
          setEditBusy(false);
          setRowError(errText(err));
        }
      });
  }

  /* ---------------- Remove (one-line confirmation) ---------------- */

  function startConfirm(r) {
    if (!CONFIG.CAN_EDIT || busy()) return;
    state.edit = null;
    state.confirm = { id: r.id, busy: false };
    renderList();
  }

  function cancelConfirm() {
    if (!state.confirm || state.confirm.busy) return;
    state.confirm = null;
    renderList();
  }

  function buildConfirmRow(r) {
    var c = state.confirm;
    var row = h("div", "trow is-confirm");

    var text = h("div", "confirm__text");
    text.appendChild(document.createTextNode("Remove "));
    text.appendChild(h("b", "", r.accountName || "this company"));
    text.appendChild(document.createTextNode(" from this contact?"));
    row.appendChild(text);

    var btns = h("div", "confirm__btns");
    var cancel = h("button", "btn btn--ghost", "Cancel");
    cancel.type = "button";
    cancel.disabled = c.busy;
    cancel.addEventListener("click", cancelConfirm);
    var ok = h("button", "btn btn--danger", c.busy ? "Removing…" : "Remove");
    ok.type = "button";
    ok.disabled = c.busy;
    ok.addEventListener("click", function () { confirmDelete(r); });
    btns.appendChild(cancel);
    btns.appendChild(ok);
    row.appendChild(btns);

    return row;
  }

  function confirmDelete(r) {
    var c = state.confirm;
    if (!c || c.busy) return;

    if (!r.id) {
      toast("This row has no ID. Make sure the loader function returns the subform row id.", "err");
      return;
    }

    c.busy = true;
    renderList();

    runWrite({
      contact_id: state.contactId,
      action: "delete",
      row_id: r.id,
      account_id: "",
      pc_email: "",
      contact_number: "",
      pic: "false",
      pc: "false",
      shareholder: "false",
      officer: "false"
    })
      .then(function () {
        state.clearOnRender = true;
        toast("Company removed", "ok");
        load(true);
      })
      .catch(function (err) {
        logErr("delete failed", err);
        if (state.confirm === c) {
          c.busy = false;
          renderList();
          toast(errText(err), "err");
        }
      });
  }

  /* ---------------- Data shaping ---------------- */

  // Accepts a list, a JSON string, or an object keyed by index/id; always returns a clean list.
  function normalizeRoles(raw) {
    var v = raw;
    if (typeof v === "string") v = tryParse(v);
    if (!v) return [];

    var list;
    if (Array.isArray(v)) list = v;
    else if (typeof v === "object") list = Object.keys(v).map(function (k) { return v[k]; });
    else return [];

    return list
      .filter(function (n) { return n && typeof n === "object"; })
      .map(function (n) {
        return {
          id: n.id ? String(n.id) : "",
          accountId: n.account_id ? String(n.account_id) : "",
          accountName: n.account_name || "",
          email: n.pc_email || n.email || "",
          phone: n.contact_number || n.phone || "",
          pic: isTrue(n.pic),
          pc: isTrue(n.pc),
          shareholder: isTrue(n.shareholder),
          officer: isTrue(n.officer)
        };
      });
  }

  // Primary contacts first, then PIC, then A–Z.
  function byPriority(a, b) {
    if (a.pc !== b.pc) return a.pc ? -1 : 1;
    if (a.pic !== b.pic) return a.pic ? -1 : 1;
    return a.accountName.toLowerCase().localeCompare(b.accountName.toLowerCase());
  }

  /* ---------------- Helpers ---------------- */

  function toast(msg, kind) {
    clearTimeout(toastTimer);
    el.toast.textContent = msg;
    el.toast.className = "toast toast--" + (kind || "ok");
    toastTimer = setTimeout(function () { toggle(el.toast, false); },
      kind === "err" ? CONFIG.TOAST_ERR_MS : CONFIG.TOAST_MS);
  }

  function errText(err) {
    var m = (err && err.message) ? err.message : String(err);
    return m.length > 300 ? m.slice(0, 300) + "…" : m;
  }

  function copyDebug() {
    var text = el.debug.textContent || "";
    function done() {
      el.copyBtn.textContent = "Copied";
      setTimeout(function () { el.copyBtn.textContent = "Copy"; }, 1500);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
    try {
      navigator.clipboard.writeText(text).then(done, fallback);
    } catch (e) {
      fallback();
    }
  }

  function closeWidget() {
    log("Closing widget.");
    if (typeof $Client !== "undefined" && typeof $Client.close === "function") {
      $Client.close();
    } else {
      logErr("[Close] $Client.close is not available in this widget.");
    }
  }

  function h(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function toggle(node, show) {
    if (node) node.classList.toggle("hidden", !show);
  }

  function isTrue(v) { return v === true || v === "true"; }
})();