# All-Worker Congress Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved, GM-operated Congress campaign and certification workflow inside the live `SCORP 2.5 Colony Backend` Google Sheet.

**Architecture:** Add one visible `Congress Campaign` tab containing guide/configuration, a 200-row action ledger, calculation matrices, GM seat overrides, validation, and a literal certified snapshot. Feed its provisional or certified party-by-Federation seats into the existing `All-Worker Congress` dashboard, repair the shifted Congress/Council formulas, and leave bot/API/web/database code unchanged.

**Tech Stack:** Native Google Sheets formulas, data validation, conditional formatting, protected ranges, and Google Sheets `spreadsheets.batchUpdate` through the connected Google Drive tools.

## Global Constraints

- Target only spreadsheet `<CAMPAIGN_SHEET_ID>` (`SCORP 2.5 Colony Backend`).
- Do not add bot commands or automatic ticket/favour integration.
- Preserve `Parties!J:AP`, `Politics`, `Trade Federations`, named ranges, and unrelated workbook formulas.
- `Independent` remains a party elsewhere but is ineligible for Congress and Council seats.
- One favour has a default base effect of 5 percentage points on one Federation.
- Similarity multiplier defaults to `0.75–1.25`; repeated-spend decay defaults to `0.05` with a `0.70` floor.
- Ticket actions are entered manually by GMs and keyed by unique Ticket Number.
- Invalid or unapproved actions contribute zero.
- Direct seat overrides require a complete balanced row, GM initials, and a reason.
- Certified results are literal values and must not drift after later source changes.
- Every content write must be followed by connector readback of the exact edited range.
- Live-sheet tasks use readback checkpoints instead of git commits; no repository code changes are part of implementation.

## Workbook Map And Exact Layout

| Surface | Range | Responsibility |
| --- | --- | --- |
| `Congress Campaign` | `A1:S12` | Title, GM guide, configuration, colour legend, example |
| `Congress Campaign` | `A13:S214` | Action-log title/header plus 200 input/formula rows (`15:214`) |
| `Congress Campaign` | `U1:W17` | Party slots and Congress eligibility |
| `Congress Campaign` | `U20:AK29` | Independent-free baseline Federation support |
| `Congress Campaign` | `U32:AK41` | Approved campaign effects |
| `Congress Campaign` | `U44:AK53` | Normalized final support |
| `Congress Campaign` | `U56:AK65` | Provisional Hare seat allocation |
| `Congress Campaign` | `U68:AN77` | Direct GM seat overrides and audit fields |
| `Congress Campaign` | `U80:AK89` | Final provisional seats after valid overrides |
| `Congress Campaign` | `U92:AK101` | Literal certified seat snapshot |
| `Congress Campaign` | `U104:W112` | Certification and integrity checks |
| `All-Worker Congress` | `B4:B5`, `B35:R50` | Configuration link, campaign seat import, result-formula repair |
| `Council` | `C4:C20` | Verified Council seat read-through |

The new tab must have at least 220 rows and 40 columns (`A:AN`). Capture its returned `sheetId` after creation and use that live id in every later `GridRange`.

---

### Task 1: Ground The Live Workbook And Create The Campaign Tab

**Files:**
- Create in Google Sheets: `Congress Campaign`
- Inspect: `Trade Federations!A38:G56`
- Inspect: `Politics!A4:P9`
- Inspect: `Parties!A4:AP18`
- Inspect: `All-Worker Congress!A1:R62`
- Inspect: `Council!A1:F22`

**Interfaces:**
- Consumes: live workbook metadata and the approved design specification.
- Produces: a new empty `Congress Campaign` sheet with a resolved live `sheetId`.

- [ ] **Step 1: Re-read spreadsheet metadata**

Call `get_spreadsheet_metadata` for the exact spreadsheet id. Confirm these live sheet ids before any write:

```text
Parties              20498011
Politics             713963215
Council              1631499992
Trade Federations    1969420760
All-Worker Congress  722200705
```

Expected: no sheet named `Congress Campaign` exists. If it exists, stop and inspect `A1:AN214`; do not create a duplicate.

- [ ] **Step 2: Re-read all source and repair ranges with cell metadata**

Use `get_spreadsheet_cells` with:

```text
cell_fields = formattedValue,effectiveValue,userEnteredValue,dataValidation,note
```

Expected source contracts:

```text
Trade Federations!A38:G45  = Federation axis vectors
Trade Federations!A48:P56  = party-support headers and eight Federation rows
Politics!A4:A9             = six GoI/favour-source names
Politics!K4:P9             = source axis vectors
Parties!A4:B18             = party names and founded flags
All-Worker Congress!F11:F18 = Federation delegation sizes
Council!F3                 = Council size knob
```

- [ ] **Step 3: Create the sheet**

Send one `addSheet` request:

```json
{
  "addSheet": {
    "properties": {
      "title": "Congress Campaign",
      "gridProperties": { "rowCount": 220, "columnCount": 40, "frozenRowCount": 14, "frozenColumnCount": 2 }
    }
  }
}
```

Expected: response contains a new `sheetId`; record it as `CAMPAIGN_SHEET_ID`.

- [ ] **Step 4: Verify tab creation**

Re-read metadata and `Congress Campaign!A1:AN3`.

Expected: exact title, 220 rows, 40 columns, and empty cells.

---

### Task 2: Build The Guide, Configuration, And Action Ledger

**Files:**
- Modify: `Congress Campaign!A1:S214`

**Interfaces:**
- Consumes: `CAMPAIGN_SHEET_ID` from Task 1.
- Produces: GM-facing inputs in `B2:B11` and `A15:L214`, with formula columns reserved in `M:S`.

- [ ] **Step 1: Write title, configuration labels, and defaults**

Write these values:

```text
A1  ALL-WORKER CONGRESS — CAMPAIGN CONTROL
A2  Campaign Status                 B2  Draft
A3  Opens                           B3  [blank date]
A4  Closes                          B4  [blank date]
A5  Election / Census Label         B5  2076 Congress Election
A6  Citizens per Delegate           B6  3300
A7  Base Support per Favour (pp)    B7  5
A8  Minimum Similarity Multiplier   B8  0.75
A9  Maximum Similarity Multiplier   B9  1.25
A10 Repeated-Spend Decay            B10 0.05
A11 Diminishing Floor               B11 0.70
A12 Effective Status                B12 =IF(B2="Certified",IF($V$111="OK","CERTIFIED","CERTIFICATION BLOCKED"),B2)
```

Set validations:

```text
B2  ONE_OF_LIST: Draft, Open, Closed, Certified
B6  NUMBER_BETWEEN: 1000, 10000
B7  NUMBER_GREATER_THAN_EQ: 0
B8:B11 NUMBER_BETWEEN: 0, 1.5
```

- [ ] **Step 2: Write the in-sheet guide and illustrative example**

Merge `D2:S8` and write wrapped guide text containing the approved ten-step workflow. Merge `D9:S10` and write:

```text
EXAMPLE — illustrative only: Ticket Number 1842; Ticket Action; party The All Lunar Labor Bund; favour source Proletariat; target Industrial Production; 1 favour; Approved checked. Verify/deduct the favour in the bot before approval.
```

Write the colour legend in `D11:S11`:

```text
Blue = GM input | Grey = formula/read-only | Amber = pending/incomplete | Red = invalid/blocking | Green = valid/certified
```

- [ ] **Step 3: Write action-ledger headers**

Write `A13:S14`:

```text
A13 CAMPAIGN ACTION LEDGER — one row per approved ticket, GM event, or correction
A14 Action Type
B14 Ticket Number
C14 Date
D14 Player / Character
E14 Party
F14 Favour Source
G14 Target Federation
H14 Favours Spent
I14 GM Support Adjustment (pp)
J14 GM Initials
K14 Reason / Action Summary
L14 Approved?
M14 Similarity
N14 Similarity Multiplier
O14 Prior Favours
P14 Diminishing Multiplier
Q14 Calculated Favour Effect (pp)
R14 Net Support Effect (pp)
S14 Validation
```

- [ ] **Step 4: Add input validation for rows 15–214**

Use strict validation rules:

```text
A15:A214 ONE_OF_LIST: Ticket Action, GM Event, Correction
E15:E214 ONE_OF_RANGE: Parties!$A$4:$A$18
F15:F214 ONE_OF_RANGE: Politics!$A$4:$A$9
G15:G214 ONE_OF_RANGE: 'Trade Federations'!$A$38:$A$45
H15:H214 CUSTOM_FORMULA: =OR(H15="",AND(ISNUMBER(H15),H15>=0,H15=INT(H15)))
L15:L214 CHECKBOX
```

Format `C15:C214` as dates, `M:N` and `P` as `0.00`, and `H:I`, `Q:R` as `0.00`.

- [ ] **Step 5: Apply the workbook-native style and protections**

Apply white body cells, black text, light-grey headers, subtle borders, wrapped guide text, and filters on `A14:S214`. Use pale blue fill for literal input ranges `B2:B11` and `A15:L214`; grey fill for formula ranges `B12` and `M15:S214`. Add warning-only protected ranges over `B12`, `M15:S214`, and later calculation blocks so editors receive a warning without changing sharing permissions.

- [ ] **Step 6: Verify the GM surface**

Read `Congress Campaign!A1:S16` with cell metadata.

Expected: exact `Ticket Number` header, dropdowns/checkboxes present, `B2=Draft`, `B6=3300`, `B7=5`, guide and example visible, input/formula fills distinct.

---

### Task 3: Implement Action Validation, Similarity, And Weak Diminishing Returns

**Files:**
- Modify: `Congress Campaign!M15:S214`

**Interfaces:**
- Consumes: configuration `B7:B11`, source vectors `Politics!K4:P9`, target vectors `'Trade Federations'!B38:G45`, and action inputs `A15:L214`.
- Produces: valid net support effects in `R15:R214`; only rows whose `S` value is `OK` contribute downstream.

- [ ] **Step 1: Write row-15 formulas**

Enter these formulas exactly:

```gs
M15 =IF($H15=0,1,IFERROR(1-MIN(1,SQRT(SUMPRODUCT((XLOOKUP($F15,Politics!$A$4:$A$9,Politics!$K$4:$P$9)-XLOOKUP($G15,'Trade Federations'!$A$38:$A$45,'Trade Federations'!$B$38:$G$45))^2))/(6*SQRT(6))),""))

N15 =IF(M15="","",$B$8+M15*($B$9-$B$8))

O15 =0

P15 =IF($H15=0,0,SUM(ARRAYFORMULA(IF(1-$B$10*($O15+SEQUENCE($H15,1,0,1))<$B$11,$B$11,1-$B$10*($O15+SEQUENCE($H15,1,0,1)))))/$H15)

Q15 =IF($H15=0,0,$H15*$B$7*$N15*$P15)

S15 =IF(COUNTA($A15:$L15)=0,"",IF(NOT(OR($A15="Ticket Action",$A15="GM Event",$A15="Correction")),"INVALID: action type",IF(AND($A15="Ticket Action",OR($B15="",COUNTIF($B$15:$B$214,$B15)>1)),"INVALID: ticket number",IF(OR($E15="",COUNTIF(Parties!$A$4:$A$18,$E15)=0,LOWER(TRIM($E15))="independent",IFERROR(XLOOKUP($E15,Parties!$A$4:$A$18,Parties!$B$4:$B$18,FALSE),FALSE)<>TRUE),"INVALID: party",IF(OR($G15="",COUNTIF('Trade Federations'!$A$38:$A$45,$G15)=0),"INVALID: federation",IF(OR($H15<0,$H15<>INT($H15),AND($A15="Ticket Action",$H15<1)),"INVALID: favours",IF(AND($H15>0,COUNTIF(Politics!$A$4:$A$9,$F15)=0),"INVALID: favour source",IF(AND(OR($L15=TRUE,$I15<>0),OR($J15="",$K15="")),"INVALID: GM audit",IF($L15<>TRUE,"PENDING","OK")))))))))

R15 =IF($S15="OK",$Q15+$I15,0)
```

- [ ] **Step 2: Write the prior-favour formula in row 16**

```gs
O16 =IF(OR(E16="",G16=""),0,SUMIFS($H$15:H15,$E$15:E15,E16,$G$15:G15,G16,$L$15:L15,TRUE,$S$15:S15,"OK"))
```

- [ ] **Step 3: Fill formulas down**

Copy `M15:N15`, `P15:S15` through row 214. Copy `O16` through `O214`; preserve `O15=0`.

- [ ] **Step 4: Formula-unit test with three temporary rows**

Enter temporary valid actions in rows `15:17`, using existing founded parties and exact sources/Federations:

```text
Row 15: Ticket Action, ticket TEST-001, one favour, aligned source/target, Approved TRUE
Row 16: Ticket Action, ticket TEST-002, same party/Federation/source, one favour, Approved TRUE
Row 17: Ticket Action, ticket TEST-003, same party/Federation, a less-similar source, one favour, Approved TRUE
```

Expected:

```text
S15:S17 = OK
O15 = 0
O16 = 1
P15 = 1.00
P16 = 0.95
Q15 > Q17 when row 15 is more ideologically similar
```

Change row 17 to `Approved FALSE` and expect `S17=PENDING`, `R17=0`. Clear `A15:L17` after the test; formulas must remain.

---

### Task 4: Build Baseline Support, Campaign Effects, Final Support, And Provisional Seats

**Files:**
- Modify: `Congress Campaign!U1:AK65`

**Interfaces:**
- Consumes: party/founded slots, Federation baseline support, net campaign effects, and delegation sizes.
- Produces: party-by-Federation provisional seat matrix `V58:AJ65` with Independent fixed at zero.

- [ ] **Step 1: Build party eligibility**

Write headers `Party`, `Founded?`, `Congress Eligible?` in `U2:W2`. Link rows `3:17` to `Parties!A4:B18` and fill:

```gs
U3 =Parties!A4
V3 =Parties!B4
W3 =AND(U3<>"",V3=TRUE,LOWER(TRIM(U3))<>"independent")
```

Fill through row 17 using corresponding party rows. Expected: Independent is `FALSE`; each other currently founded named party is `TRUE`.

- [ ] **Step 2: Build the baseline matrix `U20:AK29`**

Use row 20 as title, row 21 as party headers, rows 22:29 as the eight Federations, and `AK` as row total.

```gs
V21 =U3
U22 ='Trade Federations'!A49
V22 =IF(NOT(INDEX($W$3:$W$17,COLUMN()-COLUMN($V$21)+1)),0,IFERROR(INDEX('Trade Federations'!$B$49:$P$56,ROW()-ROW($V$22)+1,COLUMN()-COLUMN($V$22)+1)/SUMPRODUCT(--TRANSPOSE($W$3:$W$17),INDEX('Trade Federations'!$B$49:$P$56,ROW()-ROW($V$22)+1,0)),0))
AK22 =SUM(V22:AJ22)
```

Fill `V21:AJ21`, `U22:U29`, `V22:AJ29`, and `AK22:AK29`. Format support as percentages. Expected: every `AK22:AK29` equals `100.0%`, and the Independent column is zero.

- [ ] **Step 3: Build campaign effects `U32:AK41`**

Mirror party headers and Federation names, then enter:

```gs
V34 =SUMIFS($R$15:$R$214,$E$15:$E$214,V$33,$G$15:$G$214,$U34,$S$15:$S$214,"OK")/100
AK34 =SUM(V34:AJ34)
```

Fill the eight-by-fifteen matrix. Format as percentages.

- [ ] **Step 4: Build normalized final support `U44:AK53`**

Mirror headers and names, then enter:

```gs
V46 =IF(NOT(INDEX($W$3:$W$17,COLUMN()-COLUMN($V$45)+1)),0,IFERROR(MAX(0,V22+V34)/SUMPRODUCT(--TRANSPOSE($W$3:$W$17),IF($V22:$AJ22+$V34:$AJ34<0,0,$V22:$AJ22+$V34:$AJ34)),0))
AK46 =SUM(V46:AJ46)
```

Fill across and down. Expected: every row total is `100.0%`, no cell is negative, Independent is zero.

- [ ] **Step 5: Build provisional Hare seats `U56:AK65`**

Mirror headers and Federation names, then enter:

```gs
V58 =LET(seats,XLOOKUP($U58,'All-Worker Congress'!$A$11:$A$18,'All-Worker Congress'!$F$11:$F$18,0),q,V46*seats,base,INT(q),rem,MOD(q,1)+COLUMN()/10000000000,allq,$V46:$AJ46*seats,allrem,ARRAYFORMULA(MOD(allq,1)+COLUMN($V46:$AJ46)/10000000000),leftover,ROUND(seats-SUMPRODUCT(INT(allq)),0),IF(OR(V$57="",q<=0),0,base+IF(RANK(rem,allrem)<=leftover,1,0)))
AK58 =SUM(V58:AJ58)
```

Fill across and down. Expected: integer non-negative seats, each `AK58:AK65` equals the matching `All-Worker Congress!F11:F18`, and Independent is zero.

- [ ] **Step 6: Verify the four matrices**

Read `Congress Campaign!U20:AK65` with values and formulas. Confirm exact row totals, no formula errors, and no Independent allocation.

---

### Task 5: Add GM Overrides, Certified Snapshot, And Blocking Checks

**Files:**
- Modify: `Congress Campaign!U68:AN112`

**Interfaces:**
- Consumes: provisional seats `V58:AJ65` and campaign status `B2`.
- Produces: final provisional seats `V82:AJ89`, literal certified seats `V94:AJ101`, and overall integrity status `V111`.

- [ ] **Step 1: Build direct override inputs `U68:AN77`**

Use row 69 as headers. Put Federation in `U`, the 15 party slots in `V:AJ`, `Override Total` in `AK`, `Override Status` in `AL`, `GM Initials` in `AM`, and `Reason` in `AN`. Mirror Federation names into `U70:U77` and party names into `V69:AJ69`.

Apply this validation to `V70:AJ77`:

```gs
=OR(V70="",AND(ISNUMBER(V70),V70>=0,V70=INT(V70)))
```

Enter and fill:

```gs
AK70 =SUM(V70:AJ70)
AL70 =IF(COUNTA(V70:AJ70)=0,"NOT USED",IF(AND(COUNT(V70:AJ70)=15,COUNTIF(V70:AJ70,"<0")=0,SUM(V70:AJ70)=XLOOKUP(U70,'All-Worker Congress'!$A$11:$A$18,'All-Worker Congress'!$F$11:$F$18,0),SUMIF($V$69:$AJ$69,"Independent",V70:AJ70)=0,AM70<>"",AN70<>""),"OK","INVALID"))
```

Fill rows 70:77. Colour valid rows green and invalid rows red with conditional formatting.

- [ ] **Step 2: Build final provisional seats `U80:AK89`**

Mirror headers/names and enter:

```gs
V82 =IF($AL70="OK",V70,V58)
AK82 =SUM(V82:AJ82)
```

Fill the matrix. An invalid override falls back visibly to the proportional result while `AL` remains `INVALID` and blocks certification.

- [ ] **Step 3: Build literal certified snapshot `U92:AK101`**

Mirror headers and Federation names with formulas in `U94:U101` and `V93:AJ93`. Leave `V94:AJ101` blank literal inputs. Set `AK94:AK101` to row totals. Apply non-negative whole-number validation to snapshot inputs and blue input formatting.

- [ ] **Step 4: Build validation summary `U104:V111`**

Write labels and formulas:

```gs
V105 =IF(COUNTIF($S$15:$S$214,"INVALID*")=0,"OK","BLOCKED")
V106 =IF(SUMPRODUCT(--(ABS($AK$46:$AK$53-1)>0.0001))=0,"OK","BLOCKED")
V107 =IF(SUMPRODUCT(--($AK$58:$AK$65<>XLOOKUP($U$58:$U$65,'All-Worker Congress'!$A$11:$A$18,'All-Worker Congress'!$F$11:$F$18)))=0,"OK","BLOCKED")
V108 =IF(COUNTIF($AL$70:$AL$77,"INVALID")=0,"OK","BLOCKED")
V109 =IF($B$2<>"Certified","NOT REQUIRED",IF(AND(COUNT($V$94:$AJ$101)=120,SUM($AK$94:$AK$101)='All-Worker Congress'!$B$7,SUMPRODUCT(--($AK$94:$AK$101<>XLOOKUP($U$94:$U$101,'All-Worker Congress'!$A$11:$A$18,'All-Worker Congress'!$F$11:$F$18)))=0,SUM(INDEX($V$94:$AJ$101,0,MATCH("Independent",$V$93:$AJ$93,0)))=0),"OK","BLOCKED"))
V110 =IF(SUM(INDEX($V$82:$AJ$89,0,MATCH("Independent",$V$81:$AJ$81,0)))=0,"OK","BLOCKED")
V111 =IF(AND(V105="OK",V106="OK",V107="OK",V108="OK",OR($B$2<>"Certified",V109="OK"),V110="OK"),"OK","BLOCKED")
```

Labels in `U105:U111`: `Action Ledger`, `Final Support`, `Provisional Seats`, `Overrides`, `Certified Snapshot`, `No Independent Seats`, `OVERALL`.

- [ ] **Step 5: Verify override failure and success paths**

Temporarily enter one partial override row. Expected: `AL=INVALID`, `V108=BLOCKED`, final provisional seats remain proportional. Then complete the row with 15 integers totaling the Federation delegation, Independent zero, initials, and reason. Expected: `AL=OK`, final provisional row equals override row, `V108=OK`. Clear the override test afterward.

- [ ] **Step 6: Verify certification stability**

Copy `V82:AJ89`, paste values only into `V94:AJ101`, set `B2=Certified`, and confirm `B12=CERTIFIED`, `V109=OK`, `V111=OK`. Change one temporary campaign action and confirm the certified snapshot remains unchanged. Restore `B2=Draft` and clear `V94:AJ101` so the delivered workbook begins un-certified and ready for the real campaign.

---

### Task 6: Integrate Campaign Results And Repair Congress/Council Formulas

**Files:**
- Modify: `All-Worker Congress!B4:B5`
- Modify: `All-Worker Congress!B35:R50`
- Verify: `Council!C4:C20`

**Interfaces:**
- Consumes: `Congress Campaign!B6`, `B5`, effective status `B12`, provisional seats `V82:AJ89`, and certified seats `V94:AJ101`.
- Produces: correct Congress party totals in row 45 and Council seats in row 49 / `Council!C4:C20`.

- [ ] **Step 1: Link election configuration**

Write:

```gs
'All-Worker Congress'!B4 ='Congress Campaign'!$B$6
'All-Worker Congress'!B5 ='Congress Campaign'!$B$5
```

- [ ] **Step 2: Replace Federation party seats with campaign output**

Write in `B35` and fill `B35:P42`:

```gs
=IF('Congress Campaign'!$B$12="CERTIFIED",'Congress Campaign'!V94,'Congress Campaign'!V82)
```

The relative references must advance across and down. Set `Q35:Q42` to literal zero and preserve row totals in `R35:R42`.

- [ ] **Step 3: Repair Congress party totals**

Replace hardcoded `B45:Q45` with column sums of `B35:Q42`; keep `R45=SUM(B45:Q45)`. Clear orphaned formulas/values from `B46:Q46`.

Expected with the current no-action baseline: `R45=27` and `B45=0` for Independent.

- [ ] **Step 4: Repair Council quotas and seats**

Keep `B48:P48` as Council-size quotas derived from row 45, set `Q48=0`, and enter in `B49`, filling through `P49`:

```gs
=LET(q,B48,base,INT(q),rem,MOD(q,1)+COLUMN()/10000000000,allq,$B$48:$P$48,allrem,ARRAYFORMULA(MOD(allq,1)+COLUMN($B$48:$P$48)/10000000000),leftover,ROUND(Council!$F$3-SUMPRODUCT(INT(allq)),0),IF(OR(B$44="",B$44="Independent",q<=0),0,base+IF(RANK(rem,allrem)<=leftover,1,0)))
```

Set `Q49=0`, `R49=SUM(B49:Q49)`, and clear orphaned `B50:Q50` formulas.

- [ ] **Step 5: Verify Council read-through**

Read `Council!C4:C20`. Existing formulas should now return the repaired `All-Worker Congress!B49:P49`, `0` for Non-aligned, and the configured total at `C20`.

Expected:

```text
Council!C4 = 0 for Independent
Council!C20 = Council!F3 = 15
No negative or fractional seats
```

- [ ] **Step 6: Re-read every repaired formula cell**

Use `get_spreadsheet_cells` on `All-Worker Congress!B4:B5`, `B35:R50`, and `Council!C4:C20`. Confirm labelled rows contain formulas, orphan rows 46 and 50 are empty, and no `#REF!`, `#N/A`, or `#VALUE!` appears.

---

### Task 7: Final Acceptance Verification And Handoff

**Files:**
- Verify: `Congress Campaign!A1:AN112`
- Verify: `All-Worker Congress!A1:R61`
- Verify: `Council!A1:F20`

**Interfaces:**
- Consumes: completed workbook workflow.
- Produces: evidence that every approved design acceptance criterion passes in the live backend.

- [ ] **Step 1: Run an approved one-favour test**

Use an unused ledger row with a unique `TEST-FINAL-1` ticket, an eligible party, `Proletariat`, `Industrial Production`, one favour, initials, reason, and approval.

Expected: validation `OK`; similarity, multipliers, calculated effect, and net effect are numeric; the targeted party's support rises in that Federation; row support remains 100 percent; seat totals remain balanced.

- [ ] **Step 2: Run a diminishing-return test**

Add a second otherwise identical action as `TEST-FINAL-2`.

Expected: prior favours `1`, diminishing multiplier `0.95`, and the second action's calculated effect is lower than the first.

- [ ] **Step 3: Run exclusion and override tests**

Expected throughout:

```text
Independent baseline support = 0 after renormalization
Independent provisional seats = 0
Independent override seats must be 0
Independent Council seats = 0
Invalid override blocks overall status
Valid override preserves its Federation total
```

- [ ] **Step 4: Run certification drift test**

Paste the current final provisional matrix as values into the certified snapshot and set status `Certified`. Record the certified values, change `TEST-FINAL-1` from one to two favours, and re-read certified values.

Expected: certified matrix byte-for-byte unchanged; `All-Worker Congress!B35:P42` continues to match certified values.

- [ ] **Step 5: Restore delivery state**

Clear both `TEST-FINAL-*` action inputs, clear test overrides and certified snapshot values, and set `B2=Draft`. Preserve all formulas, validation, guide content, and the illustrative guide example.

Expected final state:

```text
Action ledger empty
Override matrix empty
Certified snapshot empty
Campaign status Draft
Effective status Draft
Provisional baseline visible
Congress total 27 at current divisor
Council total 15
Independent seats 0 everywhere
Overall check OK
```

- [ ] **Step 6: Final readback report**

Report the spreadsheet link plus exact ranges changed, formula/input distinction, current Congress party totals, Council total, and the result of every acceptance check. If any check fails, leave the campaign in `Draft`, identify the exact failing cell/formula, and do not characterize the workflow as complete.
