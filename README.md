# Halden — a small-team CRM prototype

A working prototype of a CRM for a 2–10 person organisation. The seeded team is
**Halden Works**, a six-person industrial design studio selling retainers to hardware
companies.

The premise: a team this size has no pipeline meeting and no sales ops. Its CRM has one
job — **answer "what needs me today, and why"** — so the home screen is an ordered
worklist, not a dashboard.

Everything is fictional. No real people, companies or Google accounts are involved.

## Run it

No build step, no dependencies. Fonts are bundled, so it also runs offline.

```
python3 -m http.server 8000
# then open http://localhost:8000
```

`file://` works too, though some browsers restrict `localStorage` there.

Sign in with either seeded account. **Priya Raman** owns most of the deals and has the
fuller day; **Tomás Vidal** owns the Nine Volt retainer.

## The four screens

| | |
|---|---|
| **Sign in** | Simulated Google flow: account chooser → scope consent → redirect. |
| **Today** | The ordered list of actions, grouped Late / Today / This week / Going quiet. |
| **Relationship** | One contact: contact cadence, promises, open deal, full history. |
| **Deals** | Every deal with the health flag that put it on someone's day. |

A fifth **People** index hangs off the rail.

## How "today" is decided

`assets/actions.js` derives the list; nothing in it is hand-written. Five rules fire,
each carrying its own reason and score:

| Rule | Fires when | Reads as |
|---|---|---|
| Promise | An open commitment is due today or past due | *Due 3 days ago. You said Monday, on the call.* |
| Meeting | A calendar event lands today | *60 minutes, Ovid, Leiden. Last spoke 3 days ago.* |
| No reply | Something was sent ≥5 days ago and nothing came back | *Sent 9 days ago, no reply.* |
| Renewal | A retainer renews inside 21 days | *Renews in 14 days. Quiet for 35 days — too quiet to ask cold.* |
| Going quiet | Silence exceeds what the deal's stage can carry | *34 days quiet. 44 days in Discovery, against a usual 21.* |

Each stage carries its own cadence — Negotiation tolerates four days of silence,
Discovery ten — so "quiet" means something different at each step.

Two rules keep the list honest:

- **One action per deal.** If several rules fire on the same deal, the loudest wins and
  the rest fold into it as *Also owed: …*. A single meeting never becomes three cards.
- **Sent work is not your work.** Anything sitting with the other side drops below the
  fold into *Sitting with them*, and only returns as an action once it goes stale.

`Mine` / `Whole studio` switches between your day and the studio's — the useful unit of
"everyone" when everyone is six people.

## The design

**The spine.** A single rule runs down the left of the day. Each action pins to it with a
mark whose *shape* is the reason it surfaced — filled dot for a promise you made, ring for
a reply you're waiting on, gold diamond for a meeting today, fading bar for a relationship
going quiet, triangle for a renewal. The rule fills gold behind the work you've cleared, so
the day burns down in front of you and ends on a single terminus dot.

The same shape language repeats in the relationship timeline (filled = you reached out,
ring = they did) and in the contact-cadence strip, where silence is drawn as the gaps
between bars rather than described in a number.

- **Palette** — sage-grey paper `#E8EAE3`, green-black ink `#131A16`, gold `#C9922A` for
  what's lit, indigo `#2E2FA6` for actions, rust `#A33417` for late, used sparingly.
- **Type** — Petrona for display, Archivo for interface, Spline Sans Mono for data and
  labels. Bundled under the SIL Open Font License.
- Responsive to 390px, visible keyboard focus, `prefers-reduced-motion` respected.

## The simulated sign-in

`Continue with Google` opens an in-page account chooser and scope-consent sheet modelled
on Google's, then a short redirect delay. It **never contacts Google, never asks for a
password, and never collects a credential** — the two accounts are hard-coded in
`assets/app.js`. Every step is labelled *Simulated · prototype only*. The session is a
`localStorage` key; signing out clears it.

## Files

```
index.html            shell
assets/data.js        seeded team, accounts, people, deals, touches, promises
assets/actions.js     the derivation engine and deal health
assets/app.js         views, router, simulated auth
assets/styles.css     design tokens and all styling
assets/fonts/         bundled woff2 (OFL 1.1)
```

## Prototype limits

State lives in memory and resets on reload — clearing an action, logging a note or ticking
a promise all work, but nothing persists. "Today" is pinned to 27 August 2026 in
`assets/data.js` so the seeded day reads the same every time.
