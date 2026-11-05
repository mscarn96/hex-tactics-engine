import { CombatUnit } from '@/models/types';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { FactionId, factionName, factionTagline, findFaction } from '@/data/templates/factions';
import { unitName } from '@/data/templates/unitText';

/**
 * Curated bosses introduce themselves even when their dungeon's guards have a faction.
 * A named place without a faction (a mixed quest fight) is announced by its name:
 * listing every body made the Supply Trail's banner a paragraph (playtest 2026-10-23b, PT-03).
 */
export function battleIntroIdentity(units: CombatUnit[], factionId?: FactionId, shapeName?: string, placeName?: string) {
  const hasBoss = units.some((u) => enemyTemplates.find((t) => t.id === u.templateId)?.tier === 'boss');
  const faction = factionId && !hasBoss ? findFaction(factionId) : undefined;
  if (faction) return {
    headline: shapeName ? `${factionName(faction.id)} — ${shapeName}` : factionName(faction.id),
    tagline: factionTagline(faction.id),
    factionId: faction.id,
  };
  if (placeName && !hasBoss) return { headline: placeName };
  const counts = new Map<string, number>();
  for (const unit of units) counts.set(unitName(unit), (counts.get(unitName(unit)) ?? 0) + 1);
  return { headline: [...counts].map(([name, count]) => count > 1 ? `${count} × ${name}` : name).join(', ') };
}
