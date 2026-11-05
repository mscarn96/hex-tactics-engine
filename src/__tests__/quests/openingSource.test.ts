import { readdirSync, readFileSync, statSync } from 'node:fs';
import path, { join, relative } from 'node:path';
import { SRC_DIR } from '../support/paths';

/**
 * An opening — `cityStore.recruitsEarned` — is the recruitment curve, and the
 * quests are the only thing that may move it. A quest *site* on the map used to
 * grant one too (`questEarnsRecruit`), stacking three more places on the three
 * the curve pays on purpose.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('where openings come from', () => {
  it('is granted by quest completion and nowhere else', () => {
    const callers = sourceFiles(SRC_DIR)
      .filter((file) => /\bearnRecruit\(\)/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC_DIR, file).split(path.sep).join('/'))
      .filter((file) => file !== 'stores/cityStore.ts')
      .sort();
    expect(callers).toEqual(['systems/quests/questEvents.ts']);
  });

  it('keeps the combat victory payout free of a recruit reward', () => {
    const rewards = readFileSync(join(SRC_DIR, 'systems/combat/combatRewards.ts'), 'utf8');
    expect(rewards).not.toMatch(/recruit/i);
  });
});
