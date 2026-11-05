import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { templateName } from '@/data/templates/unitText';
import { entryText } from '@/i18n/dataText';
import { bossNamed } from '@/systems/combat/bossRegistry';

/**
 * The boss briefing (PT-41): the card shown before a boss fight's opening card,
 * and again whenever the player asks for it from the boss readout.
 *
 * It is a short list of plain points per boss, authored in the `bossBriefing`
 * namespace: each danger with how to avoid it, each opportunity with how to use
 * it. It does not restate the phase banners or passives; the fight shows those.
 * The point counts are each boss's own (`Boss.briefing` in `bossRegistry`); every
 * `tier: 'boss'` template needs an entry there, and `bossBriefing.test.ts` holds both
 * languages to it.
 */

/** Every boss in the game, by template id. */
export const BOSS_TEMPLATE_IDS: readonly string[] = enemyTemplates.filter((t) => t.tier === 'boss').map((t) => t.id);

/** One point: what the boss does (or offers) and what to do about it. */
export interface BriefingPoint {
  what: string;
  how: string;
}

export interface BossBriefing {
  bossId: string;
  name: string;
  /** The Seal tier it is fought at (1 in its own lair or story fight), and the twists that tier adds. */
  tier: number;
  twists: string[];
  dangers: BriefingPoint[];
  chances: BriefingPoint[];
}

/** The first boss among the fight's enemies, or undefined when none is a boss. */
export function briefedBossOf(units: readonly { templateId?: string; isPlayer: boolean }[]): string | undefined {
  return units.find((u) => !u.isPlayer && u.templateId !== undefined && BOSS_TEMPLATE_IDS.includes(u.templateId))?.templateId;
}

/** The Seal tier the fight's boss is fought at (`CombatUnit.challengeTier`), 1 when it has none. */
export function briefedTierOf(units: readonly { templateId?: string; isPlayer: boolean; challengeTier?: number }[]): number {
  const id = briefedBossOf(units);
  return units.find((u) => !u.isPlayer && u.templateId === id)?.challengeTier ?? 1;
}

/** The briefing's words, read now in the current language, at the Seal tier the boss is fought at. */
export function bossBriefing(bossId: string, tier = 1): BossBriefing {
  const boss = bossNamed(bossId);
  const { dangers = 0, chances = 0 } = boss?.briefing ?? {};
  const points = (count: number, what: string, how: string): BriefingPoint[] => Array.from({ length: count }, (_, i) => ({
    what: entryText('bossBriefing', bossId, `${what}${i + 1}`),
    how: entryText('bossBriefing', bossId, `${how}${i + 1}`),
  }));
  return {
    bossId,
    name: templateName(bossId),
    tier,
    twists: boss?.twists?.(tier) ?? [],
    dangers: points(dangers, 'danger', 'avoid'),
    chances: points(chances, 'chance', 'use'),
  };
}
