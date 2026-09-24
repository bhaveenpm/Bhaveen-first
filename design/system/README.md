Halden is a CRM for teams of two to ten who have no pipeline meeting. Its one screen that matters is a queue: what needs you today, why, and the key that clears it. This system is the Triage desk: a dense, dark, keyboard-first desk built to be emptied in minutes by the person who owns the relationships.

## Voice

- Write from the user's side of the screen. People have **promises, meetings, replies and silences**, never tasks, events or records.
- Lead with the fact, then the context, both as sentences: "Due 3 days ago. You said Monday, on the call." "Sent 9 days ago, no reply."
- A control says exactly what happens, verb first: "Mark sent", "Tomorrow", "Open Nadia". The toast repeats the verb: "Marked sent · Nadia Okonjo".
- Sentence case everywhere except mono labels, which are uppercase: `PROMISE · LATE`.
- Short names in the queue ("Nadia O."), full names in the detail pane.
- Relative time in rows ("3d late", "in 14d"), plain dates in the log ("22 Aug"). Money in euros with a thousands comma: "€48,000".
- No exclamation marks, no emoji, no celebration when the queue is clear. "Nothing left in the queue." is the whole message.
- Empty states say where things come from and offer the first step: "Nothing has come due. The queue fills itself as your week happens."

## The reason marks

Every item on the day carries one of five marks, drawn by `ReasonMark`. They are the signature of the product; use them wherever an item appears, and nowhere else.

| Mark | Reason | Engine rule |
| --- | --- | --- |
| filled dot, `ink` | A promise you made | An open commitment is due today or past due |
| gold diamond, `meeting` | A meeting today | A calendar event with a known contact lands today |
| ring, `ink-muted` | Waiting on a reply | Something sent 5 or more days ago got no answer |
| fading bar | Going quiet | Silence is longer than the deal's stage allows |
| green triangle, `renewal` | Renewal ahead | A retainer renews inside 21 days |

The shape carries the meaning, so the marks still read without colour. Colour adds one thing only: a late promise dot and a late reply ring turn `late`.

## Colour

- One theme, Night. Put pages on `ground`; group content on `panel`; hover and secondary buttons on `raise`. Depth comes from these three steps. There are no shadows.
- `ink` for primary text, `ink-muted` for secondary text, `ink-faint` for mono labels, ages and counts. All three pass 4.5:1 on `ground`, `panel` and `raise`; `ink-faint` is the floor, never go dimmer.
- `select` is the only accent. Spend it on selection (the row edge over `select-soft`), the one primary KeyButton per pane, the focus ring, and logged notes. Text on a `select` fill is `on-select`.
- `late`, `meeting` and `renewal` are signals, not decoration. `late` only for overdue items and always beside the word late; `meeting` only for meetings; `renewal` only for renewals and kept promises. A signal colour never appears without its mark or its word.
- `line` for hairlines between rows and panes. Borders of inputs, buttons and checkboxes use `line-strong` (3:1 or better).

## Type

- Set everything in Barlow Semi Condensed (`--font-ui`); its narrow width is what lets a queue row hold a name, a task and an age at 420px.
- Anything counted, timed or labelled is JetBrains Mono (`--font-mono`): ages, dates, money in fact strips, key caps, uppercase labels.
- `type-title` for the one headline in a pane (the selected action, a person's name). `type-heading` for empty-state headings. `type-body` for reasons and notes, with the key fact at weight 600. `type-row` for queue rows. `type-small` for role lines and button labels.
- `type-label` is uppercase with its tracking and sits in `ink-faint` or a signal colour. `type-meta` for ages and dates; `type-figure` for money.
- Hierarchy comes from weight, not size. Do not add sizes between the ones defined.

## Space, shape, layout

- 4px base: `space-1` to `space-8`. Rows breathe with `space-2` vertically and `space-4` at the sides; the detail pane uses `space-6` to `space-8`.
- Nearly square: `radius-sm` for checkboxes and heat cells, `radius-md` for every control and box, `radius-lg` for a person's initials tile. Nothing is pill-shaped.
- The desk is a fixed frame: a `TopBar` (`topbar-height`), a queue pane up to `queue-width` beside a detail pane, and a `KeyLegend` (`footbar-height`). Only the panes scroll. Below 860px the queue stacks above the detail.
- The relationship screen reuses the frame: identity and a `FactStrip` on one line, `ContactHeat` under it, then `LogTable` beside a column of `Box`es.

## Keys and states

- The desk is operated from the keyboard: J and K move, E clears, S sends to tomorrow, Enter opens the person, U undoes, L jumps to the log. Every key shown on a `Key` cap works, and every shortcut appears in the `KeyLegend`.
- Exactly one queue row is selected while the queue has items. Selection is the `select` edge plus `select-soft` fill plus the task brightening to `ink`; never fill alone.
- Keyboard focus is a solid 2px `select` outline with a 2px offset, on every control.
- Clearing an item shows a `Toast` with Undo for five seconds. Nothing is ever deleted from the day without a way back.
- Motion is limited to the progress bar filling. Respect reduced motion.

## Iconography

There is no icon set. The five reason marks and the key caps are the only glyphs, drawn in CSS so they take token colours. Do not add a general-purpose icon library; if a screen needs a symbol the marks do not cover, use a word.

## Logo

Halden has no logo mark. The wordmark is HALDEN set in `type-brand`, preceded by a 7px `select` square, and appears only in the `TopBar`.
