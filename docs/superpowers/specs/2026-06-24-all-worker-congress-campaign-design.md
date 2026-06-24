# All-Worker Congress Campaign Design

**Status:** Approved for implementation on 2026-06-24

## Purpose

Create an auditable, GM-operated campaign phase for elections to the All-Worker Congress. Players submit campaign actions through tickets and spend favours through the existing bot workflow. GMs verify those spends and record approved actions in the live `SCORP 2.5 Colony Backend` Google Sheet. The workbook translates the actions into Federation-level party support, allocates seats, permits explicit GM intervention, and freezes a certified result for downstream government calculations.

## Goals

- Give players several days to influence the election through their parties and favours.
- Make one favour a meaningful but non-determinative intervention in one Trade Federation.
- Make ideological similarity between the favour source and Federation affect effectiveness automatically.
- Apply weak diminishing returns to repeated spending by the same party in the same Federation.
- Prevent Independent from winning any Congress seats while leaving the party available elsewhere in the simulation.
- Give GMs both support-level adjustments and direct seat overrides.
- Keep every player action and GM intervention auditable by ticket number, initials, and explanation.
- Freeze certified results so later changes to party support or campaign inputs cannot rewrite the election.
- Repair the existing shifted Congress and Council result formulas as part of the implementation.
- Include an in-sheet operating guide with an example action and clear colour coding.

## Non-Goals

- No new Discord command or automated ticket-to-sheet integration.
- No automatic verification or deduction of favour balances from the bot database.
- No candidate roster, turnout, spoiled-ballot, or named-delegate system.
- No random campaign-event simulator.
- No change to the constitutional Federation apportionment rules in Article 15.

## Constitutional And Workbook Basis

Article 15 of the Lunar Workers' Constitution makes the Trade Federations the electoral constituencies for the All-Worker Congress. Each active Federation receives at least two delegates, representation is proportional to enrollment, and the divisor must remain between 1,000 and 10,000 citizens per delegate. The existing `All-Worker Congress` tab implements a two-seat floor followed by Hare largest-remainder allocation.

The campaign system changes the party split inside each Federation delegation. It does not change Federation enrollment or the number of seats apportioned to each Federation. Party support originates in `Trade Federations`, party definitions originate in `Parties`, GoI political vectors originate in `Politics`, and certified Congress results continue into `Council`.

## Workbook Architecture

Add one visible tab named `Congress Campaign`. It owns the guide, campaign controls, action ledger, provisional results, GM overrides, validation, and certified snapshot. Formula/helper regions should be visually distinct and protected from casual editing.

The data flow is:

1. Read baseline Federation-to-party support from `Trade Federations`.
2. Remove Independent from Congress eligibility and proportionally renormalize support across eligible founded parties.
3. Add approved ticket effects and approved GM support adjustments.
4. Clamp party support at zero and renormalize every Federation to 100 percent.
5. Allocate each Federation's existing delegation among eligible parties by Hare largest remainder.
6. Replace a Federation's provisional allocation with a valid direct GM seat override when one is present.
7. Copy the final provisional matrix into a literal certified snapshot.
8. Make `All-Worker Congress` party totals and `Council` allocation read the certified snapshot once the election is certified.

The existing `All-Worker Congress` tab remains the public-facing results dashboard. The new campaign tab is the GM operating surface.

## In-Sheet Guide

The top of `Congress Campaign` must contain a concise numbered guide covering:

1. open the campaign and set its dates;
2. verify a ticket and the corresponding favour spend;
3. enter the action using the exact ticket number and dropdown-backed names;
4. approve the row and read its calculated effect;
5. inspect provisional support and seat allocations;
6. add an explained GM support adjustment or direct seat override if required;
7. close the campaign;
8. copy provisional seats as values into the certified-results block;
9. verify every validation check is green; and
10. mark the election certified.

The guide must include one completed example action. Its example values must be clearly labelled as illustrative rather than live. A colour legend must identify:

- blue: GM input;
- grey: formulas/read-only calculations;
- amber: incomplete or pending review;
- red: invalid or certification-blocking;
- green: valid/certified output.

## Campaign Configuration

The visible configuration block must include:

- campaign status: `Draft`, `Open`, `Closed`, or `Certified`;
- campaign opening date;
- campaign closing date;
- citizens-per-delegate divisor, linked to the constitutional input currently in `All-Worker Congress!B4`;
- census/election label;
- base support effect per favour, default `5` percentage points;
- minimum similarity multiplier, default `0.75`;
- maximum similarity multiplier, default `1.25`;
- repeated-spend decay per prior favour, default `0.05`;
- diminishing-return floor, default `0.70`; and
- certified Congress size and validation status.

Configuration values are GM inputs. Formula regions must reference them rather than hardcoding the defaults throughout the workbook.

## Action Ledger

The campaign ledger must support at least 200 rows and use these columns:

| Column | Type | Meaning |
| --- | --- | --- |
| Action Type | Input dropdown | `Ticket Action`, `GM Event`, or `Correction` |
| Ticket Number | Input text | Required and unique for ticket actions |
| Date | Input date | Date the action was approved |
| Player / Character | Input text | Actor named in the ticket |
| Party | Input dropdown | Exact founded party name |
| Favour Source | Input dropdown | Exact GoI/favour-source name from `Politics!A4:A9` |
| Target Federation | Input dropdown | Exact Federation name from `Trade Federations!A38:A45` |
| Favours Spent | Input number | Non-negative whole number; normally at least one for ticket actions |
| GM Support Adjustment | Input number | Optional signed percentage-point adjustment |
| GM Initials | Input text | Required for approval and all GM adjustments |
| Reason / Action Summary | Input text | Required description of the action or intervention |
| Approved? | Input checkbox | Only approved rows affect results |
| Similarity | Formula | Normalized ideological similarity from zero to one |
| Similarity Multiplier | Formula | Scaled from configured minimum to maximum |
| Diminishing Multiplier | Formula | Weak repeated-spend penalty with configured floor |
| Calculated Favour Effect | Formula | Total support effect from favours |
| Net Support Effect | Formula | Calculated effect plus GM support adjustment |
| Validation | Formula | Human-readable row status |

Unapproved, incomplete, or invalid rows must contribute zero to election calculations without being erased from the audit trail. `GM Event` and `Correction` rows may leave Ticket Number and Favour Source blank when Favours Spent is zero; they still require Party, Target Federation, GM Initials, Reason / Action Summary, and approval.

## Similarity Calculation

Favour sources use the six effective political axes in `Politics!K:P`. Target Federations use the six enrollment-weighted stance axes in `Trade Federations!B:G`, with names in column A.

For each action:

1. resolve the source and target by exact dropdown-backed names;
2. calculate Euclidean distance across `Expn`, `Auth`, `Corp`, `Tech`, `Faith`, and `Mat`;
3. normalize that distance by the maximum possible distance on six axes ranging from 1 to 7: `6 × SQRT(6)`;
4. calculate similarity as `1 - MIN(1, distance / (6 × SQRT(6)))`, where one is identical; and
5. linearly scale the score between the configured `0.75` and `1.25` multipliers.

This makes a neutral one-favour action worth about five support points, a highly aligned action worth up to 6.25, and a very dissimilar action worth as little as 3.75 before diminishing returns.

## Weak Diminishing Returns

Diminishing returns are counted per party and target Federation across approved actions. Individual favours are ordered by ledger row and receive:

`MAX(diminishing floor, 1 - decay × prior favours spent by that party in that Federation)`

With the approved defaults, neutral-similarity favours produce approximately `5.00`, `4.75`, `4.50`, `4.25`, `4.00`, `3.75`, and `3.50` points, then remain at a minimum of `3.50` each. A multi-favour action must sum the marginal value of each favour rather than multiplying every favour by only the final diminished rate.

## Independent Exclusion

Independent remains available in `Parties` for non-Congress uses but is ineligible for Congress seats. Before campaign actions are applied, its Federation support is removed and all eligible founded parties are proportionally renormalized to 100 percent.

All Congress calculation, provisional result, override, certification, and Council input ranges must exclude Independent. A certification check must fail if Independent receives any Congress seat through a stale formula or manual entry.

## GM Intervention

### Support Adjustments

GMs may enter a signed `GM Support Adjustment` on an approved ledger row. This permits ticket-specific interpretation, colony events, corrections, and bespoke adjudication. Any non-zero GM adjustment requires GM initials and a reason. Its contribution is visible separately from the automatic favour effect.

### Direct Seat Overrides

Provide a party-by-Federation seat-override matrix. Blank rows mean that the provisional Hare allocation remains authoritative. If any override is entered for a Federation, GMs must complete the entire row for all eligible parties.

An override row is valid only when:

- every value is a non-negative whole number;
- the row total exactly equals that Federation's apportioned delegation;
- Independent is absent;
- GM initials are present; and
- an override explanation is present.

Invalid overrides must be visibly red, must not silently feed downstream results, and must block certification. Valid overrides replace only that Federation's provisional party allocation.

## Certification

Google Sheets formulas cannot safely freeze their own historical values without script or circular calculation. Certification therefore uses an explicit literal snapshot:

1. set campaign status to `Closed`;
2. resolve every validation error;
3. copy the final provisional seat matrix;
4. paste values only into the certified-results matrix;
5. confirm certified Federation totals, Congress total, party names, and zero Independent seats;
6. set campaign status to `Certified`.

When status is `Certified`, downstream `All-Worker Congress` and `Council` formulas read the certified literal matrix. Before certification, the dashboard may display provisional results but must label them clearly. Changing the action ledger, party definitions, political axes, or Federation support after certification must not alter the certified result.

## Validation And Failure Handling

The campaign tab must surface these checks:

- campaign dates are present and closing is not before opening;
- ticket numbers are unique and present for ticket actions;
- party, favour source, and Federation names resolve exactly;
- favours spent are non-negative whole numbers;
- approved actions contain GM initials and a reason;
- non-zero GM adjustments contain GM initials and a reason;
- every provisional Federation support row totals 100 percent;
- every provisional Federation seat row equals its delegation size;
- every active override row is complete and balanced;
- the certified matrix matches the apportioned Congress size;
- certified Federation totals equal their delegations;
- Independent has zero seats; and
- certified results exist before status can be treated as certified.

The sheet cannot prove that a bot favour transaction occurred. The guide must explicitly instruct GMs to verify and deduct the favour before approving the ledger row. Ticket Number, Player / Character, GM Initials, and Reason / Action Summary provide the cross-system audit trail.

## Existing Formula Repair

The current `All-Worker Congress` result wiring is shifted:

- labelled Congress totals are hardcoded in row 45 while their formulas sit in row 46;
- Council quotas read the zero row;
- labelled Council results are hardcoded in row 49 while malformed formulas sit in row 50; and
- `Council!C4:C19` consequently reads zero allocations.

Implementation must remove the orphaned shifted formulas, restore labelled result rows as formulas, and route downstream Council seats through the valid final or certified result. The repair must preserve the existing Hare largest-remainder method and Council size control in `Council!F3`.

## Acceptance Criteria

The implementation is accepted when all of the following are demonstrated in the live workbook:

1. The in-sheet guide and example make the GM workflow understandable without external instructions.
2. An approved one-favour aligned action creates a larger effect than an otherwise identical dissimilar action.
3. Repeated favours show the approved weak diminishing sequence and respect the floor.
4. Unapproved and invalid rows contribute zero.
5. Independent receives no provisional, overridden, certified, or Council seat.
6. Every Federation support row totals 100 percent.
7. Every Federation seat allocation equals its existing delegation.
8. A valid direct override replaces one Federation result; an invalid override blocks certification.
9. Certified results remain unchanged when an underlying campaign action or party support value changes.
10. Congress party totals equal Congress size.
11. Council party seats equal the configured Council size and are no longer all zero.
12. Formula and input regions are visually distinct, and formula cells used by the workflow are not overwritten.

## Implementation Boundary

This design changes the live Google workbook and project documentation only. It does not require bot, API, web, or database code. If automatic ticket ingestion or favour deduction is later desired, that is a separate integration project and must not be smuggled into this spreadsheet implementation.
