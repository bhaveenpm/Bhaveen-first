/* ============================================================
   The engine. Today's list is derived, never hand-written:
   promises you made, meetings you're walking into, replies that
   never came, deals going quiet, retainers coming up for renewal.
   ============================================================ */

const DAY = 86400000;

const d = (iso) => new Date(iso + "T00:00:00Z");
const daysFrom = (fromIso, toIso) => Math.round((d(toIso) - d(fromIso)) / DAY);
const addDays = (iso, n) => new Date(d(iso).getTime() + n * DAY).toISOString().slice(0, 10);

const byId = (list, id) => list.find((x) => x.id === id);
const stageOf = (id) => byId(STAGES, id);

function touchesFor(personId) {
  return TOUCHES.filter((t) => t.personId === personId).sort((a, b) => (a.on < b.on ? 1 : -1));
}
function lastTouch(personId) {
  return touchesFor(personId)[0] || null;
}
function daysQuiet(personId) {
  const t = lastTouch(personId);
  return t ? daysFrom(t.on, TODAY) : 999;
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}
function relDay(iso) {
  const n = daysFrom(TODAY, iso);
  if (n === 0) return "today";
  if (n === -1) return "yesterday";
  if (n === 1) return "tomorrow";
  if (n < 0) return plural(-n, "day", "days") + " ago";
  return "in " + plural(n, "day", "days");
}
function weekdayOf(iso) {
  return d(iso).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}
function money(v) {
  return "€" + v.toLocaleString("en-GB");
}

/* ---- state that the prototype mutates in the browser ---- */
const RESOLVED = new Set();   // action ids marked done this session
const SNOOZED = new Set();    // action ids pushed to tomorrow

/* ------------------------------------------------------------
   derive()
   ------------------------------------------------------------ */
function derive(scope /* "mine" | "studio" */, meId, opts) {
  const raw = [];
  const mine = (ownerId) => scope === "studio" || ownerId === meId;

  /* 1 — promises. The strongest signal there is: you said you would. */
  COMMITMENTS.forEach((c) => {
    if (c.done || !mine(c.ownerId)) return;
    const late = daysFrom(c.dueOn, TODAY);      // >0 means overdue by N days
    if (late < 0) return;                        // still has runway
    const deal = byId(DEALS, c.dealId);
    raw.push({
      id: "act-" + c.id,
      kind: "promise",
      mark: "promise",
      bucket: late > 0 ? "late" : "now",
      score: (late > 0 ? 100 + late * 4 : 78) + deal.value / 20000,
      personId: c.personId,
      dealId: c.dealId,
      ownerId: c.ownerId,
      headline: c.what,
      why: late > 0
        ? { bold: "Due " + relDay(c.dueOn) + ".", tail: c.promiseNote + "." }
        : { bold: "Due today.", tail: c.promiseNote + "." },
      verb: c.what.startsWith("Send") ? "Mark sent" : c.what.startsWith("Answer") ? "Mark answered" : "Mark done",
      commitmentId: c.id,
    });
  });

  /* 2 — meetings today. Prep beats everything except a broken promise. */
  MEETINGS.forEach((m) => {
    if (m.on !== TODAY) return;
    if (!m.withTeam.some(mine)) return;
    const deal = byId(DEALS, m.dealId);
    raw.push({
      id: "act-" + m.id,
      kind: "meeting",
      mark: "meeting",
      bucket: "now",
      score: 90,
      personId: m.personId,
      dealId: m.dealId,
      ownerId: m.withTeam[0],
      headline: m.title + " at " + m.at,
      why: { bold: m.mins + " minutes, " + m.where + ".", tail: "Last spoke " + relDay(lastTouch(m.personId).on) + "." },
      verb: "Mark prepped",
      absorbs: [],
      value: deal ? deal.value : 0,
    });
  });

  /* 3 — you sent something and nothing came back */
  DEALS.forEach((deal) => {
    if (!mine(deal.ownerId) || deal.repliedSince !== false || !deal.sentOn) return;
    const waited = daysFrom(deal.sentOn, TODAY);
    if (waited < 5) return;
    raw.push({
      id: "act-reply-" + deal.id,
      kind: "reply",
      mark: "reply",
      bucket: waited >= 7 ? "now" : "soon",
      score: 58 + waited,
      personId: deal.personId,
      dealId: deal.id,
      ownerId: deal.ownerId,
      headline: "Chase the proposal",
      why: { bold: "Sent " + waited + " days ago, no reply.", tail: "Proposals here usually land or die inside a week." },
      verb: "Mark followed up",
    });
  });

  /* 4 — retainers coming up for renewal, while there is still room to talk */
  DEALS.forEach((deal) => {
    if (!mine(deal.ownerId) || !deal.renewalOn) return;
    const until = daysFrom(TODAY, deal.renewalOn);
    if (until < 0 || until > 21) return;
    raw.push({
      id: "act-renew-" + deal.id,
      kind: "renewal",
      mark: "renewal",
      bucket: until <= 7 ? "now" : "soon",
      score: 54 + (21 - until),
      personId: deal.personId,
      dealId: deal.id,
      ownerId: deal.ownerId,
      headline: "Open the renewal conversation",
      why: { bold: "Renews " + relDay(deal.renewalOn) + ".", tail: "Quiet for " + plural(daysQuiet(deal.personId), "day", "days") + " — too quiet to ask cold." },
      verb: "Mark reached out",
    });
  });

  /* 5 — live deals drifting past the cadence their stage can carry */
  DEALS.forEach((deal) => {
    if (!mine(deal.ownerId) || deal.stage === "retained") return;
    const st = stageOf(deal.stage);
    const quiet = daysQuiet(deal.personId);
    if (quiet <= st.cadence) return;
    const inStage = daysFrom(deal.stageEnteredOn, TODAY);
    const stuck = inStage > st.typicalDays;
    raw.push({
      id: "act-quiet-" + deal.id,
      kind: "quiet",
      mark: "quiet",
      bucket: "quiet",
      score: 28 + quiet / 2,
      personId: deal.personId,
      dealId: deal.id,
      ownerId: deal.ownerId,
      headline: stuck ? "Restart it or close it out" : "Break the silence",
      why: {
        bold: plural(quiet, "day", "days") + " quiet.",
        tail: stuck
          ? inStage + " days in " + st.label + ", against a usual " + st.typicalDays + "."
          : st.label + " normally moves every " + st.cadence + " days.",
      },
      verb: "Mark reached out",
    });
  });

  /* ---- one action per deal: the loudest reason wins, the rest fold in ---- */
  const best = new Map();
  raw.sort((a, b) => b.score - a.score).forEach((a) => {
    const key = a.dealId || a.personId;
    const held = best.get(key);
    if (!held) best.set(key, { ...a, folded: [] });
    else held.folded.push(a);
  });

  const list = [...best.values()];

  return list
    .filter((a) => (opts && opts.all) || (!RESOLVED.has(a.id) && !SNOOZED.has(a.id)))
    .sort((a, b) => b.score - a.score);
}

const BUCKETS = [
  { id: "late",  label: "Late",         note: "past the day you named" },
  { id: "now",   label: "Today",        note: "" },
  { id: "soon",  label: "This week",    note: "still has room, easier now" },
  { id: "quiet", label: "Going quiet",  note: "nobody has spoken in a while" },
];

function grouped(actions) {
  return BUCKETS.map((b) => ({ ...b, items: actions.filter((a) => a.bucket === b.id) })).filter(
    (g) => g.items.length
  );
}

/* pipeline health, from the same rules the day is built from */
function dealHealth(deal) {
  const st = stageOf(deal.stage);
  const quiet = daysQuiet(deal.personId);
  const inStage = daysFrom(deal.stageEnteredOn, TODAY);
  const owed = COMMITMENTS.filter((c) => c.dealId === deal.id && !c.done && daysFrom(c.dueOn, TODAY) > 0)
    .sort((a, b) => daysFrom(b.dueOn, TODAY) - daysFrom(a.dueOn, TODAY))[0];
  const renewIn = deal.renewalOn ? daysFrom(TODAY, deal.renewalOn) : null;

  let flag = null;
  if (owed) flag = plural(daysFrom(owed.dueOn, TODAY), "day", "days") + " late — " + owed.what.toLowerCase();
  else if (renewIn !== null && renewIn >= 0 && renewIn <= 21) flag = "Renews " + relDay(deal.renewalOn);
  else if (deal.repliedSince === false && daysFrom(deal.sentOn, TODAY) >= 5) flag = "No reply in " + daysFrom(deal.sentOn, TODAY) + " days";
  else if (quiet > st.cadence) flag = plural(quiet, "day", "days") + " quiet";
  else if (deal.stage !== "retained" && inStage > st.typicalDays) flag = "Stalled in " + st.label;
  return { flag, flagShort: flag ? flag.split(" \u2014 ")[0] : null, quiet, inStage, stage: st };
}
