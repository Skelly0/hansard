import { Fragment, type ReactNode } from 'react';
import { isSafeHttpUrl } from './url';

/**
 * A deliberately small Markdown renderer for Hansard documents.
 *
 * Document bodies are user-authored, so this builds React elements directly —
 * never `dangerouslySetInnerHTML` — and only turns `[text](url)` into a link
 * when the URL is plain http(s). Supported: `#`–`####` headings, paragraphs,
 * `-`/`*`/`1.` lists, `>` quotes, `---` rules, fenced code, and inline
 * `**bold**`, `*italic*`, `` `code` ``. Anything else renders as text.
 */
export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isBlank = (line: string) => line.trim() === '';
  const listItem = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre key={key++} className="bg-inset rounded-card p-3 overflow-x-auto font-mono text-[0.8125rem] leading-relaxed">
          {body.join('\n')}
        </pre>,
      );
      continue;
    }

    // Heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = renderInline(heading[2].trim());
      const cls = [
        'font-display text-[1.5rem] font-semibold mt-6 mb-2 first:mt-0',
        'font-display text-[1.25rem] font-semibold mt-6 mb-2 first:mt-0',
        'font-display text-[1.075rem] font-semibold mt-5 mb-1.5 first:mt-0',
        'text-label-ui text-text-secondary mt-4 mb-1 first:mt-0',
      ][level - 1];
      const Tag = (['h2', 'h3', 'h4', 'h5'] as const)[level - 1];
      blocks.push(<Tag key={key++} className={`${cls} text-text-primary`}>{text}</Tag>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="rule" />);
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(
        <blockquote key={key++} className="border-l-2 border-accent-primary pl-4 italic text-text-secondary my-3">
          {renderInline(body.join(' '))}
        </blockquote>,
      );
      continue;
    }

    // List
    const firstItem = listItem.exec(line);
    if (firstItem) {
      const ordered = firstItem[1] !== undefined;
      const items: string[] = [];
      while (i < lines.length) {
        const m = listItem.exec(lines[i]);
        if (m && (m[1] !== undefined) === ordered) {
          items.push(m[2]);
          i++;
        } else if (!isBlank(lines[i]) && /^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += ` ${lines[i].trim()}`; // wrapped continuation
          i++;
        } else {
          break;
        }
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={key++} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-6 my-3 space-y-1 marker:text-text-tertiary`}>
          {items.map((item, idx) => <li key={idx}>{renderInline(item)}</li>)}
        </ListTag>,
      );
      continue;
    }

    // Paragraph: gather until a blank line or another block starts.
    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*(?:```|>)/.test(lines[i]) &&
      !listItem.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={key++} className="my-3 first:mt-0">
        {para.map((p, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(p)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key++} className="font-semibold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      out.push(<code key={key++} className="font-mono text-[0.85em] bg-inset rounded px-1">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const href = link?.[2];
      out.push(
        href && isSafeHttpUrl(href) ? (
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="text-accent-primary underline underline-offset-2">
            {label}
          </a>
        ) : (
          <Fragment key={key++}>{label}</Fragment>
        ),
      );
    } else {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
