/* =========================================================================
   Contact Profile — Widget Logic
   Tabs (js/tabs.js) + company cards + add/edit window.
   Reads the contact with the Deluge function `contact_roles_widget`
   and adds / edits / deletes company rows with `contact_roles_save`.
   ========================================================================= */

(function () {
  "use strict";

  var CONFIG = {
    PAGE_SIZE: 50,
    FILTER_MIN: 6,                        // show the filter box from this many companies
    LOAD_TIMEOUT_MS: 10000,
    DEBUG: false,
    CAN_EDIT: true,                       // master switch: false = read-only for EVERYONE (hides add and edit)
    SHOW_ADD: true,                       // false = hide the "Add company" button
    EDIT_PROFILES: [                      // only these CRM profiles can add / edit companies
      "Administrator",
      "Operations Manager",
      "CRS on Licenses",
      "CRS on Licenses and Residence Visa",
      "Support Executive"
    ],
    ACCOUNT_TYPE_TONE: {                  // chip colour: good = green, warn = amber, bad = red, anything else = grey
      "Active": "good",
      "Will go for renewal": "good",
      "Renewal In Progress": "good",
      "Will go for cancellation": "warn",
      "Cancellation in Progress": "warn",
      "Pending Transfer to Authority (Warning 1)": "warn",
      "Pending Transfer to Authority (Warning 2)": "warn",
      "Pending Transfer to Authority (Management Decision)": "warn",
      "Send First Warning": "warn",
      "Send Final Warning": "warn",
      "Strike-Off": "warn",
      "Cancelled": "bad",
      "Expired": "bad",
      "Transferred to Competitor": "bad",
      "Transferred to Authority": "bad"
      // not listed (grey): Non Action License, Prospect, Reseller, TLZ Company, Referral Partner,
      // In Discussion, Amendment In Progress
    },
    FUNCTION_NAME: "contact_roles_widget",
    SAVE_FUNCTION_NAME: "contact_roles_save",
    LIST_KEY: "shareholder",
    ACCOUNT_URL: "https://crm.zoho.com/crm/org682300086/tab/Accounts/",
    CONTACT_URL: "https://crm.zoho.com/crm/org682300086/tab/Contacts/",
    ACCOUNTS_MODULE: "Accounts",
    ACCOUNT_TYPE_FIELD: "Account_Type",   // single picklist on the main Account record
    ACCOUNT_ROLES_FIELD: "Contacts_Roles",   // subform on the Account record
    ROLES_CONTACT_FIELD: "Contact_Name",     // contact lookup inside the Account's Contacts_Roles subform
    PC_FIELD: "PC",                          // primary-contact tick box in that subform
    SEARCH_MIN_CHARS: 2,
    SEARCH_DELAY_MS: 300,
    TOAST_MS: 2600,
    TOAST_ERR_MS: 5000,
    SIZE_FULL_FALLBACK: { width: "400px", height: "560px" },
    MIN_HEIGHT: "65px",
    ROLE_FIELDS: [
      { key: "pic", label: "PIC", full: "Person in charge" },
      { key: "pc", label: "PC", full: "Primary contact" },
      { key: "shareholder", label: "Shareholder", full: "Owns shares" },
      { key: "officer", label: "Officer", full: "Company officer" }
    ]
  };

  var TAG = "[Contact_Roles]";
  var state = {
    contactId: null,
    contactName: "",
    roles: [],
    shown: CONFIG.PAGE_SIZE,
    filter: "",
    minimized: false,
    fullSize: null,
    canEdit: false,        // set once the logged-in user's profile is known (deny by default)
    edit: null,            // { id, isNew, account, saving, refs }
    clearOnRender: false,  // close the edit window once the refreshed data arrives
    searchToken: 0,
    types: {}              // accountId -> Account_Type, fetched by the widget when the loader did not send it
  };
  var searchTimer = null;
  var toastTimer = null;
  var toastHideTimer = null;
  var pcAlertEl = null;                    // the "primary contact already assigned" popup, when open
  var pcAlertDismiss = function () {};     // what Okay / Escape does for that popup

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
    x: svg('<path d="M18 6 6 18M6 6l12 12"></path>', 2.8),
    edit: svg('<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>', 2.3),
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>', 2.2),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"></path>', 2.1),
    warn: svg('<path d="M12 3 2.8 19a1.5 1.5 0 0 0 1.3 2.2h15.8a1.5 1.5 0 0 0 1.3-2.2L12 3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>', 2.2)
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
    rows: $("rows"),
    empty: $("empty"), emptyTitle: $("emptyTitle"), emptyText: $("emptyText"),
    more: $("more"), moreBtn: $("moreBtn"),
    addRow: $("addRow"), filterWrap: $("filterWrap"), filter: $("coFilter"),

    modal: $("modal"), dialog: $("dialog"),

    errorTitle: $("error-title"), errorMessage: $("error-message"),
    debug: $("debug"), copyBtn: $("copyBtn"),

    toast: $("toast")
  };

  /* ---------------- Permissions ---------------- */

  // True only when the master switch is on AND the user's profile is in EDIT_PROFILES.
  function canEdit() { return CONFIG.CAN_EDIT && state.canEdit; }

  function applyPermissions() {
    el.card.classList.toggle("no-edit", !canEdit());
  }

  function profileAllowed(name) {
    var n = String(name || "").trim().toLowerCase();
    return CONFIG.EDIT_PROFILES.some(function (p) { return p.toLowerCase() === n; });
  }

  // Reads the signed-in user and checks their profile. Any failure = read-only.
  function resolveUser() {
    return ZOHO.CRM.CONFIG.getCurrentUser()
      .then(function (res) {
        var u = res && res.users && res.users[0];
        state.canEdit = !!(u && u.profile && profileAllowed(u.profile.name));
        log("user profile:", u && u.profile && u.profile.name, "-> canEdit:", state.canEdit);
      })
      .catch(function (err) {
        logErr("getCurrentUser failed, defaulting to read-only", err);
        state.canEdit = false;
      })
      .then(applyPermissions);   // runs in both cases
  }

  applyPermissions();   // read-only until the profile is confirmed

  /* ---------------- Boot ---------------- */

  function captureFullSize() {
    if (state.fullSize || state.minimized) return;
    var w = window.innerWidth, h = window.innerHeight;
    if (w > 100 && h > 150) state.fullSize = { width: w + "px", height: h + "px" };
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
    resolveUser().then(function () { load(false); });   // profile first, then data
  });

  ZOHO.embeddedApp.init();

  Array.prototype.forEach.call(el.closeBtns, function (b) { b.addEventListener("click", closeWidget); });
  Array.prototype.forEach.call(el.minBtns, function (b) {
    b.addEventListener("click", function () { setMinimized(!state.minimized); });
  });
  el.copyBtn.addEventListener("click", copyDebug);
  el.moreBtn.addEventListener("click", function () { state.shown += CONFIG.PAGE_SIZE; renderList(); });
  el.addRow.addEventListener("click", startAdd);
  el.filter.addEventListener("input", function () {
    state.filter = el.filter.value.trim().toLowerCase();
    state.shown = CONFIG.PAGE_SIZE;
    renderList();
  });
  el.modal.addEventListener("mousedown", function (e) { if (e.target === el.modal) closeModal(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (pcAlertEl) { e.preventDefault(); pcAlertDismiss(); return; }   // popup first
    if (state.edit) closeModal();
  });

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

  // silent = true keeps the screen as is (used after a save).
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

  // After a save, the refresh failed: unlock everything and tell the user.
  function fail(silent, title, message, debug) {
    if (silent) {
      state.clearOnRender = false;
      state.edit = null;
      hideModal();
      renderList();
      toast("Saved, but the data couldn't refresh. " + message, "err");
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
        "The function responded, but the contact payload wasn't found in it.",
        { call: ctx, received: raw });
      return;
    }
    if (payload.error) {
      fail(silent, "Couldn't load profile", payload.message || "Failed to load the contact profile.",
        { call: ctx, received: raw });
      return;
    }
    try {
      render(payload, silent);
    } catch (err) {
      logErr("render failed", err);
      fail(silent, "Couldn't display profile", "Render error: " + err.message,
        { call: ctx, received: raw, payload: payload, stack: err.stack });
    }
  }

  function extractPayload(root) {
    return bfs(root, function (v) {
      if (v[CONFIG.LIST_KEY] && typeof v[CONFIG.LIST_KEY] === "object") return true;
      if (v.error === true) return true;
      return false;
    });
  }

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

  // Like findKey, but also accepts an array value (Zoho's EntityId can be one).
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
      state.clearOnRender = false;
      hideModal();
    }

    state.contactName = (payload.contact && payload.contact.name) || payload.contact_name || "";
    state.roles = normalizeRoles(payload[CONFIG.LIST_KEY]).sort(byPriority);
    state.roles.forEach(function (r) {
      if (!r.accountType && state.types[r.accountId]) r.accountType = state.types[r.accountId];
    });
    if (!keepPaging) state.shown = CONFIG.PAGE_SIZE;

    ContactTabs.render(payload);   // General / Passport / Emirates ID tabs + RV badge

    el.titleText.textContent = "Contact Profile";
    el.contactName.textContent = state.contactName;
    toggle(el.contactWrap, !!state.contactName);

    renderList();
    setMode("main");
    syncTabsHeight();      // keeps the floating search bar right under the tabs
    fillAccountTypes();
  }

  // Reads Account_Type straight from each Account record (as the signed-in user) for any company
  // the loader function didn't send it for. Results are cached for the session.
  function fillAccountTypes() {
    var ids = [];
    state.roles.forEach(function (r) {
      if (r.accountId && !r.accountType && state.types[r.accountId] === undefined && ids.indexOf(r.accountId) === -1) {
        ids.push(r.accountId);
      }
    });
    if (!ids.length) return;

    Promise.all(ids.map(function (id) {
      return ZOHO.CRM.API.getRecord({ Entity: CONFIG.ACCOUNTS_MODULE, RecordID: id })
        .then(function (res) {
          var rec = res && res.data && res.data[0];
          var v = rec ? rec[CONFIG.ACCOUNT_TYPE_FIELD] : "";
          state.types[id] = cleanType(v && typeof v === "object" ? v.name || v.value : v);
        })
        .catch(function (err) {
          logErr("Account_Type lookup failed for", id, err);
          state.types[id] = "";
        });
    })).then(function () {
      state.roles.forEach(function (r) {
        if (!r.accountType && state.types[r.accountId]) r.accountType = state.types[r.accountId];
      });
      renderList();
    });
  }

  /* ---------------- Company cards ---------------- */

  function matches(r) {
    if (!state.filter) return true;
    return (r.accountName + " " + r.accountType + " " + r.email + " " + r.phone).toLowerCase().indexOf(state.filter) !== -1;
  }

  function renderList() {
    var all = state.roles;
    var list = all.filter(matches);
    var visible = list.slice(0, state.shown);

    el.rows.innerHTML = "";
    visible.forEach(function (r) {
      el.rows.appendChild(buildCard(r));
    });

    toggle(el.filterWrap, all.length >= CONFIG.FILTER_MIN);
    var showAdd = canEdit() && CONFIG.SHOW_ADD;
    toggle(el.addRow, showAdd);
    toggle(el.filterWrap.parentNode, showAdd || all.length >= CONFIG.FILTER_MIN);

    var none = list.length === 0;
    toggle(el.empty, none);
    if (none) {
      if (all.length) {
        el.emptyTitle.textContent = "No matches";
        el.emptyText.textContent = "Try a different name, email or number.";
      } else {
        el.emptyTitle.textContent = "No companies yet";
        el.emptyText.textContent = canEdit()
          ? "Use Add company to link one."
          : "This contact isn't linked to any company yet.";
      }
    }

    var remaining = list.length - visible.length;
    toggle(el.more, remaining > 0);
    if (remaining > 0) {
      el.moreBtn.textContent = "Show " + Math.min(CONFIG.PAGE_SIZE, remaining) + " more (" + remaining + " remaining)";
    }
  }

  function initials(name) {
    var p = String(name || "?").trim().split(/\s+/);
    return (p[0].charAt(0) + (p[1] ? p[1].charAt(0) : "")).toUpperCase();
  }
  function buildCard(r) {
    var card = h("div", "co" + (r.pc ? " is-pc" : ""));

    var top = h("div", "co__top");
    top.appendChild(h("span", "co__av", initials(r.accountName)));
    var nm;
    if (r.accountId) {
      nm = h("a", "co__name", r.accountName || "(No account name)");
      nm.href = CONFIG.ACCOUNT_URL + r.accountId;
      nm.target = "_blank";
      nm.rel = "noopener noreferrer";
    } else {
      nm = h("span", "co__name", r.accountName || "(No account name)");
    }
    nm.title = r.accountName || "";
    var idBox = h("div", "co__id");
    idBox.appendChild(nm);
    if (r.accountType) {
      var tt = h("span", "type type--" + (CONFIG.ACCOUNT_TYPE_TONE[r.accountType] || "neutral"), r.accountType);
      tt.title = "Account type: " + r.accountType;
      idBox.appendChild(tt);
    }
    top.appendChild(idBox);
    if (canEdit()) {
      var actions = h("div", "co__actions");
      actions.appendChild(iconBtn("edit", "Edit", "", function () { startEdit(r); }));
      top.appendChild(actions);
    }
    card.appendChild(top);

    var info = h("div", "co__info");
    if (r.email) {
      var a = h("a", "co__line", r.email);
      a.href = "mailto:" + r.email;
      a.title = r.email;
      a.insertAdjacentHTML("afterbegin", ICONS.mail);
      info.appendChild(a);
    }
    if (r.phone) {
      var p = h("a", "co__line", r.phone);
      p.href = "tel:" + r.phone.replace(/[^\d+]/g, "");
      p.title = r.phone;
      p.insertAdjacentHTML("afterbegin", ICONS.phone);
      info.appendChild(p);
    }
    if (!r.email && !r.phone) info.appendChild(h("span", "co__line co__line--empty", "No contact details"));
    card.appendChild(info);

    var roles = h("div", "co__roles");
    var any = false;
    CONFIG.ROLE_FIELDS.forEach(function (f) {
      if (!r[f.key]) return;
      any = true;
      var pill = h("span", "pill pill--" + f.key, f.label);
      pill.title = f.full;
      roles.appendChild(pill);
    });
    if (!any) roles.appendChild(h("span", "pill pill--none", "No roles"));
    card.appendChild(roles);

    return card;
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

  function busy() {
    return !!(state.edit && state.edit.saving);
  }

  /* ---------------- Add / edit window ---------------- */

  function startEdit(r) {
    if (!canEdit() || busy()) return;
    state.edit = {
      id: r.id,
      isNew: false,
      account: r.accountId ? { id: r.accountId, name: r.accountName } : null,
      saving: false,
      refs: null
    };
    renderList();
    openModal(r);
    state.edit.refs.email.focus();
  }

  function startAdd() {
    if (!canEdit() || busy()) return;
    state.edit = { id: "", isNew: true, account: null, saving: false, refs: null };
    renderList();
    openModal(null);
    state.edit.refs.acc.focus();
  }

  function hideModal() {
    clearTimeout(searchTimer);
    state.searchToken++;
    closePcAlert();
    toggle(el.modal, false);
    el.dialog.classList.remove("is-saving");   // never carry the saving look into the next window
    el.dialog.innerHTML = "";
  }

  function closeModal() {
    if (!state.edit || state.edit.saving) return;
    state.edit = null;
    hideModal();
  }

  function field(labelText) {
    var f = h("div", "field");
    f.appendChild(h("label", "field__label", labelText));
    return f;
  }

  function textInput(placeholder, mode, value) {
    var i = h("input", "input");
    i.type = "text";
    if (mode) i.setAttribute("inputmode", mode);
    i.placeholder = placeholder;
    i.autocomplete = "off";
    i.setAttribute("aria-label", placeholder);
    i.value = value || "";
    return i;
  }

  function openModal(r) {
    var ed = state.edit;
    var refs = { roles: {}, controls: [], results: null, pickFirst: null };
    var dlg = el.dialog;
    dlg.classList.remove("is-saving");
    dlg.innerHTML = "";

    // Header
    var head = h("div", "dlg__head");
    var ttl = h("div", "dlg__ttl");
    ttl.appendChild(h("h2", "dlg__title", ed.isNew ? "Add company" : "Edit company"));
    ttl.appendChild(h("p", "dlg__sub", state.contactName ? "for " + state.contactName : "Link a company to this contact"));
    head.appendChild(ttl);
    var closeBtn = iconBtn("x", "Close", "", closeModal);
    head.appendChild(closeBtn);
    refs.controls.push(closeBtn);
    dlg.appendChild(head);

    var body = h("div", "dlg__body");

    // Company lookup (locked when editing an existing row; searchable when adding)
    var fAcc = field("Company");
    var accInput = textInput("Search account…", "", ed.account ? ed.account.name : "");
    if (ed.account) accInput.classList.add("is-picked");
    var results = h("div", "results hidden");
    fAcc.appendChild(accInput);
    fAcc.appendChild(results);
    body.appendChild(fAcc);
    refs.acc = accInput;
    refs.results = results;
    if (ed.isNew) {
      refs.controls.push(accInput);          // only Add mode toggles it during a save
    } else {
      accInput.disabled = true;              // Edit mode: company can't be changed
      accInput.classList.add("is-locked");
      accInput.title = "The company can't be changed when editing";
    }

    accInput.addEventListener("input", function () {
      ed.account = null;
      accInput.classList.remove("is-picked");
      onAccountInput(refs);
    });
    accInput.addEventListener("blur", function () { setTimeout(function () { hideResults(refs); }, 150); });
    accInput.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (!ed.account && refs.pickFirst) refs.pickFirst();
      else if (ed.account) submitEdit();
    });

    // Email + phone
    var fEmail = field("Email address");
    refs.email = textInput("name@company.com", "email", r ? r.email : "");
    fEmail.appendChild(refs.email);
    var fPhone = field("Contact number");
    refs.phone = textInput("+971 …", "tel", r ? r.phone : "");
    fPhone.appendChild(refs.phone);
    body.appendChild(fEmail);
    body.appendChild(fPhone);
    refs.controls.push(refs.email, refs.phone);

    // Roles
    var fRoles = field("Roles");
    var grid = h("div", "tgs");
    CONFIG.ROLE_FIELDS.forEach(function (f) {
      var lab = h("label", "tg tg--" + f.key);
      var inp = document.createElement("input");
      inp.type = "checkbox";
      inp.checked = r ? !!r[f.key] : false;
      var box = h("span", "tg__box");
      var chk = h("span", "tg__chk");
      chk.innerHTML = ICONS.tick;
      var txt = h("span", "tg__txt");
      txt.appendChild(h("b", "", f.label));
      txt.appendChild(h("small", "", f.full));
      box.appendChild(chk);
      box.appendChild(txt);
      lab.appendChild(inp);
      lab.appendChild(box);
      grid.appendChild(lab);
      refs.roles[f.key] = inp;
      refs.controls.push(inp);
    });
    fRoles.appendChild(grid);
    body.appendChild(fRoles);

    refs.err = h("div", "dlg__err hidden");
    body.appendChild(refs.err);
    dlg.appendChild(body);

    // Footer
    var foot = h("div", "dlg__foot");
    var cancel = h("button", "btn btn--ghost btn--lg", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", closeModal);
    var save = h("button", "btn btn--primary btn--lg", ed.isNew ? "Add company" : "Save changes");
    save.type = "button";
    save.addEventListener("click", submitEdit);
    foot.appendChild(cancel);
    foot.appendChild(save);
    dlg.appendChild(foot);
    refs.saveBtn = save;
    refs.controls.push(cancel, save);

    dlg.onkeydown = function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type === "text" && e.target !== accInput) {
        e.preventDefault();
        submitEdit();
      }
    };

    ed.refs = refs;
    toggle(el.modal, true);
  }

  function setRowError(msg) {
    var refs = state.edit && state.edit.refs;
    if (!refs) return;
    refs.err.textContent = msg || "";
    toggle(refs.err, !!msg);
    if (msg) refs.err.scrollIntoView({ block: "nearest" });
  }

  function setEditBusy(on) {
    var ed = state.edit;
    var refs = ed && ed.refs;
    if (!refs) return;
    el.dialog.classList.toggle("is-saving", on);
    refs.controls.forEach(function (c) { c.disabled = on; });
    refs.saveBtn.textContent = on ? "Saving…" : (ed.isNew ? "Add company" : "Save changes");
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
  }

  function pickAccount(rec, refs) {
    var ed = state.edit;
    if (!ed || ed.refs !== refs) return;
    ed.account = { id: String(rec.id), name: rec.Account_Name || "" };
    refs.acc.value = ed.account.name;
    refs.acc.classList.add("is-picked");
    hideResults(refs);
    setRowError("");
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
    if (!canEdit()) return;   // safety net: never save without permission
    var refs = ed.refs;

    setRowError("");

    if (!ed.account) {
      setRowError("Please pick a company from the search results.");
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

    // Only one primary contact (PC) per company: check the Account's Contacts_Roles first.
    var guard = args.pc === "true"
      ? checkPrimaryContact(ed.account)
      : Promise.resolve(null);

    guard
      .then(function (conflict) {
        if (conflict) {
          ed.saving = false;
          setEditBusy(false);
          showPcConflict(conflict, ed);   // popup in front, must click Okay
          return null;
        }
        return runWrite(args).then(function () {
          state.clearOnRender = true;
          toast(wasNew ? "Company added" : "Company updated", "ok");
          load(true);
        });
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

  // Resolves with { account, id, name } if ANOTHER contact is already the PC of this account, else null.
  function checkPrimaryContact(account) {
    return ZOHO.CRM.API.getRecord({ Entity: CONFIG.ACCOUNTS_MODULE, RecordID: account.id })
      .catch(function (err) {
        logErr("PC check failed", err);
        throw new Error("Couldn't check this company's primary contact, so nothing was saved. Please try again.");
      })
      .then(function (res) {
        var rec = res && res.data && res.data[0];
        if (!rec) throw new Error("Couldn't read the company record to check its primary contact. Nothing was saved.");
        var rows = rec[CONFIG.ACCOUNT_ROLES_FIELD];
        if (!Array.isArray(rows)) rows = [];
        var other = null;
        rows.some(function (row) {
          if (!row || !isTrue(row[CONFIG.PC_FIELD])) return false;
          if (rowIsThisContact(row)) return false;
          other = row;
          return true;
        });
        if (!other) return null;
        var who = rowContactInfo(other);
        return { account: account.name || "This company", id: who.id, name: who.name };
      });
  }

  // True when any lookup in the subform row points at the contact we're editing.
  function rowIsThisContact(row) {
    return Object.keys(row).some(function (k) {
      var v = row[k];
      return v && typeof v === "object" && String(v.id) === String(state.contactId);
    });
  }

  // The contact lookup of a subform row: the configured field first, then any lookup that looks like a contact.
  function rowContactInfo(row) {
    var info = { id: "", name: "" };
    var main = row[CONFIG.ROLES_CONTACT_FIELD];
    if (main && typeof main === "object") {
      info.id = main.id ? String(main.id) : "";
      info.name = main.name || "";
      if (info.id || info.name) return info;
    }
    Object.keys(row).forEach(function (k) {
      var v = row[k];
      if (v && typeof v === "object" && v.id && typeof v.name === "string" && v.name) {
        if (!info.name || /contact/i.test(k)) {
          info.id = String(v.id);
          info.name = v.name;
        }
      }
    });
    return info;
  }

  /* ---- "Primary contact already assigned" popup ---- */

  function closePcAlert() {
    if (pcAlertEl && pcAlertEl.parentNode) pcAlertEl.parentNode.removeChild(pcAlertEl);
    pcAlertEl = null;
  }

  // Popup in front of everything. Okay -> closes it, unticks PC and returns to the Edit window.
  function showPcConflict(c, ed) {
    closePcAlert();

    var wrap = h("div", "alert");
    var box = h("div", "alert__box");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");

    var head = h("div", "alert__head");
    var ico = h("span", "alert__ico");
    ico.innerHTML = ICONS.warn;
    head.appendChild(ico);
    head.appendChild(h("h3", "alert__title", "Primary contact already assigned"));
    box.appendChild(head);

    var msg = h("p", "alert__msg");
    msg.appendChild(document.createTextNode((c.account || "This company") + " already has a primary contact"));
    if (c.name) {
      msg.appendChild(document.createTextNode(": "));
      if (c.id) {
        var a = h("a", "alert__link", c.name);
        a.href = CONFIG.CONTACT_URL + c.id;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        msg.appendChild(a);
      } else {
        msg.appendChild(h("b", "", c.name));
      }
    }
    msg.appendChild(document.createTextNode("."));
    box.appendChild(msg);

    box.appendChild(h("p", "alert__note",
      "Only one primary contact is allowed per company. PC will be unticked for you; the other roles stay as you set them."));

    var foot = h("div", "alert__foot");
    var ok = h("button", "btn btn--primary btn--lg", "Okay");
    ok.type = "button";
    foot.appendChild(ok);
    box.appendChild(foot);

    wrap.appendChild(box);
    el.card.appendChild(wrap);
    pcAlertEl = wrap;

    pcAlertDismiss = function () {
      closePcAlert();
      if (state.edit === ed && ed.refs) {
        if (ed.refs.roles.pc) ed.refs.roles.pc.checked = false;
        if (ed.refs.saveBtn) ed.refs.saveBtn.focus();
      }
    };
    ok.addEventListener("click", pcAlertDismiss);
    ok.focus();
  }

  /* ---------------- Data shaping ---------------- */

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
          accountType: cleanType(n.account_type || n.Account_Type || n.accountType),
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

  // Keeps the floating search bar right under the tabs, whatever their height.
  function syncTabsHeight() {
    var t = $("tabs");
    if (t && t.offsetHeight) document.documentElement.style.setProperty("--tabs-h", t.offsetHeight + "px");
  }

  // msg = text or a DOM node. ms = how long it stays. top = true shows it at the top.
  function toast(msg, kind, ms, top) {
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    el.toast.textContent = "";
    if (msg && msg.nodeType) el.toast.appendChild(msg);
    else el.toast.textContent = msg;
    el.toast.className = "toast toast--" + (kind || "ok") + (top ? " toast--top" : "");
    var life = ms || (kind === "err" ? CONFIG.TOAST_ERR_MS : CONFIG.TOAST_MS);
    toastTimer = setTimeout(function () {
      el.toast.classList.add("is-out");                       // fade out
      toastHideTimer = setTimeout(function () {
        toggle(el.toast, false);
        el.toast.classList.remove("is-out");
      }, 350);
    }, life);
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
    try { navigator.clipboard.writeText(text).then(done, fallback); }
    catch (e) { fallback(); }
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

  // Account_Type is a text picklist: ignore booleans / "true" / "false" / "null" so they never show as a value.
  function cleanType(v) {
    if (v === true || v === false || v === null || v === undefined) return "";
    var t = String(v).trim();
    return /^(true|false|null|undefined)$/i.test(t) ? "" : t;
  }

  function isTrue(v) { return v === true || v === "true"; }
})();