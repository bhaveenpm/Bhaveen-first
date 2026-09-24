# KeyButton

A button that shows its keyboard shortcut on a key cap, so the desk teaches its own keys.

- One `primary` per pane, for the action that pane exists for: "Mark sent", "Mark followed up". Everything else is secondary.
- The label says exactly what happens, verb first: "Mark sent", "Tomorrow", "Open Nadia". The toast that follows repeats the verb: "Marked sent".
- Consumer provides `keyLabel` (the shortcut) and the label as children. Wire the same handler to the key itself; the cap is a promise that the key works.
