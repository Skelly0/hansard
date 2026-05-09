# Player Guide: Aging & Death

## How time passes

Time only advances when staff run `/time advance`. Each advance ticks every living character forward by one or more units (default: months). Nothing happens to your character between advances.

## Character creation

- Starting age: 18 to 70.
- Starting age determines bonus favours:
  - 35+ → 1 favour
  - 45+ → 2 favours
  - 60+ → 3 favours
- Highest tier wins (a 60-year-old gets 3, not 6).

## Ailments

From age 50, every tick rolls a chance of acquiring an ailment. The chance grows with age.

Possible ailments:

| Name | Severity | Min age |
|---|---|---|
| gout | minor | — |
| fever | minor | — |
| pneumonia | major | — |
| tuberculosis | major | — |
| heart disease | major | 55 |
| stroke | critical | 60 |

You cannot acquire the same ailment twice. Staff can also assign any other ailment manually, with any severity.

## Death

Three causes contribute to the per-tick death roll:

1. **Old age** — from age 62 onward, each tick has a small chance of natural death. The chance grows with age.
2. **Critical ailments** — each critical ailment adds a flat per-tick death chance.
3. **Stacked major ailments** — having two or more major ailments adds further per-tick risk.

Most characters die between ages 60 and 70. Surviving past 70 is rare.

## When a character dies

- The character is marked deceased.
- All offices they held are vacated.
- An obituary is generated from their event log: party history, offices served, cause of death.
- The character cannot be revived.

## Staff actions

Staff can:
- Assign or cure ailments at any time.
- Kill a character directly for storyline reasons.
- Adjust the season's aging configuration.
