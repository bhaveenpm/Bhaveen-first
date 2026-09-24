# QueueRow

One action in the queue: its reason mark, who it is with, what to do, and how old it is.

- The name is short (first name and initial) so the task gets the width. The age is mono and right-aligned: "3d late", "14:00", "9d", "in 14d".
- Selection is a `select` edge plus a `select-soft` fill, and the task brightens to `ink`. Exactly one row is selected while the queue has items.
- J and K move the selection, E clears it, S sends it to tomorrow, Enter opens the person.
- `waiting` rows sit in the With them group: shown for context, never selectable.
- Consumer provides `kind`, `who`, `what`, `age`, `late`, `selected` and `onSelect`.
