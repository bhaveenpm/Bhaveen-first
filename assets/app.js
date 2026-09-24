/* ============================================================
   Halden — the Triage desk.
   Every piece of markup here is a design-system component
   (design/system/components), emitted as plain HTML so the
   prototype needs no build step. The React versions of the same
   components live in design/system/components/bundle.js.
   ============================================================ */

const root = document.getElementById("root");
const overlay = document.getElementById("overlay");
const toastSlot = document.getElementById("toast");

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cx = (...c) => c.filter(Boolean).join(" ");
const fmtDay = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const shortName = (name) => { const p = name.split(" "); return p[0] + " " + p[p.length - 1][0] + "."; };
const firstName = (name) => name.split(" ")[0];

/* localStorage can throw in a private window or a sandboxed frame */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
function session() { try { return JSON.parse(store.get("halden.session")); } catch (e) { return null; } }
session.set = (v) => store.set("halden.session", JSON.stringify(v));
session.clear = () => store.del("halden.session");

const S = { scope: store.get("halden.scope") || "mine", sel: 0, last: null };

/* ============================================================
   Components, as HTML. Names and classes match the design system.
   ============================================================ */

const MARK_WORDS = { promise: "A promise you made", reply: "Waiting on a reply", meeting: "A meeting today", quiet: "Going quiet", renewal: "Renewal ahead" };
const ReasonMark = (kind, late, label) => {
  const name = label === undefined ? MARK_WORDS[kind] + (late ? ", late" : "") : label;
  return `<span class="${cx("hd-mark", "hd-mark-" + kind, late && "is-late")}" ${name ? `role="img" aria-label="${esc(name)}" title="${esc(name)}"` : 'aria-hidden="true"'}><i></i></span>`;
};
const Key = (k) => `<kbd class="hd-key">${esc(k)}</kbd>`;
const KeyButton = (key, label, { primary, attrs = "" } = {}) =>
  `<button type="button" class="${cx("hd-keybtn", primary && "is-primary")}" ${attrs}>${key ? Key(key) : ""}${esc(label)}</button>`;
const Segmented = (label, value, options, attr) =>
  `<div class="hd-seg" role="group" aria-label="${esc(label)}">${options
    .map((o) => `<button type="button" ${attr}="${o.value}" aria-pressed="${o.value === value}">${esc(o.label)}</button>`)
    .join("")}</div>`;
const GroupHeader = (label, count, late) =>
  `<div class="${cx("hd-group", late && "is-late")}" role="presentation"><span>${esc(label)}</span><span>${count}</span></div>`;
const QueueRow = ({ kind, late, who, what, age, selected, waiting, i }) => {
  const cells = `${ReasonMark(kind, late)}<span class="hd-row-who">${esc(who)}</span><span class="hd-row-what">${esc(what)}</span><span class="hd-row-age">${esc(age)}</span>`;
  return waiting
    ? `<div class="hd-row is-waiting">${cells}</div>`
    : `<button type="button" role="option" id="row-${i}" data-i="${i}" aria-selected="${!!selected}" class="${cx("hd-row", late && "is-late")}">${cells}</button>`;
};
const Eyebrow = (kind, late, text) => `<div class="${cx("hd-eyebrow", late && "is-late")}">${ReasonMark(kind, late, "")}${esc(text)}</div>`;
const WhyBlock = (reason, detail, also, late) =>
  `<div class="${cx("hd-why", late && "is-late")}"><span><b>${esc(reason)}</b> ${esc(detail || "")}</span>${also ? `<span class="hd-why-also">Also owed: ${esc(also)}</span>` : ""}</div>`;
const FactStrip = (facts, fill) =>
  `<div class="${cx("hd-facts", fill && "is-fill")}">${facts
    .map((f) => `<div class="hd-fact"><span class="hd-fact-k">${esc(f.label)}</span><span class="${cx("hd-fact-v", f.figure && "is-figure", f.late && "is-late")}" title="${esc(f.value)}">${esc(f.value)}</span></div>`)
    .join("")}</div>`;
const ContactHeat = (cells, summary) =>
  `<div class="hd-heat">
    <div class="hd-heat-row"><span class="hd-fact-k">Contact · last ${cells.length} days</span>
      <span class="hd-heat-key">${[["call", "var(--ink)"], ["email", "var(--ink-faint)"], ["meeting", "var(--meeting)"], ["note", "var(--select)"]]
        .map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("")}</span></div>
    <div class="hd-heat-cells" style="--days:${cells.length}" role="img" aria-label="Contact over the last ${cells.length} days">${cells
      .map((c) => `<i${c ? ` class="${c.type}" title="${esc(c.title)}"` : ""}></i>`).join("")}</div>
    <div class="hd-heat-row"><span>${summary}</span></div>
  </div>`;
const LogTable = (entries, empty) =>
  `<table class="hd-logtable"><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Who</th><th scope="col">What was said</th></tr></thead><tbody>${
    entries.length
      ? entries.map((r) => `<tr><td class="m">${esc(r.date)}</td><td class="m">${esc(r.type)}</td><td class="${cx("m", r.you && "you")}">${r.you ? "you" : esc(r.who)}</td><td>${esc(r.note)}</td></tr>`).join("")
      : `<tr class="is-empty"><td colspan="4">${esc(empty)}</td></tr>`
  }</tbody></table>`;
const PromiseItem = (c, late) =>
  `<div class="${cx("hd-promise", c.done && "is-done")}"><button type="button" data-commit="${c.id}" aria-pressed="${!!c.done}" aria-label="${c.done ? "Reopen" : "Mark kept"}: ${esc(c.what)}"></button><span class="hd-promise-what">${esc(c.what)}</span><span class="${cx("hd-promise-due", late && "is-late")}">${esc(relDay(c.dueOn))}</span></div>`;
const LogInput = (placeholder) =>
  `<form class="hd-log" data-log><input id="log-input" placeholder="${esc(placeholder)}" aria-label="Log a contact" autocomplete="off">${KeyButton("", "Log", { primary: true, attrs: 'type="submit"' }).replace('type="button" ', "")}</form>`;
const Box = (title, body) => `<section class="hd-box"><h3 class="hd-box-title">${esc(title)}</h3>${body}</section>`;
const EmptyState = (title, text, rules, actions) =>
  `<div class="hd-empty"><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ""}${
    rules ? `<div class="hd-empty-rules">${rules.map((r) => `<div>${ReasonMark(r.kind, false, "")}<span><b>${esc(r.title)}</b> ${esc(r.text)}</span></div>`).join("")}</div>` : ""
  }${actions ? `<div class="hd-empty-acts">${actions}</div>` : ""}</div>`;

function TopBar(current, where, end) {
  const me = session();
  const due = derive(S.scope, me.userId).filter((a) => a.bucket === "late" || a.bucket === "now").length;
  const nav = [["Today", "#/today", "today", due], ["Deals", "#/deals", "deals"], ["People", "#/people", "people"]];
  return `<header class="hd-top">
    <span class="hd-brand"><i></i>HALDEN</span>
    <nav class="hd-top-nav" aria-label="Screens">${nav
      .map(([label, href, key, count]) => `<a href="${href}" ${current === key ? 'aria-current="page"' : ""}>${label}${count ? `<span class="hd-top-count" aria-label="${count} due">${count}</span>` : ""}</a>`)
      .join("")}</nav>
    ${where ? `<span class="hd-top-where">${where}</span>` : ""}
    <div class="hd-top-end">${end || ""}<button type="button" class="hd-me" id="me" aria-label="Account: ${esc(me.name)}" title="${esc(me.name)}">${esc(me.initials)}</button></div>
  </header>`;
}
const KeyLegend = (keys, done, total) =>
  `<footer class="hd-legend"><span class="hd-legend-keys">${keys
    .map(([k, label]) => [].concat(k).map(Key).join("") + `<em>${esc(label)}</em>`).join("")}</span>${
    total ? `<span class="hd-progress">${done} / ${total} cleared<span class="hd-progress-bar" role="progressbar" aria-label="Day cleared" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${Math.round((done / total) * 100)}%"></i></span></span>` : ""
  }</footer>`;

function toast(text, onUndo) {
  toastSlot.innerHTML = `<div class="hd-toast" role="status"><span>${text}</span>${onUndo ? '<button type="button">Undo</button>' : ""}</div>`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (toastSlot.innerHTML = ""), onUndo ? 5000 : 2600);
  if (onUndo) toastSlot.querySelector("button").onclick = () => { toastSlot.innerHTML = ""; onUndo(); };
}

function wireChrome() {
  const btn = document.getElementById("me");
  if (!btn) return;
  btn.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll(".menu").forEach((m) => m.remove());
    const me = session();
    const r = btn.getBoundingClientRect();
    const m = document.createElement("div");
    m.className = "menu hd-box";
    m.innerHTML = `<div class="who"><b>${esc(me.name)}</b><span>${esc(me.email)}</span></div>
      <button type="button" class="item" id="signout">Sign out</button>`;
    document.body.appendChild(m);
    m.style.top = r.bottom + 8 + "px";
    m.style.left = Math.max(8, r.right - m.offsetWidth) + "px";
    m.querySelector("#signout").onclick = () => { session.clear(); m.remove(); location.hash = "#/signin"; render(); };
    m.querySelector("#signout").focus();
    const close = (ev) => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("click", close); } };
    setTimeout(() => document.addEventListener("click", close), 0);
  };
}

/* ============================================================
   SIGN IN — simulated Google, no credentials, no network
   ============================================================ */

const GMARK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 01-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 01-10.7-3.8h-4v3.1A12 12 0 0012 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.1 7.1 0 010-4.6v-3.1h-4a12 12 0 000 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 001.4 6.6l4 3.1A7.2 7.2 0 0112 4.8z"/></svg>';

const GOOGLE_ACCOUNTS = [
  { userId: "u1", name: "Priya Raman", email: "priya@haldenworks.com", initials: "PR", tint: "#a07520" },
  { userId: "u2", name: "Tomás Vidal", email: "tomas@haldenworks.com", initials: "TV", tint: "#2e2fa6" },
];

function renderAuth() {
  const sample = [
    { kind: "promise", late: true, who: "Nadia O.", what: "Send the revised scope doc", age: "3d late", selected: true },
    { kind: "meeting", who: "Rina S.", what: "Grip study kickoff at 14:00", age: "14:00" },
    { kind: "reply", who: "Marcus F.", what: "Chase the proposal", age: "9d" },
    { kind: "quiet", who: "Jonah B.", what: "Restart it or close it out", age: "34d" },
  ];
  root.innerHTML = `<div class="app"><main id="main">
    <div class="auth">
      <section class="auth-pitch">
        <span class="hd-brand"><i></i>HALDEN</span>
        <h1 class="type-title">What needs you today, and why.</h1>
        <p class="type-body">A CRM for teams of two to ten. Halden reads your promises, your calendar and your silences, and hands you one queue to clear before lunch.</p>
        <div class="auth-sample" aria-label="Example of a day in Halden">
          ${GroupHeader("Your day", sample.length)}
          ${sample.map((r, i) => QueueRow({ ...r, i: "s" + i })).join("")}
          ${KeyLegend([[["J", "K"], "move"], ["E", "done"], ["S", "tomorrow"]], 0, 0)}
        </div>
      </section>
      <section class="auth-side">
        <div class="hd-box">
          <h2 class="type-heading">Sign in to Halden</h2>
          <p class="muted">Halden uses your work Google account to read your calendar and contacts.</p>
          <button type="button" class="gbtn" id="gsi">${GMARK}<span>Continue with Google</span></button>
          <p class="note">This is a prototype. The sign-in is simulated: it never contacts Google and never asks for a password.</p>
        </div>
      </section>
    </div></main></div>`;
  root.querySelectorAll(".auth-sample .hd-row").forEach((r) => r.setAttribute("tabindex", "-1"));
  document.getElementById("gsi").onclick = chooser;
}

function sheet(html) {
  overlay.innerHTML = `<div class="veil"><div class="gsheet" role="dialog" aria-modal="true" aria-label="Simulated Google sign-in">
    <div class="gsheet-demo">Simulated · prototype only · no password</div>${html}</div></div>`;
  const first = overlay.querySelector("button");
  if (first) first.focus();
}

function chooser() {
  sheet(`<div class="gsheet-head"><div class="glogo"><i>${GMARK}</i><b>Google</b></div>
      <h3>Choose an account</h3><p>to continue to <b>Halden</b></p></div>
    ${GOOGLE_ACCOUNTS.map((a, i) => `<button type="button" class="gacct" data-i="${i}"><span class="av" style="background:${a.tint}">${esc(a.initials)}</span>
      <span><span class="nm">${esc(a.name)}</span><br><span class="em">${esc(a.email)}</span></span></button>`).join("")}
    <button type="button" class="gacct alt" data-i="-1"><span class="av">+</span><span class="nm">Use another account</span></button>
    <div class="gsheet-foot">To continue, Google will share your name, email address and profile picture with Halden.</div>
    <div class="gactions"><button type="button" class="gtext" id="cancel">Cancel</button></div>`);
  overlay.querySelectorAll(".gacct").forEach((b) => (b.onclick = () => {
    const i = +b.dataset.i;
    if (i < 0) return toast("Only the two example accounts work in this prototype.");
    consent(GOOGLE_ACCOUNTS[i]);
  }));
  document.getElementById("cancel").onclick = () => { overlay.innerHTML = ""; document.getElementById("gsi").focus(); };
}

function consent(acct) {
  sheet(`<div class="gsheet-head"><div class="glogo"><i>${GMARK}</i><b>Google</b></div>
      <h3>Halden wants access to your Google Account</h3><p><b>${esc(acct.email)}</b></p>
      <ul class="gscopes">
        <li>See events on your calendar, so meetings show up in your day</li>
        <li>See your contacts, to match people to accounts</li>
        <li>Nothing is written back to your Google Account</li>
      </ul></div>
    <div class="gactions"><button type="button" class="gtext" id="back">Cancel</button><button type="button" class="gtext primary" id="allow">Continue</button></div>`);
  document.getElementById("back").onclick = chooser;
  document.getElementById("allow").onclick = () => {
    sheet(`<div class="gwait"><div class="spinner"></div><p>Signing you in to Halden…</p></div>`);
    setTimeout(() => {
      session.set(acct);
      overlay.innerHTML = "";
      location.hash = "#/today";
      render();
      toast(`Signed in as ${esc(acct.name)}. Calendar and contacts connected.`);
    }, 1100);
  };
}

/* ============================================================
   TODAY — the queue beside the detail
   ============================================================ */

const KIND = { promise: "Promise", meeting: "Meeting today", reply: "No reply", quiet: "Going quiet", renewal: "Renewal" };

function ageOf(a) {
  if (a.kind === "promise") {
    const late = daysFrom(byId(COMMITMENTS, a.commitmentId).dueOn, TODAY);
    return late > 0 ? late + "d late" : "today";
  }
  if (a.kind === "meeting") return byId(MEETINGS, a.id.replace("act-", "")).at;
  const deal = byId(DEALS, a.dealId);
  if (a.kind === "reply") return daysFrom(deal.sentOn, TODAY) + "d";
  if (a.kind === "renewal") return "in " + daysFrom(TODAY, deal.renewalOn) + "d";
  return daysQuiet(a.personId) + "d";
}

function today() {
  const me = session();
  const all = derive(S.scope, me.userId, { all: true });
  const live = derive(S.scope, me.userId);
  const order = grouped(live).flatMap((g) => g.items);
  const pending = PENDING.filter((w) => S.scope === "studio" || w.ownerId === me.userId);
  return { all, live, order, pending };
}

function resolve(a) {
  RESOLVED.add(a.id);
  (a.folded || []).forEach((f) => RESOLVED.add(f.id));
  S.last = a;
}
function undo() {
  if (!S.last) return false;
  RESOLVED.delete(S.last.id);
  (S.last.folded || []).forEach((f) => RESOLVED.delete(f.id));
  S.last = null;
  return true;
}

function renderToday() {
  const { all, live, order, pending } = today();
  S.sel = Math.max(0, Math.min(S.sel, order.length - 1));
  const cur = order[S.sel];
  const done = all.length - live.length;
  const late = live.filter((a) => a.bucket === "late").length;

  let i = -1;
  const queue =
    grouped(live).map((g) => GroupHeader(g.label, g.items.length, g.id === "late") + g.items.map((a) => {
      i++;
      return QueueRow({ kind: a.mark, late: a.bucket === "late", who: shortName(byId(PEOPLE, a.personId).name), what: a.headline, age: ageOf(a), selected: i === S.sel, i });
    }).join("")).join("") +
    (live.length ? "" : EmptyState("Queue clear", `${done} of ${all.length} done. Nothing else is due today.`)) +
    (pending.length ? GroupHeader("With them", pending.length) + pending.map((w) =>
      QueueRow({ kind: "reply", waiting: true, who: shortName(byId(PEOPLE, w.personId).name), what: w.what, age: daysFrom(w.sentOn, TODAY) + "d" })).join("") : "");

  let detail;
  if (!cur) {
    detail = `<div class="hd-eyebrow">Done for today</div>
      <h2 class="type-title">Nothing left in the queue.</h2>
      ${WhyBlock(`${pending.length} thing${pending.length === 1 ? " is" : "s are"} with the other side.`, `${pending.length === 1 ? "It comes" : "They come"} back here if ${pending.length === 1 ? "it goes" : "they go"} stale.`)}
      <div class="acts">${KeyButton("U", "Undo last", { attrs: 'data-key="u"' })}${KeyButton("", "Look at the deals", { attrs: 'data-go="#/deals"' })}</div>`;
  } else {
    const p = byId(PEOPLE, cur.personId);
    const acct = byId(ACCOUNTS, p.accountId);
    const deal = cur.dealId ? byId(DEALS, cur.dealId) : null;
    const h = deal ? dealHealth(deal) : null;
    const folded = (cur.folded || []).filter((f) => f.kind === "promise").map((f) => f.headline).join("; ");
    const lateNow = cur.bucket === "late";
    detail = `${Eyebrow(cur.mark, lateNow, KIND[cur.kind] + " · " + BUCKETS.find((b) => b.id === cur.bucket).label)}
      <h2 class="type-title" id="detail-title">${esc(cur.headline)}</h2>
      <div class="wholine type-body"><a href="#/p/${p.id}">${esc(p.name)}</a> · ${esc(p.title)} · ${esc(acct.name)}${cur.ownerId !== session().userId ? ` · ${esc(firstName(byId(TEAM, cur.ownerId).name))} owns this` : ""}</div>
      ${WhyBlock(cur.why.bold, cur.why.tail, folded, lateNow)}
      ${deal ? FactStrip([
        { label: "Deal", value: deal.title },
        { label: "Value", value: money(deal.value), figure: true },
        { label: "Stage", value: h.stage.label + " · " + (deal.renewalOn ? "renews " + relDay(deal.renewalOn) : h.inStage + "d") },
        { label: "Owner", value: firstName(byId(TEAM, deal.ownerId).name) },
      ], true) : ""}
      <div class="recent"><span class="hd-fact-k">Last three</span>
        ${touchesFor(p.id).slice(0, 3).map((t) => `<div class="recent-row"><span>${esc(fmtDay(t.on))}</span><span>${esc(t.type)}</span><p>${esc(t.note)}</p></div>`).join("")}
      </div>
      <div class="acts">
        ${KeyButton("E", cur.verb, { primary: true, attrs: 'data-key="e"' })}
        ${KeyButton("S", "Tomorrow", { attrs: 'data-key="s"' })}
        ${KeyButton("↵", "Open " + firstName(p.name), { attrs: 'data-key="enter"' })}
      </div>`;
  }

  root.innerHTML = `<div class="app">
    ${TopBar("today", esc(weekdayOf(TODAY)) + " " + esc(fmtDay(TODAY)),
      Segmented("Whose queue", S.scope, [{ value: "mine", label: "Mine" }, { value: "studio", label: "Studio" }], "data-scope") +
      `<span class="hd-counts">${late ? `<span class="is-late">${late} late</span>` : ""}<span><b>${live.length}</b> open</span></span>`)}
    <main id="main" class="desk">
      <div class="queue" role="listbox" aria-label="Today's queue" ${cur ? `aria-activedescendant="row-${S.sel}"` : ""} tabindex="-1">${queue}</div>
      <section class="detail" aria-labelledby="detail-title">${detail}</section>
    </main>
    ${KeyLegend([[["J", "K"], "move"], ["E", "done"], ["S", "tomorrow"], ["↵", "open"], ["U", "undo"]], done, all.length)}
  </div>`;

  wireChrome();
  root.querySelectorAll(".hd-row[data-i]").forEach((r) => (r.onclick = () => { S.sel = +r.dataset.i; render(); focusSelected(); }));
  root.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => { S.scope = b.dataset.scope; S.sel = 0; store.set("halden.scope", S.scope); render(); }));
  root.querySelectorAll("[data-key]").forEach((b) => (b.onclick = () => todayKey(b.dataset.key)));
  root.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => (location.hash = b.dataset.go)));
  const sel = root.querySelector('.hd-row[aria-selected="true"]');
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function focusSelected() {
  const sel = root.querySelector('.hd-row[aria-selected="true"]');
  if (sel) sel.focus({ preventScroll: true });
}

function todayKey(key) {
  const { order } = today();
  const cur = order[S.sel];
  if (key === "j") { S.sel = Math.min(S.sel + 1, order.length - 1); render(); focusSelected(); return true; }
  if (key === "k") { S.sel = Math.max(S.sel - 1, 0); render(); focusSelected(); return true; }
  if (key === "u") { if (undo()) { render(); toast("Undone."); } return true; }
  if (!cur) return false;
  if (key === "e") {
    resolve(cur);
    render();
    focusSelected();
    toast(`${esc(cur.verb.replace(/^Mark /, "Marked "))} · ${esc(byId(PEOPLE, cur.personId).name)}`, () => { undo(); render(); });
    return true;
  }
  if (key === "s") { SNOOZED.add(cur.id); render(); toast("Moved to tomorrow."); return true; }
  if (key === "enter") { location.hash = "#/p/" + cur.personId; return true; }
  return false;
}

/* ============================================================
   RELATIONSHIP
   ============================================================ */

function renderPerson(id) {
  const p = byId(PEOPLE, id);
  if (!p) { location.hash = "#/today"; return; }
  const acct = byId(ACCOUNTS, p.accountId);
  const deal = DEALS.find((x) => x.personId === p.id);
  const h = deal ? dealHealth(deal) : null;
  const touches = touchesFor(p.id);
  const commits = COMMITMENTS.filter((c) => c.personId === p.id);
  const meets = MEETINGS.filter((m) => m.personId === p.id && m.on >= TODAY);
  const last = touches[0];
  const quiet = last ? daysFrom(last.on, TODAY) : null;
  const cadence = h ? h.stage.cadence : 14;
  const lateOwed = commits.filter((c) => !c.done && daysFrom(c.dueOn, TODAY) > 0).length;

  const byDay = {};
  touches.forEach((t) => (byDay[t.on] = t));
  const cells = [];
  for (let i = 59; i >= 0; i--) {
    const t = byDay[addDays(TODAY, -i)];
    cells.push(t ? { type: t.type, title: t.on + " — " + t.note } : null);
  }
  const summary = !last ? "No contact yet. The silence clock starts at the first thing you log."
    : quiet > cadence ? `<b>${quiet} days quiet.</b> ${esc(h ? h.stage.label : "This stage")} allows ${cadence}.`
    : `Last contact ${esc(relDay(last.on))}, inside the ${cadence}-day cadence.`;

  root.innerHTML = `<div class="app">
    ${TopBar("people", `<b>${esc(acct.name)}</b> · ${esc(acct.sector)}`, `<button type="button" class="crumb" id="back">← Queue</button>`)}
    <main id="main" class="page"><div class="page-inner">
      <div class="rel-top">
        <div class="rel-id"><span class="tile" aria-hidden="true">${esc(p.initials)}</span>
          <div><h1 class="type-title">${esc(p.name)}</h1><p class="type-small">${esc(p.title)} · ${esc(p.email)}</p></div></div>
        ${FactStrip([
          { label: "Value", value: deal ? money(deal.value) : "—", figure: !!deal },
          { label: "Stage", value: h ? h.stage.label + " · " + (deal.renewalOn ? "renews " + relDay(deal.renewalOn) : h.inStage + "d") : "—" },
          { label: "Last touch", value: !last ? "never" : quiet === 0 ? "today" : quiet + "d ago", late: quiet !== null && quiet > cadence },
          { label: "You owe", value: lateOwed ? lateOwed + " late" : "nothing", late: !!lateOwed },
        ])}
      </div>
      ${ContactHeat(cells, summary)}
      <div class="rel-grid">
        <div class="table-wrap">${LogTable(touches.map((t) => ({ date: fmtDay(t.on), type: t.type, who: firstName(p.name), you: t.dir === "out", note: t.note })), "Nothing logged yet. Write the first note on the right.")}</div>
        <div class="side">
          ${Box("Log", LogInput("Call, note, or a promise…"))}
          ${Box("Promises", commits.length ? commits.map((c) => PromiseItem(c, !c.done && daysFrom(c.dueOn, TODAY) > 0)).join("") : `<p class="muted">Nothing promised yet.</p>`)}
          ${Box("Next meeting", meets.length ? meets.map((m) => `<div><b>${esc(m.title)}</b><p class="muted">${esc(relDay(m.on))} · ${esc(m.at)} · ${esc(m.where)}</p></div>`).join("") : `<p class="muted">Nothing on the calendar.</p>`)}
        </div>
      </div>
    </div></main>
    ${KeyLegend([["L", "log"], ["Esc", "back to queue"]], 0, 0)}
  </div>`;

  wireChrome();
  document.getElementById("back").onclick = () => (location.hash = "#/today");
  const form = root.querySelector("[data-log]");
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = form.querySelector("input").value.trim();
    if (!v) return;
    TOUCHES.push({ id: "t" + Date.now(), personId: p.id, on: TODAY, type: "note", dir: "out", note: v });
    render();
    toast(`Logged · ${esc(p.name)}. Silence clock reset.`);
  };
  root.querySelectorAll("[data-commit]").forEach((b) => (b.onclick = () => {
    const c = byId(COMMITMENTS, b.dataset.commit);
    c.done = !c.done;
    render();
    toast(c.done ? `Kept · ${esc(c.what)}` : `Reopened · ${esc(c.what)}`);
  }));
}

/* ============================================================
   DEALS
   ============================================================ */

function renderDeals() {
  const me = session();
  const rows = DEALS.filter((x) => S.scope === "studio" || x.ownerId === me.userId).map((deal) => ({ deal, h: dealHealth(deal) }));
  const open = rows.filter((r) => r.deal.stage !== "retained");
  const total = open.reduce((s, r) => s + r.deal.value, 0);
  const flagKind = (r) => {
    const f = r.h.flag || "";
    if (/late/.test(f)) return ["promise", true];
    if (/^Renews/.test(f)) return ["renewal", false];
    if (/No reply/.test(f)) return ["reply", false];
    if (/quiet|Stalled/.test(f)) return ["quiet", false];
    return null;
  };

  root.innerHTML = `<div class="app">
    ${TopBar("deals", "", Segmented("Whose deals", S.scope, [{ value: "mine", label: "Mine" }, { value: "studio", label: "Studio" }], "data-scope") +
      `<span class="hd-counts"><span><b>${money(total)}</b> open</span></span>`)}
    <main id="main" class="page"><div class="page-inner">
      <h1 class="type-title">${open.length} open deal${open.length === 1 ? "" : "s"}, ${rows.filter((r) => r.h.flag).length} need something</h1>
      ${FactStrip(STAGES.map((s) => {
        const inStage = rows.filter((r) => r.deal.stage === s.id);
        const v = inStage.reduce((a, r) => a + r.deal.value, 0);
        return { label: s.label, value: inStage.length + (v ? " · " + money(v) : ""), figure: true };
      }), true)}
      <div class="table-wrap"><table class="hd-logtable">
        <thead><tr><th scope="col">Deal</th><th scope="col">Value</th><th scope="col">Stage</th><th scope="col">Last heard</th><th scope="col">Needs</th><th scope="col">Owner</th></tr></thead>
        <tbody>${rows
          .sort((a, b) => (a.h.flag ? 0 : 1) - (b.h.flag ? 0 : 1) || b.deal.value - a.deal.value)
          .map(({ deal, h }) => {
            const p = byId(PEOPLE, deal.personId);
            const fk = flagKind({ h });
            return `<tr>
              <td><a href="#/p/${p.id}">${esc(deal.title)}</a><span class="sub">${esc(byId(ACCOUNTS, deal.accountId).name)} · ${esc(p.name)}</span></td>
              <td class="m">${money(deal.value)}</td>
              <td>${esc(h.stage.label)}<span class="sub">${deal.renewalOn ? "renews " + esc(relDay(deal.renewalOn)) : h.inStage + " days in stage"}</span></td>
              <td class="m">${esc(relDay(lastTouch(p.id).on))}</td>
              <td>${fk ? `<span class="${cx("flag", fk[1] && "is-late")}">${ReasonMark(fk[0], fk[1], "")}${esc(h.flag)}</span>` : `<span class="flag is-calm">Nothing</span>`}</td>
              <td class="m">${esc(firstName(byId(TEAM, deal.ownerId).name))}</td>
            </tr>`;
          }).join("")}</tbody>
      </table></div>
    </div></main>
    ${KeyLegend([], 0, 0)}
  </div>`;
  wireChrome();
  root.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => { S.scope = b.dataset.scope; store.set("halden.scope", S.scope); render(); }));
}

/* ============================================================
   PEOPLE
   ============================================================ */

function renderPeople() {
  root.innerHTML = `<div class="app">
    ${TopBar("people", "")}
    <main id="main" class="page"><div class="page-inner">
      <h1 class="type-title">${PEOPLE.length} people across ${ACCOUNTS.length} accounts</h1>
      <div class="table-wrap"><table class="hd-logtable">
        <thead><tr><th scope="col">Person</th><th scope="col">Account</th><th scope="col">Last contact</th><th scope="col">Cadence</th></tr></thead>
        <tbody>${PEOPLE.map((p) => ({ p, q: daysQuiet(p.id), d: DEALS.find((x) => x.personId === p.id) }))
          .sort((a, b) => b.q - a.q)
          .map(({ p, q, d }) => {
            const cad = d ? stageOf(d.stage).cadence : 14;
            const over = q > cad;
            return `<tr><td><a href="#/p/${p.id}">${esc(p.name)}</a><span class="sub">${esc(p.title)}</span></td>
              <td>${esc(byId(ACCOUNTS, p.accountId).name)}</td>
              <td class="m">${esc(relDay(lastTouch(p.id).on))}</td>
              <td>${over ? `<span class="flag">${ReasonMark("quiet", false, "")}${q} days quiet, allows ${cad}</span>` : `<span class="flag is-calm">Inside ${cad} days</span>`}</td></tr>`;
          }).join("")}</tbody>
      </table></div>
    </div></main>
    ${KeyLegend([], 0, 0)}
  </div>`;
  wireChrome();
}

/* ============================================================
   ROUTER + KEYS
   ============================================================ */

function route() { return location.hash || "#/today"; }

function render() {
  if (!session()) { renderAuth(); return; }
  const h = route();
  if (h.startsWith("#/signin")) { session.clear(); renderAuth(); return; }
  if (h.startsWith("#/p/")) return renderPerson(h.slice(4));
  if (h.startsWith("#/deals")) return renderDeals();
  if (h.startsWith("#/people")) return renderPeople();
  return renderToday();
}

document.addEventListener("keydown", (e) => {
  if (!session() || overlay.innerHTML || e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const h = route();
  if (h.startsWith("#/p/")) {
    if (e.key === "Escape") { if (typing) e.target.blur(); else location.hash = "#/today"; e.preventDefault(); }
    else if (!typing && e.key === "l") { e.preventDefault(); document.getElementById("log-input").focus(); }
    return;
  }
  if (typing || !(h === "#/today" || h === "" || h === "#/")) return;
  const k = { j: "j", ArrowDown: "j", k: "k", ArrowUp: "k", e: "e", s: "s", u: "u", Enter: "enter" }[e.key];
  if (!k) return;
  if (k === "enter" && e.target.closest && e.target.closest("button:not(.hd-row), a")) return;
  if (todayKey(k)) e.preventDefault();
});

addEventListener("hashchange", () => { document.querySelectorAll(".menu").forEach((m) => m.remove()); render(); });
render();
