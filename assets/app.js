/* ============================================================
   Halden CRM — views, routing, and the simulated Google sign-in.
   No build step, no framework. Open index.html and it runs.
   ============================================================ */

const root = document.getElementById("root");
const overlay = document.getElementById("overlay");
const toastEl = document.getElementById("toast");

const SESSION_KEY = "halden.session";
let scope = localStorage.getItem("halden.scope") || "mine";
let lastResolved = null;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function session() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
session.set = (v) => localStorage.setItem(SESSION_KEY, JSON.stringify(v));
session.clear = () => localStorage.removeItem(SESSION_KEY);

/* ---------------- icons ---------------- */

const ico = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4v16"/><circle cx="12" cy="8" r="2.4"/><circle cx="12" cy="16" r="2.4" fill="none"/><path d="M4 8h5M4 16h5"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4"/><path d="M16 5.5a3 3 0 010 5.6M17.5 20c0-2.6-.9-4.2-2.2-5.2"/></svg>',
  pipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M6 12h12M9 18h6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  contacts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="9" r="3"/><path d="M6 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/></svg>',
  gmark:
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 01-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/>' +
    '<path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 01-10.7-3.8h-4v3.1A12 12 0 0012 24z"/>' +
    '<path fill="#FBBC05" d="M5.4 14.3a7.1 7.1 0 010-4.6v-3.1h-4a12 12 0 000 10.8l4-3.1z"/>' +
    '<path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 001.4 6.6l4 3.1A7.2 7.2 0 0112 4.8z"/></svg>',
};

/* ---------------- chrome ---------------- */

function toast(html, undoable) {
  toastEl.innerHTML = html + (undoable ? ' <button class="btn btn-quiet" id="undo" style="color:var(--gold-soft);margin-left:8px">Undo</button>' : "");
  toastEl.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove("show"), undoable ? 6000 : 2600);
  const u = document.getElementById("undo");
  if (u) u.onclick = () => {
    if (lastResolved) RESOLVED.delete(lastResolved);
    lastResolved = null;
    toastEl.classList.remove("show");
    render();
  };
}

function shell(inner, current) {
  const me = session();
  const n = derive(scope, me.userId).filter((a) => a.bucket === "late" || a.bucket === "now").length;
  return `
  <div class="shell">
    <nav class="rail" aria-label="Primary">
      <a class="rail-mark" href="#/today">Halden</a>
      <div class="rail-nav">
        <a class="rail-link" href="#/today" ${current === "today" ? 'aria-current="page"' : ""}>
          ${ico.today}<span>Today</span>${n ? `<span class="rail-count">${n}</span>` : ""}</a>
        <a class="rail-link" href="#/pipeline" ${current === "pipeline" ? 'aria-current="page"' : ""}>
          ${ico.pipe}<span>Deals</span></a>
        <a class="rail-link" href="#/people" ${current === "people" ? 'aria-current="page"' : ""}>
          ${ico.people}<span>People</span></a>
      </div>
      <div class="rail-spacer"></div>
      <button class="rail-me" id="me" aria-haspopup="true" title="${esc(me.email)}">${esc(me.initials)}</button>
    </nav>
    <main class="main" id="app">${inner}</main>
  </div>`;
}

function wireChrome() {
  const btn = document.getElementById("me");
  if (!btn) return;
  btn.onclick = (e) => {
    e.stopPropagation();
    const me = session();
    const r = btn.getBoundingClientRect();
    const m = document.createElement("div");
    m.className = "menu";
    m.innerHTML = `<div class="who"><b>${esc(me.name)}</b><span>${esc(me.email)}</span></div>
      <button data-go="#/people">Everyone at ${esc(ORG.name)}</button>
      <button id="out">Sign out</button>`;
    document.body.appendChild(m);
    m.style.left = Math.min(r.left, innerWidth - 240) + "px";
    m.style.top = Math.max(12, r.top - m.offsetHeight - 8) + "px";
    m.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { location.hash = b.dataset.go; m.remove(); }));
    m.querySelector("#out").onclick = () => { session.clear(); m.remove(); location.hash = "#/signin"; render(); };
    const close = () => { m.remove(); document.removeEventListener("click", close); };
    setTimeout(() => document.addEventListener("click", close), 0);
  };
}

/* ============================================================
   1 — SIGN IN  (simulated Google, no credentials, no network)
   ============================================================ */

const GOOGLE_ACCOUNTS = [
  { userId: "u1", name: "Priya Raman", email: "priya@haldenworks.com", initials: "PR", tint: "#C9922A" },
  { userId: "u2", name: "Tomás Vidal", email: "tomas@haldenworks.com", initials: "TV", tint: "#2E2FA6" },
];

function renderAuth() {
  root.innerHTML = `
  <div class="auth">
    <section class="auth-left">
      <div class="auth-mark"><b>Halden</b><span>${esc(ORG.blurb)}</span></div>
      <div class="auth-pitch">
        <h1>Your day,<br>before it <em>starts</em>.</h1>
        <p>A CRM for teams too small to have a pipeline meeting. It reads your promises,
           your calendar and your silences, and hands you one ordered list.</p>
      </div>
      <p class="auth-foot">Six people. Six accounts. No dashboard.</p>
    </section>

    <section class="auth-right">
      <div class="auth-card">
        <span class="demo-tag">Prototype</span>
        <h2>Sign in to Halden</h2>
        <p>Halden uses your work Google account for calendar and contacts.</p>
        <button class="gbtn" id="gsi">${ico.gmark}<span>Continue with Google</span></button>
        <p class="auth-note">This is a design prototype. The sign-in below is simulated —
           it never contacts Google and never asks for a password.</p>
      </div>

      <div class="auth-preview" aria-hidden="true">
        <span class="mono">What you land on</span>
        <div class="ghost">
          <div class="ghost-row"><i></i><span>Nadia — scope doc, 3 days late</span></div>
          <div class="ghost-row"><i></i><span>Elise — three redlines to answer</span></div>
          <div class="ghost-row lit"><i></i><span>Ovid kickoff, 14:00</span></div>
          <div class="ghost-row"><i></i><span>Northwind — 34 days quiet</span></div>
        </div>
      </div>
    </section>
  </div>`;

  document.getElementById("gsi").onclick = chooser;
}

function sheet(html) {
  overlay.innerHTML = `<div class="veil"><div class="gsheet" role="dialog" aria-modal="true" aria-label="Simulated Google sign-in">
    <div class="gsheet-demo">Simulated · prototype only · no password required</div>${html}</div></div>`;
}

function chooser() {
  sheet(`
    <div class="gsheet-head">
      <div class="glogo"><i>${ico.gmark}</i><b>Google</b></div>
      <h3>Choose an account</h3>
      <p>to continue to <b>Halden</b></p>
    </div>
    ${GOOGLE_ACCOUNTS.map(
      (a, i) => `<button class="gacct" data-i="${i}">
        <span class="av" style="background:${a.tint}">${esc(a.initials)}</span>
        <span><span class="nm">${esc(a.name)}</span><br><span class="em">${esc(a.email)}</span></span>
      </button>`
    ).join("")}
    <button class="gacct alt" data-i="-1"><span class="av">+</span><span class="nm">Use another account</span></button>
    <div class="gsheet-foot">To continue, Google will share your name, email address and
      profile picture with Halden. Before using this app, review its privacy policy and terms.</div>
    <div class="gactions"><button class="gtext" id="cancel">Cancel</button></div>`);

  overlay.querySelectorAll(".gacct").forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.i;
      if (i < 0) return toast("Only the two seeded accounts work in this prototype.");
      consent(GOOGLE_ACCOUNTS[i]);
    };
  });
  document.getElementById("cancel").onclick = () => (overlay.innerHTML = "");
}

function consent(acct) {
  sheet(`
    <div class="gsheet-head">
      <div class="glogo"><i>${ico.gmark}</i><b>Google</b></div>
      <h3>Halden wants access to your Google Account</h3>
      <p><b>${esc(acct.email)}</b></p>
      <ul class="gscopes">
        <li>${ico.cal}<span>See events on your calendar, so meetings show up in your day</span></li>
        <li>${ico.contacts}<span>See your contacts, to match people to accounts</span></li>
        <li>${ico.lock}<span>Nothing is written back to your Google Account</span></li>
      </ul>
    </div>
    <div class="gactions">
      <button class="gtext" id="back">Cancel</button>
      <button class="gtext primary" id="allow">Continue</button>
    </div>`);
  document.getElementById("back").onclick = chooser;
  document.getElementById("allow").onclick = () => {
    sheet(`<div class="gwait"><div class="spinner"></div><p>Signing you in to Halden…</p></div>`);
    setTimeout(() => {
      session.set(acct);
      overlay.innerHTML = "";
      location.hash = "#/today";
      render();
      toast(`Signed in as <b>${esc(acct.name)}</b>. Calendar and contacts connected.`);
    }, 1100);
  };
}

/* ============================================================
   2 — TODAY
   ============================================================ */

function markSVG(kind) {
  return `<span class="mark mark-${kind}" aria-hidden="true"><i></i></span>`;
}

const MARK_WORDS = {
  promise: "a promise you made",
  meeting: "a meeting today",
  reply: "waiting on a reply",
  quiet: "going quiet",
  renewal: "renewal ahead",
};

function actionCard(a) {
  const p = byId(PEOPLE, a.personId);
  const acct = byId(ACCOUNTS, p.accountId);
  const deal = a.dealId ? byId(DEALS, a.dealId) : null;
  const owner = byId(TEAM, a.ownerId);
  const me = session();
  const folded = (a.folded || []).filter((f) => f.kind === "promise");

  return `
  <article class="act ${a.bucket === "late" ? "late" : ""}" data-id="${a.id}">
    ${markSVG(a.mark)}
    <div class="act-who">
      <a href="#/p/${p.id}">${esc(p.name)}</a>
      <span>${esc(p.title)} · ${esc(acct.name)}</span>
      ${owner.id !== me.userId ? `<span class="pill" title="${esc(owner.name)} owns this">${esc(owner.name.split(" ")[0])}</span>` : ""}
    </div>
    <h3 class="act-what">${esc(a.headline)}</h3>
    <p class="act-why"><b>${esc(a.why.bold)}</b> ${esc(a.why.tail)}</p>
    ${folded.length ? `<p class="act-why">Also owed: ${folded.map((f) => esc(f.headline)).join("; ")}</p>` : ""}
    <div class="act-row">
      <button class="btn btn-do" data-do="${a.id}">${esc(a.verb)}</button>
      <button class="btn" data-snooze="${a.id}">Tomorrow</button>
      <button class="btn btn-quiet" onclick="location.hash='#/p/${p.id}'">Open ${esc(p.name.split(" ")[0])}</button>
      <span class="act-meta">${deal ? money(deal.value) + " · " + stageOf(deal.stage).label : ""}</span>
    </div>
  </article>`;
}

function renderToday() {
  const me = session();
  const all = derive(scope, me.userId, { all: true });
  const live = derive(scope, me.userId);
  const groups = grouped(live);
  const done = all.length - live.length;
  const late = live.filter((a) => a.bucket === "late").length;
  const pending = PENDING.filter((w) => scope === "studio" || w.ownerId === me.userId);

  const headline =
    live.length === 0
      ? "Nothing is waiting on you."
      : live.length === 1
      ? "One thing needs you."
      : `${["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][live.length] || live.length} things need you.`;

  const body = `
  <div class="wrap">
    <div class="topbar">
      <span class="mono">${esc(weekdayOf(TODAY))} · ${esc(new Date(TODAY + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }))}</span>
      <div class="act-row">
        <button class="btn ${scope === "mine" ? "btn-do" : ""}" data-scope="mine">Mine</button>
        <button class="btn ${scope === "studio" ? "btn-do" : ""}" data-scope="studio">Whole studio</button>
      </div>
    </div>

    <header class="head">
      <h1>${live.length ? esc(headline).replace(/(\S+)\.$/, "<em>$1</em>.") : "Day <em>clear</em>."}</h1>
      <div class="tally">
        ${late ? `<span class="late">${late} late</span>` : ""}
        ${live.length ? `<span><b>${live.length}</b> open</span>` : ""}
        ${done ? `<span><b>${done}</b> cleared</span>` : ""}
        ${pending.length ? `<span>${pending.length} sitting with them</span>` : ""}
      </div>
    </header>

    <div class="spine" id="spine">
      ${groups
        .map(
          (g) => `<section class="group">
            <h2 class="group-label ${g.id === "late" ? "is-late" : ""}">${esc(g.label)} <small>${g.items.length}${g.note ? " · " + esc(g.note) : ""}</small></h2>
            ${g.items.map(actionCard).join("")}
          </section>`
        )
        .join("")}

      ${
        live.length === 0
          ? `<div class="cleared"><span class="terminus"></span>
              <h2>That's the day.</h2>
              <p>Everything anyone is waiting on has moved. ${pending.length} thing${pending.length === 1 ? " is" : "s are"} sitting with the other side —
                 Halden will bring ${pending.length === 1 ? "it" : "them"} back when ${pending.length === 1 ? "it goes" : "they go"} stale.</p>
              <button class="btn" onclick="location.hash='#/pipeline'">Look at the deals instead</button>
            </div>`
          : ""
      }
    </div>

    ${
      pending.length
        ? `<section class="waiting">
            <span class="mono">Sitting with them — nothing for you to do yet</span>
            ${pending
              .map((w) => {
                const p = byId(PEOPLE, w.personId);
                return `<div class="wait-row"><a href="#/p/${p.id}">${esc(p.name)}</a>
                  <span>${esc(w.what)}</span>
                  <span class="tnum">${esc(relDay(w.sentOn))}</span></div>`;
              })
              .join("")}
          </section>`
        : ""
    }
  </div>`;

  root.innerHTML = shell(body, "today");
  wireChrome();

  /* the spine burns down as the day clears */
  const spine = document.getElementById("spine");
  if (spine && all.length) {
    requestAnimationFrame(() => {
      const end = spine.querySelector(".terminus");
      const len = end ? end.offsetTop + 8 : spine.offsetHeight - 34;
      spine.style.setProperty("--len", len + "px");
      spine.style.setProperty("--burn", Math.round(len * (done / all.length)) + "px");
    });
  }

  root.querySelectorAll("[data-scope]").forEach((b) => {
    b.onclick = () => { scope = b.dataset.scope; localStorage.setItem("halden.scope", scope); render(); };
  });

  root.querySelectorAll("[data-do]").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.do;
      const card = root.querySelector(`.act[data-id="${id}"]`);
      const a = live.find((x) => x.id === id);
      const p = byId(PEOPLE, a.personId);
      card.style.maxHeight = card.offsetHeight + "px";
      requestAnimationFrame(() => card.classList.add("done"));
      RESOLVED.add(id);
      lastResolved = id;
      (a.folded || []).forEach((f) => RESOLVED.add(f.id));
      setTimeout(() => {
        render();
        toast(`${esc(a.verb.replace(/^Mark /, "Marked "))} · logged to <b>${esc(p.name)}</b>`, true);
      }, 340);
    };
  });

  root.querySelectorAll("[data-snooze]").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.snooze;
      SNOOZED.add(id);
      render();
      toast("Moved to tomorrow. It comes back a day later than it should have.");
    };
  });
}

/* ============================================================
   3 — RELATIONSHIP
   ============================================================ */

function cadenceStrip(personId, days) {
  const map = {};
  touchesFor(personId).forEach((t) => (map[t.on] = t));
  let bars = "";
  let longest = 0, run = 0;
  for (let i = days - 1; i >= 0; i--) {
    const iso = addDays(TODAY, -i);
    const t = map[iso];
    if (t) { run = 0; } else { run++; longest = Math.max(longest, run); }
    const h = t ? (t.type === "meeting" ? 34 : t.type === "call" ? 24 : 16) : 5;
    bars += `<i class="${t ? "t " + t.type : ""}" style="height:${h}px"${t ? ` title="${esc(t.on)} — ${esc(t.note)}"` : ""}></i>`;
  }
  return { bars, longest };
}

function renderPerson(id) {
  const p = byId(PEOPLE, id);
  if (!p) { location.hash = "#/today"; return; }
  const acct = byId(ACCOUNTS, p.accountId);
  const deal = DEALS.find((x) => x.personId === p.id);
  const h = deal ? dealHealth(deal) : null;
  const strip = cadenceStrip(p.id, 60);
  const quiet = daysQuiet(p.id);
  const commits = COMMITMENTS.filter((c) => c.personId === p.id);
  const meets = MEETINGS.filter((m) => m.personId === p.id && m.on >= TODAY);

  const body = `
  <div class="wrap">
    <div class="topbar"><button class="crumb" onclick="history.back()">← Back</button>
      <span class="mono">${esc(acct.sector)} · ${esc(acct.city)}</span></div>

    <header class="rel-head">
      <span class="rel-av" style="background:${p.tint}22;color:${p.tint}">${esc(p.initials)}</span>
      <div>
        <h1>${esc(p.name)}</h1>
        <div class="sub">${esc(p.title)} at <b>${esc(acct.name)}</b> · ${esc(p.email)}</div>
      </div>
    </header>

    <div class="rel-grid">
      <div>
        <div class="panel">
          <h3>Contact, last 60 days</h3>
          <div class="cadence">${strip.bars}</div>
          <div class="cadence-legend"><span>60 days ago</span><span>today</span></div>
          <div class="key"><span><i></i>call</span><span><i class="email"></i>email</span><span><i class="meeting"></i>meeting</span></div>
          <p class="gap-note">${
            quiet > (h ? h.stage.cadence : 14)
              ? `<b>${plural(quiet, "day", "days")} of silence</b> — ${esc(h ? h.stage.label : "this relationship")} normally moves every ${h ? h.stage.cadence : 14} days.`
              : `Last contact ${esc(relDay(lastTouch(p.id).on))}. Longest gap in this window: ${plural(strip.longest, "day", "days")}.`
          }</p>
        </div>

        <div class="panel">
          <h3>What was said</h3>
          <div class="logger">
            <input id="lognote" placeholder="Log a call, a note, a promise…" aria-label="Log a contact">
            <button class="btn btn-do" id="logbtn">Log it</button>
          </div>
        </div>

        <div class="tl">
          ${touchesFor(p.id)
            .map(
              (t) => `<div class="tl-item ${t.dir === "out" ? "you" : ""}">
                <span class="when">${esc(new Date(t.on + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }))} · ${esc(t.type)} · ${t.dir === "out" ? "you" : esc(p.name.split(" ")[0])}</span>
                <p>${esc(t.note)}</p></div>`
            )
            .join("")}
        </div>
      </div>

      <aside>
        ${
          deal
            ? `<div class="panel">
                <h3>Open deal</h3>
                <div class="stat-row" style="margin-bottom:14px">
                  <div class="stat"><span class="k">Value</span><span class="v">${money(deal.value)}</span></div>
                  <div class="stat"><span class="k">Stage</span><span class="v small">${esc(h.stage.label)}</span></div>
                  <div class="stat"><span class="k">In stage</span><span class="v small">${h.inStage}d</span></div>
                </div>
                <div style="font-size:.9rem;color:var(--ink-2)">${esc(deal.title)}</div>
                ${h.flag ? `<p style="margin:12px 0 0"><span class="pill late">${esc(h.flagShort)}</span></p>` : `<p style="margin:12px 0 0"><span class="pill">On cadence</span></p>`}
              </div>`
            : ""
        }

        <div class="panel">
          <h3>Promises</h3>
          ${
            commits.length
              ? commits
                  .map((c) => {
                    const late = daysFrom(c.dueOn, TODAY) > 0 && !c.done;
                    return `<div class="commit ${c.done ? "done" : ""}">
                      <button class="box" data-commit="${c.id}" aria-label="${c.done ? "Reopen" : "Complete"} ${esc(c.what)}"></button>
                      <span>${esc(c.what)}</span>
                      <span class="due ${late ? "late" : ""}">${esc(relDay(c.dueOn))}</span></div>`;
                  })
                  .join("")
              : `<p style="font-size:.88rem;color:var(--ink-3);margin:0">Nothing promised. Say something you'll do and it lands on your day.</p>`
          }
        </div>

        ${
          meets.length
            ? `<div class="panel"><h3>Next in the diary</h3>
                ${meets
                  .map(
                    (m) => `<div style="font-size:.9rem"><b>${esc(m.title)}</b><br>
                    <span style="color:var(--ink-3)">${esc(relDay(m.on))} · ${esc(m.at)} · ${esc(m.where)}</span></div>`
                  )
                  .join('<hr style="border:0;border-top:1px dotted var(--line);margin:10px 0">')}
              </div>`
            : ""
        }
      </aside>
    </div>
  </div>`;

  root.innerHTML = shell(body, "people");
  wireChrome();

  const input = document.getElementById("lognote");
  const log = () => {
    const v = input.value.trim();
    if (!v) return;
    TOUCHES.push({ id: "t" + Date.now(), personId: p.id, on: TODAY, type: "note", dir: "out", note: v });
    render();
    toast(`Logged to <b>${esc(p.name)}</b>. The silence clock is reset.`);
  };
  document.getElementById("logbtn").onclick = log;
  input.onkeydown = (e) => { if (e.key === "Enter") log(); };

  root.querySelectorAll("[data-commit]").forEach((b) => {
    b.onclick = () => {
      const c = byId(COMMITMENTS, b.dataset.commit);
      c.done = !c.done;
      render();
      toast(c.done ? `Kept: <b>${esc(c.what)}</b>` : `Reopened: <b>${esc(c.what)}</b>`);
    };
  });
}

/* ============================================================
   4 — DEALS
   ============================================================ */

function renderPipeline() {
  const me = session();
  const rows = DEALS.filter((x) => scope === "studio" || x.ownerId === me.userId).map((deal) => ({ deal, h: dealHealth(deal) }));
  const open = rows.filter((r) => r.deal.stage !== "retained");
  const totalValue = open.reduce((s, r) => s + r.deal.value, 0);
  const maxStage = Math.max(...STAGES.map((s) => rows.filter((r) => r.deal.stage === s.id).reduce((a, r) => a + r.deal.value, 0)), 1);

  const body = `
  <div class="wrap wide">
    <div class="topbar"><span class="mono">Deals</span>
      <div class="act-row">
        <button class="btn ${scope === "mine" ? "btn-do" : ""}" data-scope="mine">Mine</button>
        <button class="btn ${scope === "studio" ? "btn-do" : ""}" data-scope="studio">Whole studio</button>
      </div>
    </div>

    <header class="head">
      <h1>${money(totalValue)} <em>in play</em></h1>
      <div class="tally">
        <span><b>${open.length}</b> open deals</span>
        <span><b>${rows.filter((r) => r.h.flag).length}</b> need something</span>
        <span>across ${new Set(rows.map((r) => r.deal.accountId)).size} accounts</span>
      </div>
    </header>

    <div class="stages">
      ${STAGES.map((s) => {
        const inStage = rows.filter((r) => r.deal.stage === s.id);
        const v = inStage.reduce((a, r) => a + r.deal.value, 0);
        return `<div class="stage">
          <span class="k">${esc(s.label)}</span>
          <span class="v">${inStage.length} <small>${v ? money(v) : "—"}</small></span>
          <span class="bar"><i style="width:${Math.round((v / maxStage) * 100)}%"></i></span>
        </div>`;
      }).join("")}
    </div>

    <table class="tbl">
      <thead><tr>
        <th>Deal</th><th>Value</th><th>Stage</th><th>Last heard</th><th>Needs</th><th>Owner</th>
      </tr></thead>
      <tbody>
      ${rows
        .sort((a, b) => (a.h.flag ? 0 : 1) - (b.h.flag ? 0 : 1) || b.deal.value - a.deal.value)
        .map(({ deal, h }) => {
          const p = byId(PEOPLE, deal.personId);
          const acct = byId(ACCOUNTS, deal.accountId);
          return `<tr>
            <td><a class="deal" href="#/p/${p.id}">${esc(deal.title)}</a><span class="acct">${esc(acct.name)} · ${esc(p.name)}</span></td>
            <td class="val">${money(deal.value)}</td>
            <td><span class="pill ${deal.stage === "negotiation" ? "hot" : ""}">${esc(h.stage.label)}</span><br><span class="acct">${deal.renewalOn ? "renews " + esc(relDay(deal.renewalOn)) : h.inStage + "d in stage"}</span></td>
            <td class="val">${esc(relDay(lastTouch(p.id).on))}</td>
            <td><span class="flag ${h.flag ? "" : "ok"}"><i></i>${esc(h.flag || "Nothing")}</span></td>
            <td class="acct">${esc(byId(TEAM, deal.ownerId).name.split(" ")[0])}</td>
          </tr>`;
        })
        .join("")}
      </tbody>
    </table>
  </div>`;

  root.innerHTML = shell(body, "pipeline");
  wireChrome();
  root.querySelectorAll("[data-scope]").forEach((b) => {
    b.onclick = () => { scope = b.dataset.scope; localStorage.setItem("halden.scope", scope); render(); };
  });
}

/* ---- people index (a small fifth view, reachable from the rail) ---- */

function renderPeople() {
  const body = `
  <div class="wrap">
    <div class="topbar"><span class="mono">People</span></div>
    <header class="head"><h1>Everyone we <em>know</em>.</h1>
      <div class="tally"><span><b>${PEOPLE.length}</b> contacts</span><span>${ACCOUNTS.length} accounts</span></div>
    </header>
    <div class="spine" style="padding-left:0">
      ${PEOPLE.map((p) => {
        const acct = byId(ACCOUNTS, p.accountId);
        const q = daysQuiet(p.id);
        return `<a class="act" href="#/p/${p.id}" style="display:block;text-decoration:none;color:inherit">
          <div class="act-who"><a href="#/p/${p.id}">${esc(p.name)}</a><span>${esc(p.title)} · ${esc(acct.name)}</span></div>
          <p class="act-why" style="margin:0">Last contact <b>${esc(relDay(lastTouch(p.id).on))}</b> · ${q > 20 ? "going cold" : "warm"}</p>
        </a>`;
      }).join("")}
    </div>
  </div>`;
  root.innerHTML = shell(body, "people");
  wireChrome();
}

/* ============================================================
   ROUTER
   ============================================================ */

function render() {
  const me = session();
  const hash = location.hash || "#/today";
  if (!me) { renderAuth(); return; }
  if (hash.startsWith("#/p/")) return renderPerson(hash.slice(4));
  if (hash.startsWith("#/pipeline")) return renderPipeline();
  if (hash.startsWith("#/people")) return renderPeople();
  if (hash.startsWith("#/signin")) { session.clear(); return renderAuth(); }
  return renderToday();
}

addEventListener("hashchange", render);
render();
