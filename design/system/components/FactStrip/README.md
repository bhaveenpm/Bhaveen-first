# FactStrip

A row of labelled facts about a deal or a person: value, stage, last touch, what you owe.

- Four cells at most. Money and counts are `figure` (mono). A fact that needs action is `late`.
- Use `fill` for equal columns under an action; leave it off beside a person's name so cells size to their content.
- Consumer provides `facts`: `{label, value, figure?, late?}`.
