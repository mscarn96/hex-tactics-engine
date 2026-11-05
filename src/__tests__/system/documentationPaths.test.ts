import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../support/paths';

/** Keeps the pointers into `docs/` valid, from the source comments and between the pages. */

const DOCS_REF = /docs\/[A-Za-z0-9_./-]+\.md/g;
const MARKDOWN_LINK = /\[[^\]]+\]\(([^)#\s]+\.md)(?:#[^)]+)?\)/g;

function filesUnder(dir: string, extension: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(REPO_ROOT, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(REPO_ROOT, rel)).isDirectory()) filesUnder(rel, extension, out);
    else if (extension.test(entry)) out.push(rel);
  }
  return out;
}

const pages = () => ['README.md', ...filesUnder('docs', /\.md$/)];

describe('documentation paths', () => {
  it('finds the pages', () => {
    expect(pages().length).toBeGreaterThanOrEqual(5);
  });

  it('resolves relative Markdown links', () => {
    const missing = pages().flatMap((file) => {
      const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      return [...text.matchAll(MARKDOWN_LINK)]
        .map(([, target]) => target)
        .filter((target) => !existsSync(path.resolve(REPO_ROOT, path.dirname(file), target)))
        .map((target) => `${file} -> ${target}`);
    });
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it('names no file in docs/ that does not exist', () => {
    const offenders = filesUnder('src', /\.ts$/).flatMap((file) => {
      const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      return [...new Set(text.match(DOCS_REF) ?? [])]
        .filter((ref) => !existsSync(path.join(REPO_ROOT, ref)))
        .map((ref) => `${file} -> ${ref}`);
    });
    expect(offenders.sort()).toEqual([]);
  });
});
