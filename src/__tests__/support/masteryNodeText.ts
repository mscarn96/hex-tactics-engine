import { hasMessage, t, type MessageKey } from '@/i18n';

/** The five class namespaces a mastery node's or path's words can live in. */
const NAMESPACES = ['masteryChampion', 'masteryArcanist', 'masteryHunter', 'masteryDruid', 'masteryMonk'];

/**
 * A mastery node's (or path's) words for a test, from its class's catalog
 * (`<ns>.node.<id>.<field>`), or the field the object still carries while the
 * other classes' trees are being moved.
 */
export function masteryText(
  kind: 'node' | 'path',
  entry: { id: string },
  field: 'name' | 'description' | 'requiresLabel',
): string {
  for (const ns of NAMESPACES) {
    const key = `${ns}.${kind}.${entry.id}.${field}`;
    if (hasMessage(key)) return t(key as MessageKey);
  }
  const carried = (entry as Record<string, unknown>)[kind === 'path' && field === 'description' ? 'tagline' : field];
  return typeof carried === 'string' ? carried : '';
}

export const nodeName = (node: { id: string; name?: string }) => masteryText('node', node, 'name');
export const nodeDescription = (node: { id: string; description?: string }) => masteryText('node', node, 'description');
