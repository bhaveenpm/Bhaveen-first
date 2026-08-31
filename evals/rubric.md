# Human rubric (spec §10)

Score 1–5 per dimension, per output. Three raters, or one rater across three passes on
shuffled outputs. Score the copy as it appears in the UI — placeholders and hedges
included, because that is what the merchant sees.

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| **Truthfulness** | Contains a claim I'd have to remove before publishing | One or two claims I'd want to double-check, but nothing false | Everything is either true from the photo or explicitly flagged |
| **Publishability** | I'd rewrite it | I'd edit a few sentences | I'd publish after filling the placeholders |
| **Distinctiveness** | Could describe any product in the category | Recognisably this kind of product | Specific to this object — mentions what I can actually see |
| **Voice fit** | Ignores the tone preset | Roughly the right register | Clearly the selected tone |

## Ship gate

- A1–A6 green in `npm run eval` **against real photographs**, not stand-in renders
- Mean truthfulness ≥ 4.5
- Mean publishability ≥ 3.5

A truthfulness score of 1 or 2 on **any** output blocks the ship regardless of the mean.
One false claim on a live listing is a returns-and-chargebacks problem, and averaging it
away is how that ships.

## Scoring notes

- A `[SPECIFY: …]` placeholder is **not** a truthfulness deduction. It is the product
  working. Deduct only if the placeholder is missing where it should be, or present
  where the answer was visible in the photo all along.
- A hedge ("appears to be ceramic") is not a distinctiveness deduction either.
- Deduct publishability for placeholders only when there are so many that the copy
  reads as a form rather than a description.
