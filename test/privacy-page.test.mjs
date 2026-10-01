import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { PAGES, buildAll, inline, markdownToHtml } from '../scripts/build-privacy.mjs';

// Vitest runs from the repository root (see package.json scripts).
const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

// Visible words of a Markdown source, with the markup the policy uses removed.
function markdownWords(markdown) {
  return markdown
    .replace(/^#{1,3} /gm, '')
    .replace(/^- /gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\\$/gm, '')
    .split(/\s+/)
    .filter(Boolean);
}

// Visible words of the rendered article.
function htmlWords(html) {
  const article = html.slice(html.indexOf('<article>') + 9, html.indexOf('</article>'));
  return article
    .replace(/<\/?(?:strong|em)>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .split(/\s+/)
    .filter(Boolean);
}

describe('privacy pages', () => {
  test('the committed pages are what the generator builds from legal/', () => {
    for (const { target, html } of buildAll()) expect(read(target)).toBe(html);
  });

  test('each page shows the app policy word for word', () => {
    for (const lang of Object.keys(PAGES)) {
      const markdown = read(PAGES[lang].source);
      expect(htmlWords(read(PAGES[lang].target))).toEqual(markdownWords(markdown));
    }
  });

  test('the pages carry the June 2026 version the mails refer to', () => {
    expect(read(PAGES.de.target)).toContain('<em>Stand: Juni 2026</em>');
    expect(read(PAGES.en.target)).toContain('<em>As of: June 2026</em>');
    expect(read(PAGES.de.target)).toContain('<html lang="de">');
    expect(read(PAGES.en.target)).toContain('<html lang="en">');
  });

  test('the converter escapes HTML and rejects Markdown it does not support', () => {
    expect(inline('a < b & **c** *d*')).toBe('a &lt; b &amp; <strong>c</strong> <em>d</em>');
    expect(() => inline('lonely * star')).toThrow('Unsupported emphasis');
    expect(() => markdownToHtml('1. numbered')).toThrow('Unsupported Markdown block');
    expect(() => markdownToHtml('# title\nmore')).toThrow('Heading with trailing lines');
    expect(() => markdownToHtml('ends with break\\')).toThrow('Line break at end of block');
    expect(markdownToHtml('one\ntwo')).toBe('<p>one two</p>');
  });
});
