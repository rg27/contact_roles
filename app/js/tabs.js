/* Contact Profile tabs: General / Passport / Emirates ID panes + Residence Visa badge.
   The Emirates ID tab is only shown when isRv is true.
   app.js calls ContactTabs.render(payload) after every successful load. */
(function () {
  "use strict";
  var WARN_DAYS = 90;
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var S = function (p, w) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 2.4) + '" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>";
  };
  var ICON_OK = S('<path d="m5 12.5 4.5 4.5L19 7.5"></path>', 3);
  var ICON_STAR = S('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"></path>', 2.2);
  var ICON_NO = S('<path d="M18 6 6 18M6 6l12 12"></path>', 3);
  var PANE_ICON = {
    general: S('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>'),
    passport: S('<rect x="5" y="3" width="14" height="18" rx="2"></rect><circle cx="12" cy="10" r="3"></circle><path d="M9 16.5h6"></path>'),
    eid: S('<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="11" r="2"></circle><path d="M6.5 16c.5-1.5 1.5-2 2.5-2s2 .5 2.5 2M14 10h4M14 13.5h3"></path>')
  };
  var SUB = {
    general: ["Personal details", "Identity and contact"],
    passport: ["Passport", "Travel document"],
    eid: ["Emirates ID", "UAE identity card"]
  };
  var active = "general";
  var hasRv = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function fmtDate(s) {
    var d = parseDate(s);
    return d ? d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() : "";
  }
  function age(s) {
    var d = parseDate(s); if (!d) return "";
    var n = new Date(), a = n.getFullYear() - d.getFullYear();
    if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
    return a >= 0 ? a + " yrs" : "";
  }
  function expiry(s) {
    var d = parseDate(s); if (!d) return null;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var days = Math.round((d - t) / 86400000);
    if (days < 0) return { cls: "bad", text: "Expired " + Math.abs(days) + "d ago" };
    if (days <= WARN_DAYS) return { cls: "warn", text: "Expires in " + days + "d" };
    return { cls: "ok", text: "Valid" };
  }

  function row(r) {
    var has = r.v !== undefined && r.v !== null && String(r.v) !== "";
    var val = has ? esc(r.v) : "—";
    if (has && r.href) val = '<a href="' + esc(r.href) + '">' + val + "</a>";
    if (has && r.sub) val += '<span class="dl__sub">' + esc(r.sub) + "</span>";
    if (has && r.chip) val += '<span class="chip chip--' + r.chip.cls + '">' + esc(r.chip.text) + "</span>";
    return '<div class="dl__row"><span class="dl__k">' + esc(r.k) + '</span>' +
      '<span class="dl__v' + (has ? "" : " dl__v--empty") + '">' + val + "</span>" +
      (has && r.copy ? '<button type="button" class="cp" data-copy="' + esc(r.v) + '">Copy</button>' : "<span></span>") + "</div>";
  }
  function pane(key, rows) {
    return '<div class="ph"><span class="ph__ico">' + PANE_ICON[key] + '</span><div><div class="ph__t">' +
      SUB[key][0] + '</div><div class="ph__s">' + SUB[key][1] + '</div></div></div>' +
      '<div class="dl">' + rows.map(row).join("") + "</div>";
  }

  function setDot(id, exp) {
    var d = $(id); if (!d) return;
    var show = exp && exp.cls !== "ok";
    d.classList.toggle("hidden", !show);
    d.classList.toggle("is-bad", !!(exp && exp.cls === "bad"));
    d.title = show ? exp.text : "";
  }

  // isRv false            -> "No active Residence Visa"
  // isRv true             -> "Active Residence Visa"
  // isRv true + free_for_life true -> "With FFL RV"   (free_for_life only counts when isRv is true)
  function renderRV(yes, ffl) {
    var b = $("rvBadge"); if (!b) return;
    if (yes && ffl) {
      b.className = "rv rv--ffl";
      b.innerHTML = ICON_STAR + "With FFL RV";
      b.title = "Active Residence Visa, free for life";
    } else if (yes) {
      b.className = "rv rv--yes";
      b.innerHTML = ICON_OK + "With RV";
      b.title = "Active Residence Visa";
    } else {
      b.className = "rv rv--no";
      b.innerHTML = ICON_NO + "No RV";
      b.title = "No active Residence Visa";
    }
  }

  function truthy(v) { return v === true || v === "true"; }

  function render(p) {
    var g = p.general_info_map || {}, pp = p.passport_map || {}, e = p.eid_map || {};
    hasRv = truthy(p.isRv);
    renderRV(hasRv, hasRv && truthy(p.free_for_life));

    $("pane-general").innerHTML = pane("general", [
      { k: "Full name", v: p.contact_name },
      { k: "Nationality", v: g.primary_nationality },
      { k: "Date of birth", v: fmtDate(g.date_of_birth), sub: age(g.date_of_birth) },
      { k: "Gender", v: g.gender },
      { k: "Email", v: g.primary_email, href: g.primary_email ? "mailto:" + g.primary_email : "", copy: true },
      { k: "Mobile", v: g.primary_mobile, href: g.primary_mobile ? "tel:" + String(g.primary_mobile).replace(/[^\d+]/g, "") : "", copy: true }
    ]);

    var ppx = expiry(pp.pp_expiry_date);
    $("pane-passport").innerHTML = pane("passport", [
      { k: "Passport number", v: pp.passport_number, copy: true },
      { k: "Issuing country", v: pp.passport_issuing_country },
      { k: "Issue date", v: fmtDate(pp.pp_issue_date) },
      { k: "Expiry date", v: fmtDate(pp.pp_expiry_date), chip: ppx }
    ]);
    setDot("dot-passport", ppx);

    // Emirates ID: only for clients with an active Residence Visa
    var ex = hasRv ? expiry(e.eid_expiry_date) : null;
    $("pane-eid").innerHTML = pane("eid", [
      { k: "Emirates ID", v: e.eid_number, copy: true },
      { k: "Issue date", v: fmtDate(e.eid_issue_date) },
      { k: "Expiry date", v: fmtDate(e.eid_expiry_date), chip: ex }
    ]);
    setDot("dot-eid", ex);
    $("tab-eid").classList.toggle("hidden", !hasRv);

    $("tabCount").textContent = String(Array.isArray(p.shareholder) ? p.shareholder.length : 0);
    select(active);
  }

  function select(name) {
    if (name === "eid" && !hasRv) name = "general";
    active = name;
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      var on = t.getAttribute("data-tab") === name;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    ["general", "passport", "eid", "roles"].forEach(function (k) {
      $("pane-" + k).classList.toggle("hidden", k !== name);
    });
    var body = $("main-view"); if (body) body.scrollTop = 0;
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest && ev.target.closest(".tab");
    if (t) { select(t.getAttribute("data-tab")); return; }
    var c = ev.target.closest && ev.target.closest(".cp");
    if (c) {
      var txt = c.getAttribute("data-copy");
      var done = function () { c.textContent = "Copied"; setTimeout(function () { c.textContent = "Copy"; }, 1200); };
      try { navigator.clipboard.writeText(txt).then(done, done); } catch (x) { done(); }
    }
  });
  document.addEventListener("keydown", function (ev) {
    if ((ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") || !ev.target.classList || !ev.target.classList.contains("tab")) return;
    var tabs = Array.prototype.filter.call(document.querySelectorAll(".tab"), function (t) { return !t.classList.contains("hidden"); });
    var i = tabs.indexOf(ev.target) + (ev.key === "ArrowRight" ? 1 : -1);
    var next = tabs[(i + tabs.length) % tabs.length];
    next.focus(); select(next.getAttribute("data-tab"));
  });

  window.ContactTabs = { render: render, select: select };
})();