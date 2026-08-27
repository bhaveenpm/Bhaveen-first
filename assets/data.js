/* ============================================================
   Seed data — Halden Works, a 6-person industrial design studio.
   Fictional. "Today" is pinned so the demo reads the same every time.
   ============================================================ */

const TODAY = "2026-08-27";

const ORG = {
  name: "Halden Works",
  blurb: "Industrial design studio · 6 people · Rotterdam",
};

const TEAM = [
  { id: "u1", name: "Priya Raman",     role: "Principal",       email: "priya@haldenworks.com",  initials: "PR", tint: "#C9922A" },
  { id: "u2", name: "Tomás Vidal",     role: "Design lead",     email: "tomas@haldenworks.com",  initials: "TV", tint: "#2E2FA6" },
  { id: "u3", name: "Ade Balogun",     role: "Mechanical",      email: "ade@haldenworks.com",    initials: "AB", tint: "#3F6B4A" },
  { id: "u4", name: "Wren Kaczmarek",  role: "Studio manager",  email: "wren@haldenworks.com",   initials: "WK", tint: "#A33417" },
];

const ACCOUNTS = [
  { id: "a1", name: "Kestrel Instruments", sector: "Field measurement",   city: "Utrecht"  },
  { id: "a2", name: "Halo Cycles",         sector: "Micromobility",       city: "Ghent"    },
  { id: "a3", name: "Terrafirma Ag",       sector: "Agritech",            city: "Wageningen" },
  { id: "a4", name: "Nine Volt Audio",     sector: "Pro audio",           city: "Berlin"   },
  { id: "a5", name: "Ovid Medical",        sector: "Respiratory devices", city: "Leiden"   },
  { id: "a6", name: "Northwind Optics",    sector: "Optics",              city: "Aberdeen" },
];

const PEOPLE = [
  { id: "p1", accountId: "a1", name: "Nadia Okonjo",   title: "VP Product",              email: "nadia@kestrel.io",     initials: "NO", tint: "#C9922A" },
  { id: "p2", accountId: "a2", name: "Marcus Feld",    title: "Head of Hardware",        email: "marcus@halocycles.cc", initials: "MF", tint: "#2E2FA6" },
  { id: "p3", accountId: "a3", name: "Elise Vandermeer", title: "COO",                   email: "elise@terrafirma.ag",  initials: "EV", tint: "#3F6B4A" },
  { id: "p4", accountId: "a4", name: "Sam Achebe",     title: "Founder",                 email: "sam@ninevolt.audio",   initials: "SA", tint: "#A33417" },
  { id: "p5", accountId: "a5", name: "Rina Shah",      title: "Director, Device Eng.",   email: "r.shah@ovidmed.com",   initials: "RS", tint: "#2E2FA6" },
  { id: "p6", accountId: "a6", name: "Jonah Brenner",  title: "General Manager",         email: "jonah@northwind.optics", initials: "JB", tint: "#7C867F" },
];

/* Stage order, plus how long a deal in that stage can reasonably go quiet
   before someone on a 6-person team should hear from us again. */
const STAGES = [
  { id: "discovery",   label: "Discovery",   cadence: 10, typicalDays: 21 },
  { id: "qualifying",  label: "Qualifying",  cadence: 7,  typicalDays: 18 },
  { id: "proposal",    label: "Proposal",    cadence: 5,  typicalDays: 14 },
  { id: "negotiation", label: "Negotiation", cadence: 4,  typicalDays: 12 },
  { id: "retained",    label: "Retained",    cadence: 30, typicalDays: 365 },
];

const DEALS = [
  { id: "d1", accountId: "a1", personId: "p1", ownerId: "u1",
    title: "Field spectrometer housing", value: 48000,
    stage: "proposal", stageEnteredOn: "2026-08-11",
    sentOn: "2026-08-14", repliedSince: true },

  { id: "d2", accountId: "a2", personId: "p2", ownerId: "u1",
    title: "E-bike cockpit redesign", value: 62000,
    stage: "proposal", stageEnteredOn: "2026-08-18",
    sentOn: "2026-08-18", repliedSince: false },

  { id: "d3", accountId: "a3", personId: "p3", ownerId: "u1",
    title: "Soil probe enclosure", value: 35000,
    stage: "negotiation", stageEnteredOn: "2026-08-20",
    sentOn: "2026-08-25", repliedSince: true },

  { id: "d4", accountId: "a4", personId: "p4", ownerId: "u2",
    title: "Chassis + tooling retainer", value: 28000,
    stage: "retained", stageEnteredOn: "2025-09-10",
    renewalOn: "2026-09-10" },

  { id: "d5", accountId: "a5", personId: "p5", ownerId: "u1",
    title: "Inhaler grip study", value: 91000,
    stage: "qualifying", stageEnteredOn: "2026-08-24" },

  { id: "d6", accountId: "a6", personId: "p6", ownerId: "u1",
    title: "Binocular refresh", value: 22000,
    stage: "discovery", stageEnteredOn: "2026-07-14" },
];

/* Every recorded contact. `dir` is "out" when we reached them. */
const TOUCHES = [
  // Kestrel — steady
  { id:"t01", personId:"p1", on:"2026-08-22", type:"call",    dir:"out", note:"Walked Nadia through the two housing routes. She wants the sealed one costed." },
  { id:"t02", personId:"p1", on:"2026-08-14", type:"email",   dir:"out", note:"Sent v1 proposal + timeline." },
  { id:"t03", personId:"p1", on:"2026-08-11", type:"meeting", dir:"out", note:"Scoping session at their lab. Saw the field unit fail the drop test." },
  { id:"t04", personId:"p1", on:"2026-07-29", type:"email",   dir:"in",  note:"Nadia asked whether we do IP67 validation in-house." },
  { id:"t05", personId:"p1", on:"2026-07-18", type:"call",    dir:"in",  note:"Inbound — referred by Nine Volt." },

  // Halo Cycles — sent a proposal, silence since
  { id:"t06", personId:"p2", on:"2026-08-18", type:"email",   dir:"out", note:"Proposal sent: cockpit redesign, 9 weeks, €62k." },
  { id:"t07", personId:"p2", on:"2026-08-12", type:"meeting", dir:"out", note:"Rode the prototype. Thumb reach is the whole problem." },
  { id:"t08", personId:"p2", on:"2026-08-04", type:"call",    dir:"out", note:"Intro call. Marcus has budget approved for Q4." },

  // Terrafirma — hot, in negotiation
  { id:"t09", personId:"p3", on:"2026-08-26", type:"email",   dir:"in",  note:"Elise returned the contract with three redlines on IP ownership." },
  { id:"t10", personId:"p3", on:"2026-08-25", type:"email",   dir:"out", note:"Sent contract for review." },
  { id:"t11", personId:"p3", on:"2026-08-20", type:"meeting", dir:"out", note:"Agreed scope: two enclosures, one shared gasket family." },
  { id:"t12", personId:"p3", on:"2026-08-06", type:"call",    dir:"out", note:"Discovery. Their field failures are all cable entry." },

  // Nine Volt — retained, quiet by design, renewal approaching
  { id:"t13", personId:"p4", on:"2026-07-23", type:"call",    dir:"out", note:"Quarterly check-in. Tooling handed to their vendor cleanly." },
  { id:"t14", personId:"p4", on:"2026-06-11", type:"meeting", dir:"out", note:"Reviewed the Mk2 chassis. Sam happy." },
  { id:"t15", personId:"p4", on:"2026-05-28", type:"email",   dir:"in",  note:"Sam flagged a supplier delay, resolved." },

  // Ovid — new, moving fast, meeting today
  { id:"t16", personId:"p5", on:"2026-08-24", type:"email",   dir:"out", note:"Sent NDA + kickoff agenda." },
  { id:"t17", personId:"p5", on:"2026-08-21", type:"call",    dir:"in",  note:"Rina called. They need grip data before a Nov design freeze." },

  // Northwind — went quiet in discovery
  { id:"t18", personId:"p6", on:"2026-07-24", type:"email",   dir:"out", note:"Sent the case study on the Kestrel housing. No reply." },
  { id:"t19", personId:"p6", on:"2026-07-16", type:"call",    dir:"out", note:"Discovery call. Jonah was enthusiastic but vague on budget." },
  { id:"t20", personId:"p6", on:"2026-07-14", type:"email",   dir:"in",  note:"Inbound via the site." },
];

/* Things someone here said they would do. This is the spine of the day. */
const COMMITMENTS = [
  { id:"c1", dealId:"d1", personId:"p1", ownerId:"u1", done:false, dueOn:"2026-08-24",
    what:"Send the revised scope doc",
    promisedOn:"2026-08-22", promiseNote:"you said Monday, on the call" },

  { id:"c2", dealId:"d3", personId:"p3", ownerId:"u1", done:false, dueOn:"2026-08-26",
    what:"Answer the three IP redlines",
    promisedOn:"2026-08-25", promiseNote:"you told Elise you'd turn these in a day" },

  { id:"c3", dealId:"d5", personId:"p5", ownerId:"u1", done:false, dueOn:"2026-08-27",
    what:"Bring the foam grip models to kickoff",
    promisedOn:"2026-08-24", promiseNote:"promised in the kickoff agenda" },

  { id:"c4", dealId:"d2", personId:"p2", ownerId:"u1", done:false, dueOn:"2026-09-03",
    what:"Introduce Marcus to Ade on tolerances",
    promisedOn:"2026-08-18", promiseNote:"offered in the proposal email" },

  { id:"c5", dealId:"d1", personId:"p1", ownerId:"u1", done:true, dueOn:"2026-08-14",
    what:"Cost the sealed housing route", promisedOn:"2026-08-11", promiseNote:"" },
];

const MEETINGS = [
  { id:"m1", personId:"p5", dealId:"d5", on:"2026-08-27", at:"14:00", mins:60,
    title:"Grip study kickoff", where:"Ovid, Leiden", withTeam:["u1","u3"] },
  { id:"m2", personId:"p1", dealId:"d1", on:"2026-08-31", at:"10:30", mins:30,
    title:"Housing route decision", where:"Video", withTeam:["u1"] },
];

/* Sent, not yet answered. Shown apart from actions — these are theirs, not yours. */
const PENDING = [
  { id:"w1", personId:"p5", ownerId:"u1", sentOn:"2026-08-24", what:"NDA out for countersignature" },
  { id:"w2", personId:"p1", ownerId:"u1", sentOn:"2026-08-22", what:"Sealed-housing cost breakdown, with their procurement" },
];
