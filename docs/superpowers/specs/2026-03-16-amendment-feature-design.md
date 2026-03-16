# Amendment Feature — Design Spec

## Goal

Add a complete amendment workflow that connects bills-as-amendments to document versioning with real structured diffs, auto-application on enactment, staff rollback capability, and a side-by-side redline view in the webapp.

## Context

The schema already has the fields needed (`bills.amendsBillId`, `documentVersions.amendmentBillId`, `'amended'` bill status) but no working workflow connects them. The diff endpoint returns raw text with no structured output. There is no amendment submission command, no auto-apply logic, and no redline UI.

---

## Design

### 1. Amendment Targets

Amendments can target:
- **Static documents** (constitution, worldbuilding docs in the `documents` table) — the amendment creates a new document version with the amended content
- **Other bills** (via `bills.amendsBillId`) — the amendment references which bill it modifies; if that bill is linked to a document, the document also gets a new version

### 2. Diff Engine

**Library:** `diff` npm package (installed in `@hansard/api`). Types ship with the package (v7+); no separate `@types/diff` needed.

**API output:** The existing `GET /api/documents/:slug/diff?from=1&to=3` endpoint is upgraded to return structured diff data:

```typescript
interface DiffHunk {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

interface DiffResult {
  from: { version: number; lineCount: number };
  to: { version: number; lineCount: number };
  hunks: DiffHunk[];       // word-level diff hunks
  stats: {
    additions: number;     // word count
    deletions: number;
    unchanged: number;
  };
}
```

Uses `diffWords()` from the `diff` library for word-level granularity, which produces the cleanest output for the side-by-side redline rendering.

### 3. Amendment Submission Flow

**Discord command:** `/bill amend <parent> <google_doc_url>`
- `<parent>` — bill number or document slug of the thing being amended
- **Resolution order:** try to parse as integer (bill number) first. If not an integer or no bill found with that number, try as a document slug. Return an error if neither matches.
- **Validation:** on submission, verify that the parent bill or document exists. Return an error if not found — don't create orphan amendments.
- Opens a modal for title, summary, tags (same as `/bill submit`)
- Creates a bill with `amendsBillId` set to the parent bill's ID (or, if amending a document directly, stores the document reference in a new `amendsDocumentId` field — see schema changes below)
- Posts notification in legislation channel: "📜 Amendment submitted: [title] amending [parent title]"

**Amendment content model:** The amendment bill's Google Doc contains the **complete replacement text** of the document being amended. Partial or diff-based amendment content is not supported — the full document text is replaced when the amendment is applied.

**API endpoint:** `POST /api/bills` already handles bill creation — extend it to accept `amendsBillId` and `amendsDocumentId` in the request body. Validate that the referenced parent exists before creating the bill.

The amendment bill then goes through the **normal legislative pipeline** (voting, NPC house, etc.) — no special treatment. It's just a bill that happens to amend something.

### 4. Auto-Apply on Enactment

When a bill with `amendsBillId` or `amendsDocumentId` transitions to `enacted` status:

1. **Identify the target document** — if `amendsDocumentId` is set, use that directly. If `amendsBillId` is set, look up whether the parent bill is linked to a document (via `bills.parentDocumentId` or `bills.collectionId`).
2. **Fetch the amendment bill's cached content** — this is the complete replacement text. If `cachedContent` is null, attempt to re-cache from the Google Doc first. If re-cache also fails, skip auto-apply and log a warning (the amendment bill is still enacted, it just doesn't auto-create a document version).
3. **Create a new document version** — call `updateDocument()` with the amendment content, linking `amendmentBillId` to this bill.
4. **Update the parent bill's status** to `amended` (if amending a bill). Any bill in `enacted`, `active`, or `amended` status can be amended — the `amended` status does not prevent further amendments.
5. **Log a `bill_status_log` entry** on the parent: "Amended by Bill #X".
6. **Post Discord notification** in the legislation channel: summary of what changed with a "View redline →" link to the webapp.

If the target document cannot be identified (e.g., amending a bill that isn't linked to any document), the auto-apply is skipped and a warning is logged. The amendment bill is still enacted — it just doesn't auto-create a document version.

### 5. Staff Rollback

**API endpoint:** `POST /api/documents/:slug/rollback`
- Accepts `{ toVersion: number }` — the version number to revert to
- Creates a **new** version (preserving full history) with the content from the target version
- The `editedById` for the rollback version is the authenticated staff member's player ID (from session)
- The new version's `changeDescription` is set to "Rollback to v{N}"
- Logs a `bill_status_log` entry if the rollback undoes an amendment
- Staff-only (requires `requireStaff` middleware)

**Webapp:** "Rollback" button appears on the document version history page next to each version. Clicking it opens a confirmation dialog, then calls the rollback endpoint.

**Discord:** No automatic notification for rollbacks — staff can manually announce if needed.

### 6. Discord Notifications

Summary-style embeds when an amendment is enacted:

```
📜 Amendment Applied

**Bill #017 — Executive Powers Amendment**
has been applied to **The Constitution** (now v4).

> Changed: appointment process (was "with consent of Parliament",
> now "at sole discretion")

View redline → [webapp link]
```

Embed colour: `#C4873B` (bills accent).

### 7. Webapp UI

#### BillDetail Page — Amendment Links

Add to the existing metadata section:
- **"Amends"** row: link to the parent bill/document (if this bill is an amendment)
- **"Amended by"** row: list of links to child amendment bills (if this bill has been amended)
- **"View Redline"** button: opens the diff view comparing the document version before and after this amendment was applied

#### Side-by-Side Redline Component

New shared component: `RedlineDiff.tsx`

Two columns:
- **Left ("Before")**: previous version text with word-level deletions shown as strikethrough in brick red (`#C25B4E`, 15% opacity background)
- **Right ("After")**: new version text with word-level additions highlighted in sage green (`#788C5D`, 15% opacity background)
- Column headers: version labels in `text-label` style (uppercase small Lora)
- Unchanged text rendered normally in both columns

Used on:
- BillDetail page (when viewing an amendment bill's effect)
- Document version history (comparing any two versions)
- The existing `/api/documents/:slug/diff` endpoint powers both

#### Document Page — Version History Enhancement

The existing version history list is enhanced:
- Versions created by amendments show a tag: "Amendment: Bill #X" with a link
- Each version row gets a "Compare" button that opens the redline diff against the previous version

---

## Schema Changes

### New field: `bills.amendsDocumentId`

```typescript
amendsDocumentId: uuid('amends_document_id'), // references documents.id — no FK to avoid circular imports
```

This allows a bill to directly amend a document (not just another bill). Stored as a plain UUID without FK constraint, same pattern as the existing circular reference fields.

### No other schema changes needed

All other fields already exist: `amendsBillId`, `amendmentBillId` on document versions, `'amended'` status.

---

## Files to Create/Modify

### New files:
- `packages/api/src/services/diffService.ts` — structured diff generation using `diff` library
- `packages/web/src/components/shared/RedlineDiff.tsx` — side-by-side redline component
- `packages/bot/src/commands/bills/amend.ts` — `/bill amend` command

### Modified files:
- `packages/db/src/schema/laws.ts` — add `amendsDocumentId` field to bills table
- `packages/shared/src/types/bills.ts` — add `amendsDocumentId: string | null` to `Bill` interface and `SubmitBillData`
- `packages/api/src/services/billService.ts` — extend enactment logic with auto-apply, update `toBill()` mapper for `amendsDocumentId`
- `packages/api/src/services/documentService.ts` — add rollback function
- `packages/api/src/routes/documents.ts` — upgrade diff endpoint, add rollback endpoint
- `packages/api/src/routes/bills.ts` — accept amendment fields in bill creation, validate parent exists
- `packages/web/src/pages/BillDetail.tsx` — add amendment links and "View Redline" button
- `packages/web/src/pages/Documents.tsx` — enhance version history with amendment tags and compare buttons
- `packages/web/src/api/hooks/useBills.ts` — add `amendsDocumentId` to bill types
- `packages/api/package.json` — add `diff` dependency
