# Amendment Feature Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete amendment workflow with structured diffs, auto-apply on enactment, staff rollback, and a side-by-side redline UI.

**Architecture:** Extends existing bill/document services. New `diffService` handles structured word-level diffs. Bill enactment hook auto-applies amendments to target documents. New `RedlineDiff` component renders side-by-side redline in webapp.

**Tech Stack:** `diff` npm package for word-level diffing. Existing Drizzle ORM, Fastify, React, discord.js stack.

**Spec:** `docs/superpowers/specs/2026-03-16-amendment-feature-design.md`

---

## Chunk 1: Diff Engine + Schema

### Task 1: Install diff library and create diffService

**Files:**
- Modify: `packages/api/package.json` — add `diff` dependency
- Create: `packages/api/src/services/diffService.ts`

- [ ] **Step 1: Install the diff package**

```bash
cd /tmp/hansard-export && pnpm --filter @hansard/api add diff
```

- [ ] **Step 2: Create diffService.ts**

```typescript
// packages/api/src/services/diffService.ts
import { diffWords } from 'diff';

export interface DiffHunk {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

export interface DiffResult {
  from: { version: number; lineCount: number };
  to: { version: number; lineCount: number };
  hunks: DiffHunk[];
  stats: {
    additions: number;
    deletions: number;
    unchanged: number;
  };
}

export function computeDiff(
  fromContent: string,
  toContent: string,
  fromVersion: number,
  toVersion: number,
): DiffResult {
  const changes = diffWords(fromContent, toContent);

  const hunks: DiffHunk[] = changes.map((change) => ({
    type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
    value: change.value,
  }));

  const stats = {
    additions: hunks.filter((h) => h.type === 'added').reduce((n, h) => n + h.value.split(/\s+/).length, 0),
    deletions: hunks.filter((h) => h.type === 'removed').reduce((n, h) => n + h.value.split(/\s+/).length, 0),
    unchanged: hunks.filter((h) => h.type === 'unchanged').reduce((n, h) => n + h.value.split(/\s+/).length, 0),
  };

  return {
    from: { version: fromVersion, lineCount: fromContent.split('\n').length },
    to: { version: toVersion, lineCount: toContent.split('\n').length },
    hunks,
    stats,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/package.json packages/api/src/services/diffService.ts
git commit -m "feat: add diff service with word-level structured diffing"
```

---

### Task 2: Add amendsDocumentId to schema and shared types

**Files:**
- Modify: `packages/db/src/schema/laws.ts` — add `amendsDocumentId` field
- Modify: `packages/shared/src/types/bills.ts` — add `amendsDocumentId` to `Bill` interface

- [ ] **Step 1: Add amendsDocumentId to bills table in laws.ts**

Add after the existing `amendsBillId` line (~line 83):

```typescript
amendsDocumentId: uuid('amends_document_id'), // references documents.id — no FK to avoid circular imports
```

- [ ] **Step 2: Add amendsDocumentId to Bill interface in shared types**

Add after `amendsBillId: string | null;` (~line 90 in `packages/shared/src/types/bills.ts`):

```typescript
amendsDocumentId: string | null;
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/laws.ts packages/shared/src/types/bills.ts
git commit -m "feat: add amendsDocumentId field to bills schema and types"
```

---

## Chunk 2: Backend — Amendment Submission + Auto-Apply + Rollback

### Task 3: Extend billService with amendment submission and auto-apply

**Files:**
- Modify: `packages/api/src/services/billService.ts` — add `amendsDocumentId` to `SubmitBillData`, `toBill()` mapper, and enactment auto-apply logic

- [ ] **Step 1: Add amendment fields to SubmitBillData**

Add to the `SubmitBillData` interface (~line 24):

```typescript
amendsBillId?: string;
amendsDocumentId?: string;
```

- [ ] **Step 2: Update toBill() mapper**

Add after `amendsBillId: row.amendsBillId,` (~line 118):

```typescript
amendsDocumentId: row.amendsDocumentId,
```

- [ ] **Step 3: Update submitBillFor() to pass amendment fields**

In the `db.insert(bills).values({...})` call, add:

```typescript
amendsBillId: data.amendsBillId ?? null,
amendsDocumentId: data.amendsDocumentId ?? null,
```

- [ ] **Step 4: Add auto-apply logic to enactBill()**

After setting status to `enacted`, add amendment auto-apply:

```typescript
// Auto-apply amendment to target document
if (bill.amendsBillId || bill.amendsDocumentId) {
  await applyAmendment(db, bill);
}
```

Create the `applyAmendment` helper function:

```typescript
async function applyAmendment(db: Database, bill: Bill): Promise<void> {
  // 1. Find target document
  let targetDocSlug: string | null = null;

  if (bill.amendsDocumentId) {
    const [doc] = await db.select({ slug: documents.slug })
      .from(documents).where(eq(documents.id, bill.amendsDocumentId)).limit(1);
    if (doc) targetDocSlug = doc.slug;
  } else if (bill.amendsBillId) {
    const [parentBill] = await db.select({ parentDocumentId: bills.parentDocumentId })
      .from(bills).where(eq(bills.id, bill.amendsBillId)).limit(1);
    if (parentBill?.parentDocumentId) {
      const [doc] = await db.select({ slug: documents.slug })
        .from(documents).where(eq(documents.id, parentBill.parentDocumentId)).limit(1);
      if (doc) targetDocSlug = doc.slug;
    }
  }

  if (!targetDocSlug) return; // No target document — skip silently

  // 2. Get amendment content (re-cache if needed)
  let content = bill.cachedContent;
  if (!content) {
    try {
      const docId = bill.googleDocId;
      if (docId) {
        const cached = await cacheDocContent(db, bill.id);
        content = cached;
      }
    } catch { /* skip auto-apply if cache fails */ }
  }
  if (!content) return;

  // 3. Apply to document
  const { updateDocument } = await import('./documentService.js');
  await updateDocument(db, targetDocSlug, content, bill.authorId, `Applied by ${bill.title}`, bill.id);

  // 4. Update parent bill status to 'amended' if applicable
  if (bill.amendsBillId) {
    await db.update(bills)
      .set({ status: 'amended', updatedAt: new Date() })
      .where(eq(bills.id, bill.amendsBillId));

    await db.insert(billStatusLog).values({
      billId: bill.amendsBillId,
      fromStatus: null,
      toStatus: 'amended',
      changedById: bill.authorId,
      notes: `Amended by Bill #${bill.billNumber} — ${bill.title}`,
    });
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/billService.ts
git commit -m "feat: add amendment submission and auto-apply on enactment"
```

---

### Task 4: Add rollback to documentService and upgrade diff endpoint

**Files:**
- Modify: `packages/api/src/services/documentService.ts` — add `rollbackDocument()` function
- Modify: `packages/api/src/routes/documents.ts` — upgrade diff endpoint with structured output, add rollback endpoint

- [ ] **Step 1: Add rollbackDocument() to documentService**

```typescript
export async function rollbackDocument(
  db: Database,
  slug: string,
  toVersion: number,
  editedById: string,
): Promise<Document | null> {
  const versions = await getVersionHistory(db, slug);
  const targetVersion = versions.find((v) => v.versionNumber === toVersion);
  if (!targetVersion) return null;

  return updateDocument(
    db,
    slug,
    targetVersion.content,
    editedById,
    `Rollback to v${toVersion}`,
  );
}
```

- [ ] **Step 2: Upgrade diff endpoint to use diffService**

Replace the existing diff route handler body (~line 190-200 in `packages/api/src/routes/documents.ts`) with:

```typescript
import { computeDiff } from '../services/diffService.js';

// ... inside the route handler, replace the return statement:
return computeDiff(
  fromVersion.content,
  toVersion.content,
  fromNum,
  toNum,
);
```

- [ ] **Step 3: Add rollback endpoint**

Add after the diff route:

```typescript
fastify.post<{
  Params: { slug: string };
  Body: { toVersion: number };
}>(
  '/api/documents/:slug/rollback',
  { preHandler: [requireAuth, requireStaff] },
  async (request, reply) => {
    const { rollbackDocument } = await import('../services/documentService.js');
    const result = await rollbackDocument(
      db,
      request.params.slug,
      request.body.toVersion,
      request.session.user!.id,
    );
    if (!result) {
      return reply.status(404).send({ error: 'Document or version not found' });
    }
    return result;
  },
);
```

- [ ] **Step 4: Add amendment validation to bill creation route**

In `packages/api/src/routes/bills.ts`, where `POST /api/bills` handles bill creation, add validation:

```typescript
// Validate amendment target exists
if (data.amendsBillId) {
  const [parent] = await db.select({ id: bills.id }).from(bills)
    .where(eq(bills.id, data.amendsBillId)).limit(1);
  if (!parent) return reply.status(404).send({ error: 'Parent bill not found' });
}
if (data.amendsDocumentId) {
  const [parent] = await db.select({ id: documents.id }).from(documents)
    .where(eq(documents.id, data.amendsDocumentId)).limit(1);
  if (!parent) return reply.status(404).send({ error: 'Target document not found' });
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/documentService.ts packages/api/src/routes/documents.ts packages/api/src/routes/bills.ts
git commit -m "feat: add rollback, structured diff, and amendment validation"
```

---

## Chunk 3: Discord Command + Webapp UI

### Task 5: Create /bill amend Discord command

**Files:**
- Create: `packages/bot/src/commands/bills/amend.ts`

- [ ] **Step 1: Create the amend command**

```typescript
// packages/bot/src/commands/bills/amend.ts
import { SlashCommandBuilder, ChatInputCommandInteraction, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, documents } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('bill-amend')
  .setDescription('Submit an amendment to an existing bill or document')
  .addStringOption((opt) =>
    opt.setName('parent').setDescription('Bill number or document slug to amend').setRequired(true))
  .addStringOption((opt) =>
    opt.setName('url').setDescription('Google Doc URL with amendment text').setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const parentInput = interaction.options.getString('parent', true);
  const url = interaction.options.getString('url', true);

  // Resolve parent: try bill number first, then document slug
  let amendsBillId: string | null = null;
  let amendsDocumentId: string | null = null;
  let parentTitle = '';

  const asNumber = parseInt(parentInput, 10);
  if (!isNaN(asNumber)) {
    const [bill] = await db.select().from(bills)
      .where(eq(bills.billNumber, asNumber)).limit(1);
    if (bill) {
      amendsBillId = bill.id;
      parentTitle = bill.title;
    }
  }

  if (!amendsBillId) {
    const [doc] = await db.select().from(documents)
      .where(eq(documents.slug, parentInput)).limit(1);
    if (doc) {
      amendsDocumentId = doc.id;
      parentTitle = doc.title;
    }
  }

  if (!amendsBillId && !amendsDocumentId) {
    return interaction.reply({
      embeds: [errorEmbed(`No bill or document found matching "${parentInput}".`)],
      ephemeral: true,
    });
  }

  // Open modal for title/summary
  const modal = new ModalBuilder()
    .setCustomId(`amend_bill:${amendsBillId ?? ''}:${amendsDocumentId ?? ''}:${url}`)
    .setTitle('Submit Amendment');

  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Amendment Title')
    .setPlaceholder(`Amendment to ${parentTitle}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const summaryInput = new TextInputBuilder()
    .setCustomId('summary')
    .setLabel('Summary of Changes')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(summaryInput),
  );

  await interaction.showModal(modal);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/bot/src/commands/bills/amend.ts
git commit -m "feat: add /bill-amend Discord command"
```

---

### Task 6: Create RedlineDiff webapp component

**Files:**
- Create: `packages/web/src/components/shared/RedlineDiff.tsx`

- [ ] **Step 1: Create the RedlineDiff component**

```tsx
// packages/web/src/components/shared/RedlineDiff.tsx
interface DiffHunk {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

interface RedlineDiffProps {
  hunks: DiffHunk[];
  fromLabel?: string;
  toLabel?: string;
}

export function RedlineDiff({ hunks, fromLabel = 'Before', toLabel = 'After' }: RedlineDiffProps) {
  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Before column */}
      <div>
        <div className="text-label-ui text-text-tertiary mb-3">{fromLabel}</div>
        <div className="font-body text-body leading-relaxed text-text-primary">
          {hunks.map((hunk, i) => {
            if (hunk.type === 'added') return null; // additions don't appear in "before"
            if (hunk.type === 'removed') {
              return (
                <span
                  key={i}
                  className="line-through"
                  style={{ background: 'rgba(194, 91, 78, 0.15)', color: '#C25B4E' }}
                >
                  {hunk.value}
                </span>
              );
            }
            return <span key={i}>{hunk.value}</span>;
          })}
        </div>
      </div>

      {/* After column */}
      <div>
        <div className="text-label-ui text-text-tertiary mb-3">{toLabel}</div>
        <div className="font-body text-body leading-relaxed text-text-primary">
          {hunks.map((hunk, i) => {
            if (hunk.type === 'removed') return null; // removals don't appear in "after"
            if (hunk.type === 'added') {
              return (
                <span
                  key={i}
                  className="font-medium"
                  style={{ background: 'rgba(120, 140, 93, 0.15)', color: '#788C5D' }}
                >
                  {hunk.value}
                </span>
              );
            }
            return <span key={i}>{hunk.value}</span>;
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/shared/RedlineDiff.tsx
git commit -m "feat: add RedlineDiff side-by-side redline component"
```

---

### Task 7: Add amendment links and redline to BillDetail page

**Files:**
- Modify: `packages/web/src/pages/BillDetail.tsx` — add amendment metadata links and View Redline button
- Modify: `packages/web/src/api/hooks/useBills.ts` — add `amendsDocumentId` to types

- [ ] **Step 1: Add amendsDocumentId to useBills hook types**

In the `Bill` interface in `useBills.ts`, add after `amendsBillId`:

```typescript
amendsDocumentId?: string | null;
```

- [ ] **Step 2: Add amendment metadata rows to BillDetail**

In the metadata section of BillDetail.tsx, add:

```tsx
{bill.amendsBillId && (
  <div className="flex gap-4 items-center">
    <span className="text-label-ui text-text-tertiary w-24">Amends</span>
    <Link to="/bills/$slug" params={{ slug: bill.amendsBillId }} className="text-accent-primary underline">
      {/* Parent bill title — fetch separately or include in bill response */}
      Parent Bill
    </Link>
  </div>
)}
{bill.amendsDocumentId && (
  <div className="flex gap-4 items-center">
    <span className="text-label-ui text-text-tertiary w-24">Amends Doc</span>
    <Link to="/documents" className="text-accent-primary underline">
      Target Document
    </Link>
  </div>
)}
```

- [ ] **Step 3: Add View Redline button that opens diff modal/section**

Add a "View Redline" button that fetches the diff and renders the `RedlineDiff` component in an expandable section below the metadata.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/BillDetail.tsx packages/web/src/api/hooks/useBills.ts
git commit -m "feat: add amendment links and redline view to BillDetail page"
```

---

### Task 8: Enhance Documents page with version history and rollback

**Files:**
- Modify: `packages/web/src/pages/Documents.tsx` — add version history with amendment tags, compare buttons, rollback

- [ ] **Step 1: Add version history section**

Add a collapsible "Version History" section to the document detail view showing:
- Version number, date, editor, change description
- If `amendmentBillId` is set: show "Amendment: Bill #X" tag with link
- "Compare" button that fetches diff and shows `RedlineDiff` inline
- "Rollback" button (staff only) with confirmation dialog

- [ ] **Step 2: Add rollback API call**

```typescript
async function rollbackToVersion(slug: string, version: number) {
  return api.post(`/documents/${slug}/rollback`, { toVersion: version });
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Documents.tsx
git commit -m "feat: add version history with amendment tags and rollback to Documents page"
```

---

### Task 9: Push to GitHub

- [ ] **Step 1: Push all commits**

```bash
cd /tmp/hansard-export && git push origin main
```

---

## Execution Notes

- **Working directory:** The clean Hansard repo is at `/tmp/hansard-export`. The source-of-truth files are in `C:\Users\skell\OneDrive\Coding\SCORP3 Bot\packages\`. Copy modified files to `/tmp/hansard-export/` before committing.
- **The `diff` package** ships its own types in v7+. No `@types/diff` needed.
- **Parent resolution** in the Discord command: try integer (bill number) first, then document slug. Error if neither matches.
- **Auto-apply** uses `updateDocument()` which already accepts `amendmentBillId`. The existing function signature is perfect.
- **The `rollbackDocument()` function** wraps `updateDocument()` — it's just a convenience that finds the target version's content and creates a new version with it.
