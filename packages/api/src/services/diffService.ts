import { diffWords } from 'diff';

// ============================================================
// Diff types
// ============================================================

export interface DiffHunk {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

export interface DiffResult {
  from: string;
  to: string;
  hunks: DiffHunk[];
  stats: {
    additions: number;
    deletions: number;
    unchanged: number;
  };
}

// ============================================================
// Compute a word-level diff between two content strings
// ============================================================

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function computeDiff(
  fromContent: string,
  toContent: string,
  fromVersion: string,
  toVersion: string,
): DiffResult {
  const changes = diffWords(fromContent, toContent);

  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  let unchanged = 0;

  for (const change of changes) {
    const words = countWords(change.value);

    if (change.added) {
      hunks.push({ type: 'added', value: change.value });
      additions += words;
    } else if (change.removed) {
      hunks.push({ type: 'removed', value: change.value });
      deletions += words;
    } else {
      hunks.push({ type: 'unchanged', value: change.value });
      unchanged += words;
    }
  }

  return {
    from: fromVersion,
    to: toVersion,
    hunks,
    stats: { additions, deletions, unchanged },
  };
}
