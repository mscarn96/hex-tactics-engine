import * as fs from 'fs';
import * as path from 'path';
import * as shown from '@/systems/combat/displayNumbers';
import { BALANCE } from '@/data/balanceConstants';

const SRC = path.resolve(__dirname, '../..');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const keysRead = (dir: string, skip: string[] = []): Map<string, Set<string>> => {
  const keys = new Map<string, Set<string>>();
  for (const file of sources(dir)) {
    if (skip.some((s) => file.endsWith(s))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/BALANCE\.([A-Z0-9_]+)/g)) {
      if (!keys.has(m[1])) keys.set(m[1], new Set());
      keys.get(m[1])!.add(path.basename(file));
    }
  }
  return keys;
};

describe('numbers the display quotes', () => {
  it('no BALANCE key is read by both a combat rule and the display', () => {
    const rules = new Map([
      ...keysRead(path.join(SRC, 'systems')),
      ...keysRead(path.join(SRC, 'stores')),
    ]);
    const display = keysRead(path.join(SRC, 'data', 'display'));
    const both = [...display.keys()].filter((k) => rules.has(k));
    expect(both).toEqual([]);
  });

  it('every shown number answers with the value the rules read', () => {
    for (const [name, fn] of Object.entries(shown)) {
      const key = name.replace(/[A-Z0-9]/g, (c) => '_' + c).toUpperCase();
      expect((fn as () => unknown)()).toEqual((BALANCE as Record<string, unknown>)[key]);
    }
  });
});
