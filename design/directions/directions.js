/* ============================================================
   Two directions, four live boards. Both directions run on the
   same engine (assets/actions.js) and the same seed data; only
   the way the day is presented differs.
   ============================================================ */

const ME = "u1";
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NUM = ["Nothing", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/* A contact imported this morning, with nothing logged yet — the Relationship empty state */
const NEWCOMER = {
  id: "pn", accountId: "a1", name: "Inès Moreau", title: "Procurement Lead",
  email: "ines.moreau@kestrel.io", initials: "IM", tint: "#7C867F",
};

const KIND = { promise: "Promise", meeting: "Meeting today", reply: "No reply", quiet: "Going quiet", renewal: "Renewal" };

/* ---------------- board state ---------------- */

const dayState = () => ({ resolved: new Set(), snoozed: new Set(), scope: "mine", empty: false, last: null, sel: 0 });
const relState = () => ({ person: "p1", empty: false, log: [], flips: {} });

const BOARDS = {
  "a-today": { dir: "A", kind: "today", st: dayState() },
  "a-rel":   { dir: "A", kind: "rel",   st: relState() },
  "b-today": { dir: "B", kind: "today", st: dayState() },
  "b-rel":   { dir: "B", kind: "rel",   st: relState() },
};

function dayActions(st) {
  if (st.empty) return { all: [], live: [], pending: [] };
  const all = derive(st.scope, ME, { all: true });
  const live = all.filter((a) => !st.resolved.has(a.id) && !st.snoozed.has(a.id));
  const pending = PENDING.filter((w) => st.scope === "studio" || w.ownerId === ME);
  return { all, live, pending };
}
function resolveAction(st, a) {
  st.resolved.add(a.id);
  (a.folded || []).forEach((f) => st.resolved.add(f.id));
  st.last = a;
}
function undo(st) {
  if (!st.last) return false;
  st.resolved.delete(st.last.id);
  (st.last.folded || []).forEach((f) => st.resolved.delete(f.id));
  st.last = null;
  return true;
}

/* relationship data, with this board's local edits layered on */
function relPerson(st) { return st.empty ? NEWCOMER : byId(PEOPLE, st.person); }
function relTouches(st, pid) {
  if (st.empty) return st.log.filter((t) => t.personId === pid);
  return [...touchesFor(pid), ...st.log.filter((t) => t.personId === pid)].sort((a, b) =>
    a.on === b.on ? (a.id < b.id ? 1 : -1) : a.on < b.on ? 1 : -1
  );
}
function relCommits(st, pid) {
  if (st.empty) return [];
  return COMMITMENTS.filter((c) => c.personId === pid).map((c) => ({ ...c, done: st.flips[c.id] ? !c.done : c.done }));
}

/* ---------------- shared frame plumbing ---------------- */

const frameOf = (id) => document.querySelector(`.frame[data-board="${id}"]`);
const screenOf = (id) => frameOf(id).querySelector(".screen");

function toast(id, html, onUndo) {
  const f = frameOf(id);
  let t = f.querySelector(".ftoast");
  if (!t) {
    t = document.createElement("div");
    t.className = "ftoast";
    t.setAttribute("role", "status");
    f.appendChild(t);
  }
  t.innerHTML = `<span>${html}</span>` + (onUndo ? "<button>Undo</button>" : "");
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), onUndo ? 5000 : 2600);
  if (onUndo) t.querySelector("button").onclick = () => { t.classList.remove("show"); onUndo(); };
}

function render(id) {
  const b = BOARDS[id];
  ({ "A-today": aToday, "A-rel": aRel, "B-today": bToday, "B-rel": bRel })[b.dir + "-" + b.kind](id, b.st);
  document.querySelectorAll(`.seg[data-board="${id}"] button`).forEach((btn) =>
    btn.setAttribute("aria-pressed", String((btn.dataset.empty === "1") === b.st.empty))
  );
}

/* opening a person from either Today board loads them into that direction's Relationship board */
function openPerson(dir, pid) {
  const id = dir.toLowerCase() + "-rel";
  Object.assign(BOARDS[id].st, { person: pid, empty: false });
  render(id);
  frameOf(id).closest(".board").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

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

const fmtDay = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/* ============================================================
   A — THE SPINE
   ============================================================ */

function aShell(current, badge, inner) {
  const link = (key, label, svg) =>
    `<span class="rail-link" ${current === key ? 'aria-current="page"' : ""}>${svg}<span>${label}</span>${
      key === "today" && badge ? `<span class="rail-count">${badge}</span>` : ""
    }</span>`;
  return `<div class="shell">
    <nav class="rail" aria-label="Halden">
      <span class="rail-mark">Halden</span>
      <div class="rail-nav">
        ${link("today", "Today", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4v16"/><circle cx="12" cy="8" r="2.4"/><circle cx="12" cy="16" r="2.4"/><path d="M4 8h5M4 16h5"/></svg>')}
        ${link("deals", "Deals", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M6 12h12M9 18h6"/></svg>')}
        ${link("people", "People", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4"/></svg>')}
      </div>
      <div class="rail-spacer"></div>
      <span class="rail-me">PR</span>
    </nav>
    <main class="main">${inner}</main>
  </div>`;
}

function aCard(a) {
  const p = byId(PEOPLE, a.personId);
  const acct = byId(ACCOUNTS, p.accountId);
  const deal = a.dealId ? byId(DEALS, a.dealId) : null;
  const owner = byId(TEAM, a.ownerId);
  const folded = (a.folded || []).filter((f) => f.kind === "promise");
  return `<article class="act ${a.bucket === "late" ? "late" : ""}" data-id="${a.id}">
    <span class="mark mark-${a.mark}" aria-hidden="true"><i></i></span>
    <div class="act-who">
      <button class="name" data-open="${p.id}">${esc(p.name)}</button>
      <span>${esc(p.title)} · ${esc(acct.name)}</span>
      ${owner.id !== ME ? `<span class="pill" title="${esc(owner.name)} owns this">${esc(owner.name.split(" ")[0])}</span>` : ""}
    </div>
    <h3 class="act-what">${esc(a.headline)}</h3>
    <p class="act-why"><b>${esc(a.why.bold)}</b> ${esc(a.why.tail)}</p>
    ${folded.length ? `<p class="act-why">Also owed: ${folded.map((f) => esc(f.headline)).join("; ")}</p>` : ""}
    <div class="act-row">
      <button class="btn btn-do" data-do="${a.id}">${esc(a.verb)}</button>
      <button class="btn" data-snooze="${a.id}">Tomorrow</button>
      <button class="btn btn-quiet" data-open="${p.id}">Open ${esc(p.name.split(" ")[0])}</button>
      <span class="act-meta">${deal ? money(deal.value) + " · " + stageOf(deal.stage).label : ""}</span>
    </div>
  </article>`;
}

function aToday(id, st) {
  const { all, live, pending } = dayActions(st);
  const done = all.length - live.length;
  const late = live.filter((a) => a.bucket === "late").length;
  const soonCount = live.filter((a) => a.bucket === "late" || a.bucket === "now").length;

  const title = st.empty
    ? "Nothing needs you <em>yet</em>."
    : live.length === 0
    ? "Day <em>clear</em>."
    : `${NUM[live.length] || live.length} thing${live.length === 1 ? "" : "s"} need${live.length === 1 ? "s" : ""} <em>you</em>.`;

  const body = st.empty
    ? `<div class="cleared"><span class="terminus open"></span>
        <h2>Your day builds itself.</h2>
        <p>Halden fills this list from what already happens in your week. Nothing lands here until one of these exists:</p>
        <ul class="rules">
          <li><span class="mark mark-promise"><i></i></span>A promise you make in a note — “I'll send it Monday”</li>
          <li><span class="mark mark-meeting"><i></i></span>A meeting on your Google Calendar with someone you know</li>
          <li><span class="mark mark-reply"><i></i></span>Something you sent that nobody has answered</li>
          <li><span class="mark mark-quiet"><i></i></span>A deal that goes quieter than its stage allows</li>
        </ul>
        <div class="act-row">
          <button class="btn btn-do" data-fake="Imported <b>214 contacts</b> from Google. Matching them to accounts.">Import Google contacts</button>
          <button class="btn" data-fake="Calendar connected. <b>3 meetings</b> this week are with people you know.">Connect calendar</button>
        </div>
      </div>`
    : grouped(live)
        .map(
          (g) => `<section class="group">
            <h2 class="group-label ${g.id === "late" ? "is-late" : ""}">${esc(g.label)} <small>${g.items.length}${g.note ? " · " + esc(g.note) : ""}</small></h2>
            ${g.items.map(aCard).join("")}
          </section>`
        )
        .join("") +
      (live.length === 0
        ? `<div class="cleared"><span class="terminus"></span>
            <h2>That's the day.</h2>
            <p>Everything anyone is waiting on has moved. ${pending.length} thing${pending.length === 1 ? " is" : "s are"} sitting with the other side — Halden brings ${pending.length === 1 ? "it" : "them"} back if ${pending.length === 1 ? "it goes" : "they go"} stale.</p>
          </div>`
        : "");

  screenOf(id).innerHTML = aShell("today", soonCount, `
    <div class="wrap">
      <div class="topbar">
        <span class="mono">${esc(weekdayOf(TODAY))} · ${esc(fmtDay(TODAY).replace(/(\d+) (\w+)/, "$1 $2"))}</span>
        ${st.empty ? "" : `<div class="act-row">
          <button class="btn ${st.scope === "mine" ? "btn-do" : ""}" data-scope="mine">Mine</button>
          <button class="btn ${st.scope === "studio" ? "btn-do" : ""}" data-scope="studio">Whole studio</button>
        </div>`}
      </div>
      <header class="head">
        <h1>${title}</h1>
        <div class="tally">
          ${st.empty ? `<span>Halden Works · 6 people · no contacts yet</span>` : ""}
          ${late ? `<span class="late">${late} late</span>` : ""}
          ${live.length ? `<span><b>${live.length}</b> open</span>` : ""}
          ${done ? `<span><b>${done}</b> cleared</span>` : ""}
          ${pending.length ? `<span>${pending.length} sitting with them</span>` : ""}
        </div>
      </header>
      <div class="spine">${body}</div>
      ${pending.length ? `<section class="waiting">
          <span class="mono">Sitting with them — nothing for you to do yet</span>
          ${pending.map((w) => {
            const p = byId(PEOPLE, w.personId);
            return `<div class="wait-row"><a href="#" data-open="${p.id}">${esc(p.name)}</a><span>${esc(w.what)}</span><span class="tnum">${esc(relDay(w.sentOn))}</span></div>`;
          }).join("")}
        </section>` : ""}
    </div>`);

  const scr = screenOf(id);
  const spine = scr.querySelector(".spine");
  requestAnimationFrame(() => {
    const end = spine.querySelector(".terminus");
    const len = end ? end.offsetTop + 8 : spine.offsetHeight - 34;
    spine.style.setProperty("--len", len + "px");
    spine.style.setProperty("--burn", all.length ? Math.round(len * (done / all.length)) + "px" : "0px");
  });

  scr.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => { st.scope = b.dataset.scope; render(id); }));
  scr.querySelectorAll("[data-open]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); openPerson("A", b.dataset.open); }));
  scr.querySelectorAll("[data-fake]").forEach((b) => (b.onclick = () => toast(id, b.dataset.fake)));
  scr.querySelectorAll("[data-snooze]").forEach((b) => (b.onclick = () => {
    st.snoozed.add(b.dataset.snooze);
    render(id);
    toast(id, "Moved to tomorrow.");
  }));
  scr.querySelectorAll("[data-do]").forEach((b) => (b.onclick = () => {
    const a = live.find((x) => x.id === b.dataset.do);
    const card = scr.querySelector(`.act[data-id="${a.id}"]`);
    card.style.maxHeight = card.offsetHeight + "px";
    requestAnimationFrame(() => card.classList.add("done"));
    resolveAction(st, a);
    setTimeout(() => {
      render(id);
      toast(id, `${esc(a.verb.replace(/^Mark /, "Marked "))} · logged to <b>${esc(byId(PEOPLE, a.personId).name)}</b>`, () => { undo(st); render(id); });
    }, 330);
  }));
}

function aRel(id, st) {
  const p = relPerson(st);
  const acct = byId(ACCOUNTS, p.accountId);
  const deal = st.empty ? null : DEALS.find((x) => x.personId === p.id);
  const h = deal ? dealHealth(deal) : null;
  const touches = relTouches(st, p.id);
  const commits = relCommits(st, p.id);
  const meets = st.empty ? [] : MEETINGS.filter((m) => m.personId === p.id && m.on >= TODAY);
  const last = touches[0];
  const quiet = last ? daysFrom(last.on, TODAY) : null;

  const byDay = {};
  touches.forEach((t) => (byDay[t.on] = t));
  let bars = "", longest = 0, run = 0;
  for (let i = 59; i >= 0; i--) {
    const iso = addDays(TODAY, -i), t = byDay[iso];
    if (t) run = 0; else longest = Math.max(longest, ++run);
    const hgt = t ? (t.type === "meeting" ? 34 : t.type === "call" ? 24 : 16) : 5;
    bars += `<i class="${t ? "t " + t.type : ""}" style="height:${hgt}px"${t ? ` title="${esc(t.on)} — ${esc(t.note)}"` : ""}></i>`;
  }
  const cadence = h ? h.stage.cadence : 14;
  const gapNote = !last
    ? "No contact yet. The silence clock starts at the first thing you log."
    : quiet > cadence
    ? `<b>${plural(quiet, "day", "days")} of silence</b> — ${esc(h ? h.stage.label : "this relationship")} normally moves every ${cadence} days.`
    : `Last contact ${esc(relDay(last.on))}. Longest gap in this window: ${plural(longest, "day", "days")}.`;

  screenOf(id).innerHTML = aShell("people", 4, `
    <div class="wrap">
      <div class="topbar"><span class="mono">${esc(acct.sector)} · ${esc(acct.city)}</span>
        ${st.empty ? `<span class="mono">Added today from Google Contacts</span>` : ""}</div>
      <header class="rel-head">
        <span class="rel-av" style="background:${p.tint}22;color:${p.tint}">${esc(p.initials)}</span>
        <div><h1>${esc(p.name)}</h1>
          <div class="sub">${esc(p.title)} at <b>${esc(acct.name)}</b> · ${esc(p.email)}</div></div>
      </header>
      <div class="rel-grid">
        <div>
          <div class="panel">
            <h3>Contact, last 60 days</h3>
            <div class="cadence">${bars}</div>
            <div class="cadence-legend"><span>60 days ago</span><span>today</span></div>
            <div class="key"><span><i></i>call</span><span><i class="email"></i>email</span><span><i class="meeting"></i>meeting</span></div>
            <p class="gap-note">${gapNote}</p>
          </div>
          <div class="panel">
            <h3>What was said</h3>
            <div class="logger">
              <input placeholder="${st.empty ? "Log your first call with " + esc(p.name.split(" ")[0]) + "…" : "Log a call, a note, a promise…"}" aria-label="Log a contact">
              <button class="btn btn-do" data-log>Log it</button>
            </div>
          </div>
          ${touches.length
            ? `<div class="tl">${touches.map((t) => `<div class="tl-item ${t.dir === "out" ? "you" : ""}">
                <span class="when">${esc(fmtDay(t.on))} · ${esc(t.type)} · ${t.dir === "out" ? "you" : esc(p.name.split(" ")[0])}</span>
                <p>${esc(t.note)}</p></div>`).join("")}</div>`
            : `<p class="empty-note">Nothing logged yet. What was said lands here, newest first.</p>`}
        </div>
        <aside>
          <div class="panel"><h3>Open deal</h3>
            ${deal
              ? `<div class="stat-row" style="margin-bottom:14px">
                  <div class="stat"><span class="k">Value</span><span class="v">${money(deal.value)}</span></div>
                  <div class="stat"><span class="k">Stage</span><span class="v small">${esc(h.stage.label)}</span></div>
                  <div class="stat"><span class="k">In stage</span><span class="v small">${h.inStage}d</span></div>
                </div>
                <div style="font-size:.9rem;color:var(--ink-2)">${esc(deal.title)}</div>
                <p style="margin:12px 0 0"><span class="pill ${h.flag ? "late" : ""}">${esc(h.flagShort || "On cadence")}</span></p>`
              : `<p class="empty-note" style="margin-bottom:12px">No deal with ${esc(p.name.split(" ")[0])} yet.</p>
                 <button class="btn" data-fake="Deal started in <b>Discovery</b>. Halden will watch its cadence.">Start a deal</button>`}
          </div>
          <div class="panel"><h3>Promises</h3>
            ${commits.length
              ? commits.map((c) => {
                  const lt = !c.done && daysFrom(c.dueOn, TODAY) > 0;
                  return `<div class="commit ${c.done ? "done" : ""}">
                    <button class="box" data-commit="${c.id}" aria-label="${c.done ? "Reopen" : "Complete"} ${esc(c.what)}"></button>
                    <span>${esc(c.what)}</span><span class="due ${lt ? "late" : ""}">${esc(relDay(c.dueOn))}</span></div>`;
                }).join("")
              : `<p class="empty-note">Nothing promised. Write “I'll send it Friday” in a note and it lands on your day.</p>`}
          </div>
          ${meets.length ? `<div class="panel"><h3>Next in the diary</h3>${meets.map((m) =>
            `<div style="font-size:.9rem"><b>${esc(m.title)}</b><br><span style="color:var(--ink-3)">${esc(relDay(m.on))} · ${esc(m.at)} · ${esc(m.where)}</span></div>`).join("")}</div>` : ""}
        </aside>
      </div>
    </div>`);

  wireRel(id, st, p, "A");
}

/* ============================================================
   B — TRIAGE DESK
   ============================================================ */

function bTop(st, where, withTabs, counts) {
  return `<div class="top">
    <span class="brand"><i></i>HALDEN</span>
    <span class="where">${where}</span>
    <span class="sp"></span>
    ${withTabs ? `<div class="tabs">
      <button data-scope="mine" aria-pressed="${st.scope === "mine"}">Mine</button>
      <button data-scope="studio" aria-pressed="${st.scope === "studio"}">Studio</button></div>` : ""}
    ${counts || ""}
  </div>`;
}

function bToday(id, st) {
  const { all, live, pending } = dayActions(st);
  const order = grouped(live).flatMap((g) => g.items);
  st.sel = Math.max(0, Math.min(st.sel, order.length - 1));
  const cur = order[st.sel];
  const done = all.length - live.length;
  const late = live.filter((a) => a.bucket === "late").length;

  let i = -1;
  const list = st.empty
    ? `<div class="hollow"><h3>Queue empty</h3><p>Nothing has come due. The queue fills itself as your week happens.</p></div>`
    : grouped(live).map((g) => `
        <div class="gh ${g.id === "late" ? "late" : ""}"><span>${esc(g.label)}</span><span>${g.items.length}</span></div>
        ${g.items.map((a) => {
          i++;
          const p = byId(PEOPLE, a.personId);
          return `<button class="row ${a.bucket === "late" ? "late" : ""}" role="option" aria-selected="${i === st.sel}" data-i="${i}">
            <span class="m m-${a.mark}"><i></i></span>
            <span class="who">${esc(p.name.split(" ")[0])} ${esc(p.name.split(" ").slice(-1)[0][0])}.</span>
            <span class="what">${esc(a.headline)}</span>
            <span class="age">${esc(ageOf(a))}</span>
          </button>`;
        }).join("")}`).join("") +
      (live.length === 0 ? `<div class="hollow"><h3>Queue clear</h3><p>${done} of ${all.length} done. Nothing else is due today.</p></div>` : "") +
      (pending.length ? `<div class="gh"><span>With them</span><span>${pending.length}</span></div>
        ${pending.map((w) => {
          const p = byId(PEOPLE, w.personId);
          return `<div class="row them"><span class="m m-reply"><i></i></span><span class="who">${esc(p.name.split(" ")[0])} ${esc(p.name.split(" ").slice(-1)[0][0])}.</span><span class="what">${esc(w.what)}</span><span class="age">${daysFrom(w.sentOn, TODAY)}d</span></div>`;
        }).join("")}` : "");

  let detail;
  if (st.empty) {
    detail = `<div class="eyebrow">First run</div>
      <h2>What lands in this queue</h2>
      <div class="legend">
        <div><span class="m m-promise"><i></i></span><span><b>A promise</b> you write in a note — “I'll send it Monday”</span></div>
        <div><span class="m m-meeting"><i></i></span><span><b>A meeting</b> on your calendar with someone you know</span></div>
        <div><span class="m m-reply"><i></i></span><span><b>A missing reply</b> — you sent it, five days pass, nothing back</span></div>
        <div><span class="m m-quiet"><i></i></span><span><b>A quiet deal</b> — silent longer than its stage allows</span></div>
        <div><span class="m m-renewal"><i></i></span><span><b>A renewal</b> inside 21 days</span></div>
      </div>
      <div class="acts">
        <button class="kbtn primary" data-fake="Imported 214 contacts from Google. Matching them to accounts."><kbd>I</kbd>Import Google contacts</button>
        <button class="kbtn" data-fake="Calendar connected. 3 meetings this week are with people you know."><kbd>C</kbd>Connect calendar</button>
      </div>`;
  } else if (!cur) {
    detail = `<div class="eyebrow">Done for today</div>
      <h2>Nothing left in the queue.</h2>
      <div class="why"><span>${pending.length} thing${pending.length === 1 ? " is" : "s are"} with the other side. ${pending.length === 1 ? "It comes" : "They come"} back here if ${pending.length === 1 ? "it goes" : "they go"} stale.</span></div>
      <div class="acts"><button class="kbtn" data-undo><kbd>U</kbd>Undo last</button></div>`;
  } else {
    const p = byId(PEOPLE, cur.personId);
    const acct = byId(ACCOUNTS, p.accountId);
    const deal = cur.dealId ? byId(DEALS, cur.dealId) : null;
    const h = deal ? dealHealth(deal) : null;
    const folded = (cur.folded || []).filter((f) => f.kind === "promise");
    const recent = touchesFor(p.id).slice(0, 3);
    detail = `<div class="eyebrow ${cur.bucket === "late" ? "late" : ""}"><span class="m m-${cur.mark}"><i></i></span>${esc(KIND[cur.kind])} · ${esc(BUCKETS.find((b) => b.id === cur.bucket).label)}</div>
      <h2>${esc(cur.headline)}</h2>
      <div class="wholine"><button data-open="${p.id}">${esc(p.name)}</button> · ${esc(p.title)} · ${esc(acct.name)}</div>
      <div class="why ${cur.bucket === "late" ? "late" : ""}">
        <span><b>${esc(cur.why.bold)}</b> ${esc(cur.why.tail)}</span>
        ${folded.length ? `<span class="also">Also owed: ${folded.map((f) => esc(f.headline)).join("; ")}</span>` : ""}
      </div>
      ${deal ? `<div class="facts">
        <div><span>Deal</span><b>${esc(deal.title)}</b></div>
        <div><span>Value</span><b class="tn">${money(deal.value)}</b></div>
        <div><span>Stage</span><b>${esc(h.stage.label)} · ${deal.renewalOn ? "renews " + esc(relDay(deal.renewalOn)) : h.inStage + "d"}</b></div>
        <div><span>Owner</span><b>${esc(byId(TEAM, deal.ownerId).name.split(" ")[0])}</b></div>
      </div>` : ""}
      <div class="recent"><span class="mono" style="margin-bottom:6px">Last three</span>
        ${recent.map((t) => `<div class="r"><span>${esc(fmtDay(t.on))}</span><span>${esc(t.type)}</span><p>${esc(t.note)}</p></div>`).join("")}
      </div>
      <div class="acts">
        <button class="kbtn primary" data-act="done"><kbd>E</kbd>${esc(cur.verb)}</button>
        <button class="kbtn" data-act="snooze"><kbd>S</kbd>Tomorrow</button>
        <button class="kbtn" data-open="${p.id}"><kbd>↵</kbd>Open ${esc(p.name.split(" ")[0])}</button>
      </div>`;
  }

  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  screenOf(id).innerHTML = `
    ${bTop(st, `<b>Today</b> · ${esc(weekdayOf(TODAY))} ${esc(fmtDay(TODAY))}`, !st.empty,
      st.empty ? `<span class="counts">no contacts yet</span>` :
      `<span class="counts">${late ? `<span class="late">${late} late</span>` : ""}<span><b>${live.length}</b> open</span></span>`)}
    <div class="body">
      <div class="list" role="listbox" aria-label="Today's queue">${list}</div>
      <div class="detail">${detail}</div>
    </div>
    <div class="foot">
      <span class="keys"><kbd>J</kbd><kbd>K</kbd><em>move</em><kbd>E</kbd><em>done</em><kbd>S</kbd><em>tomorrow</em><kbd>↵</kbd><em>open</em><kbd>U</kbd><em>undo</em></span>
      ${all.length ? `<span class="prog">${done} / ${all.length} cleared<span class="bar"><i style="width:${pct}%"></i></span></span>` : ""}
    </div>`;

  const scr = screenOf(id);
  scr.querySelectorAll(".row[data-i]").forEach((r) => (r.onclick = () => { st.sel = +r.dataset.i; render(id); frameOf(id).focus({ preventScroll: true }); }));
  scr.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => { st.scope = b.dataset.scope; st.sel = 0; render(id); }));
  scr.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openPerson("B", b.dataset.open)));
  scr.querySelectorAll("[data-fake]").forEach((b) => (b.onclick = () => toast(id, b.dataset.fake)));
  scr.querySelectorAll("[data-undo]").forEach((b) => (b.onclick = () => bKey(id, "u")));
  scr.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => bKey(id, b.dataset.act === "done" ? "e" : "s")));
  const selRow = scr.querySelector('.row[aria-selected="true"]');
  if (selRow) selRow.scrollIntoView({ block: "nearest" });
}

function bKey(id, key) {
  const st = BOARDS[id].st;
  const { live } = dayActions(st);
  const order = grouped(live).flatMap((g) => g.items);
  const cur = order[st.sel];
  if (key === "j") { st.sel = Math.min(st.sel + 1, order.length - 1); render(id); return true; }
  if (key === "k") { st.sel = Math.max(st.sel - 1, 0); render(id); return true; }
  if (key === "u") { if (undo(st)) { render(id); toast(id, "Undone."); } return true; }
  if (!cur) return false;
  if (key === "e") {
    resolveAction(st, cur);
    render(id);
    toast(id, `${esc(cur.verb.replace(/^Mark /, "Marked "))} — ${esc(byId(PEOPLE, cur.personId).name)}`, () => { undo(st); render(id); });
    return true;
  }
  if (key === "s") { st.snoozed.add(cur.id); render(id); toast(id, "Moved to tomorrow."); return true; }
  if (key === "enter") { openPerson("B", cur.personId); return true; }
  return false;
}

function bRel(id, st) {
  const p = relPerson(st);
  const acct = byId(ACCOUNTS, p.accountId);
  const deal = st.empty ? null : DEALS.find((x) => x.personId === p.id);
  const h = deal ? dealHealth(deal) : null;
  const touches = relTouches(st, p.id);
  const commits = relCommits(st, p.id);
  const meets = st.empty ? [] : MEETINGS.filter((m) => m.personId === p.id && m.on >= TODAY);
  const last = touches[0];
  const quiet = last ? daysFrom(last.on, TODAY) : null;
  const lateOwed = commits.filter((c) => !c.done && daysFrom(c.dueOn, TODAY) > 0).length;
  const cadence = h ? h.stage.cadence : 14;

  const byDay = {};
  touches.forEach((t) => (byDay[t.on] = t));
  let cells = "";
  for (let i = 59; i >= 0; i--) {
    const t = byDay[addDays(TODAY, -i)];
    cells += `<i class="${t ? t.type : ""}"${t ? ` title="${esc(t.on)} — ${esc(t.note)}"` : ""}></i>`;
  }

  screenOf(id).innerHTML = `
    ${bTop(st, `<b>${esc(acct.name)}</b> · ${esc(acct.sector)}`, false,
      `<button class="crumb" data-back>← Queue</button>`)}
    <div class="rel">
      <div class="rel-top">
        <div class="rel-id"><span class="sq">${esc(p.initials)}</span>
          <div><h1>${esc(p.name)}</h1><p>${esc(p.title)} · ${esc(p.email)}</p></div></div>
        <div class="strip">
          <div><span>Value</span><b>${deal ? money(deal.value) : "—"}</b></div>
          <div><span>Stage</span><b>${h ? esc(h.stage.label) + " · " + (deal.renewalOn ? "renews " + esc(relDay(deal.renewalOn)) : h.inStage + "d") : "—"}</b></div>
          <div><span>Last touch</span><b class="${quiet !== null && quiet > cadence ? "late" : ""}">${last ? quiet + "d ago" : "never"}</b></div>
          <div><span>You owe</span><b class="${lateOwed ? "late" : ""}">${lateOwed ? lateOwed + " late" : "nothing"}</b></div>
        </div>
      </div>

      <div class="heat">
        <div class="heat-meta"><span class="mono">Contact · last 60 days</span>
          <span class="heat-key"><span><i style="background:var(--text)"></i>call</span><span><i style="background:var(--mute)"></i>email</span><span><i style="background:var(--meet)"></i>meeting</span><span><i style="background:var(--sel)"></i>note</span></span></div>
        <div class="cells">${cells}</div>
        <div class="heat-meta"><span>${!last ? "No contact yet. The silence clock starts at the first thing you log."
          : quiet > cadence ? `<b>${quiet} days quiet</b> — ${esc(h ? h.stage.label : "this stage")} allows ${cadence}.`
          : `Last contact ${esc(relDay(last.on))}, inside the ${cadence}-day cadence.`}</span></div>
      </div>

      <div class="rel-grid">
        <table class="tbl">
          <thead><tr><th>Date</th><th>Type</th><th>Who</th><th>What was said</th></tr></thead>
          <tbody>${touches.length
            ? touches.map((t) => `<tr><td>${esc(fmtDay(t.on))}</td><td>${esc(t.type)}</td><td class="${t.dir === "out" ? "you" : ""}">${t.dir === "out" ? "you" : esc(p.name.split(" ")[0])}</td><td>${esc(t.note)}</td></tr>`).join("")
            : `<tr class="none"><td colspan="4">Nothing logged. Write the first note on the right.</td></tr>`}</tbody>
        </table>
        <div class="side">
          <div class="box"><h3>Log</h3>
            <div class="logrow"><input placeholder="${st.empty ? "First call with " + esc(p.name.split(" ")[0]) + "…" : "Call, note, or a promise…"}" aria-label="Log a contact"><button class="kbtn primary" data-log>Log</button></div>
          </div>
          <div class="box"><h3>Promises</h3>
            ${commits.length ? commits.map((c) => {
              const lt = !c.done && daysFrom(c.dueOn, TODAY) > 0;
              return `<div class="pr ${c.done ? "done" : ""}"><button data-commit="${c.id}" aria-label="${c.done ? "Reopen" : "Complete"} ${esc(c.what)}"></button><span>${esc(c.what)}</span><span class="d ${lt ? "late" : ""}">${esc(relDay(c.dueOn))}</span></div>`;
            }).join("") : `<p class="muted">Nothing promised yet.</p>`}
          </div>
          <div class="box"><h3>Next meeting</h3>
            ${meets.length ? meets.map((m) => `<div><b>${esc(m.title)}</b><p class="muted">${esc(relDay(m.on))} · ${esc(m.at)} · ${esc(m.where)}</p></div>`).join("")
              : `<p class="muted">Nothing on the calendar.</p>`}
          </div>
        </div>
      </div>
    </div>`;

  screenOf(id).querySelector("[data-back]").onclick = () =>
    frameOf("b-today").closest(".board").scrollIntoView({ behavior: "smooth", block: "start" });
  wireRel(id, st, p, "B");
}

/* logging and promise-ticking behave identically in both directions */
function wireRel(id, st, p, dir) {
  const scr = screenOf(id);
  const input = scr.querySelector("input");
  const log = () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    st.log.push({ id: "L" + Date.now(), personId: p.id, on: TODAY, type: "note", dir: "out", note: v });
    render(id);
    toast(id, dir === "A" ? `Logged to <b>${esc(p.name)}</b>. The silence clock is reset.` : `Logged — ${esc(p.name)}. Silence clock reset.`);
  };
  scr.querySelector("[data-log]").onclick = log;
  input.onkeydown = (e) => { if (e.key === "Enter") log(); e.stopPropagation(); };
  scr.querySelectorAll("[data-commit]").forEach((b) => (b.onclick = () => {
    st.flips[b.dataset.commit] = !st.flips[b.dataset.commit];
    const c = relCommits(st, p.id).find((x) => x.id === b.dataset.commit);
    render(id);
    toast(id, c.done ? `Kept: <b>${esc(c.what)}</b>` : `Reopened: <b>${esc(c.what)}</b>`);
  }));
  scr.querySelectorAll("[data-fake]").forEach((b) => (b.onclick = () => toast(id, b.dataset.fake)));
}

/* ---------------- wiring ---------------- */

document.querySelectorAll(".seg").forEach((seg) => {
  seg.querySelectorAll("button").forEach((btn) => (btn.onclick = () => {
    const st = BOARDS[seg.dataset.board].st;
    st.empty = btn.dataset.empty === "1";
    const t = frameOf(seg.dataset.board).querySelector(".ftoast");
    if (t) t.classList.remove("show");
    render(seg.dataset.board);
  }));
});

frameOf("b-today").addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = { j: "j", ArrowDown: "j", k: "k", ArrowUp: "k", e: "e", s: "s", u: "u", Enter: "enter" }[e.key];
  if (k && bKey("b-today", k)) e.preventDefault();
});
frameOf("b-rel").addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === "l") { e.preventDefault(); screenOf("b-rel").querySelector("input").focus(); }
});

Object.keys(BOARDS).forEach(render);
