import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

function html(source: string) {
  const { container } = render(<div>{renderMarkdown(source)}</div>);
  return container.firstElementChild as HTMLElement;
}

describe('renderMarkdown', () => {
  it('renders headings, paragraphs and lists', () => {
    const root = html('# Article I\n\nThe Assembly shall sit.\n\n- one\n- two\n\n1. first\n2. second');
    expect(root.querySelector('h2')?.textContent).toBe('Article I');
    expect(root.querySelector('p')?.textContent).toBe('The Assembly shall sit.');
    expect(root.querySelectorAll('ul li')).toHaveLength(2);
    expect(root.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('renders inline emphasis and code', () => {
    const root = html('A **bold** and *quiet* `clause`.');
    expect(root.querySelector('strong')?.textContent).toBe('bold');
    expect(root.querySelector('em')?.textContent).toBe('quiet');
    expect(root.querySelector('code')?.textContent).toBe('clause');
  });

  it('only links http(s) URLs', () => {
    const root = html('[safe](https://example.org) and [evil](javascript:alert(1))');
    const links = root.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.org');
    expect(root.textContent).toContain('evil');
  });

  it('never interprets raw HTML', () => {
    const root = html('<img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<script>');
  });
});
