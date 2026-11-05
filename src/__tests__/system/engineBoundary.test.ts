import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, SRC_DIR } from '../support/paths';

/** Keeps the engine an engine: plain Node, no media, and one runtime dependency. */

const MEDIA = /\.(png|jpe?g|webp|gif|svg|mp3|wav|ogg|m4a|aac|ttf|otf|woff2?|glb|gltf|fbx|mp4|mov)$/i;
const APP_PACKAGE = /(?:from\s+|require\(\s*|import\(\s*)['"](react|react-dom|react-native(?:\/[^'"]*)?|three(?:\/[^'"]*)?|@react-three\/[^'"]+|expo(?:-[^'"]*)?)['"]/;
const SKIPPED = new Set(['node_modules', '.git', 'coverage']);

function allFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) allFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe('the engine boundary', () => {
  it('finds files to check', () => {
    expect(allFiles(SRC_DIR).length).toBeGreaterThan(100);
  });

  it('holds no media files', () => {
    expect(allFiles(REPO_ROOT).filter((file) => MEDIA.test(file))).toEqual([]);
  });

  it('has zustand as its only runtime dependency', () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(manifest.dependencies)).toEqual(['zustand']);
  });

  it('imports no UI or app package', () => {
    const offenders = allFiles(SRC_DIR)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('engineBoundary.test.ts'))
      .filter((file) => APP_PACKAGE.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
