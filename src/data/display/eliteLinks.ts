import { AfflictionType, AuraType, CombatUnit, HexCoord } from '@/models/types';
import { SEED_KIND, SOUL_FRAGMENT_KIND } from '@/systems/combat/eliteKits';

/**
 * The lines the arena draws between an elite and what its signature is tied to.
 *
 * Every one of them is a relationship the party has to read to play the fight and
 * could not otherwise see: which allies fight under the Captain's word, where each
 * soul fragment is running, which hero a briar seed feeds on, whom the Mage holds
 * and whom the Warchief has named. Positions are the units' own hexes, so a link
 * follows a body the moment it steps, and one that ends (a fall, a cleanse) is gone
 * on the next read. Pure and React-free, so the table is checkable in Node.
 */
export interface EliteLink {
  /** Which signature this belongs to, for the key and for tests. */
  kind: 'authority' | 'soul' | 'briar' | 'mind' | 'warband' | 'challenge' | 'duel';
  pairs: [HexCoord, HexCoord][];
  colour: string;
  width: number;
}

export const ELITE_LINK_STYLE: Readonly<Record<EliteLink['kind'], { colour: string; width: number }>> = {
  authority: { colour: '#e8b84a', width: 0.035 },
  soul: { colour: '#c8f0ff', width: 0.05 },
  briar: { colour: '#6a9a3a', width: 0.05 },
  mind: { colour: '#c24dff', width: 0.07 },
  warband: { colour: '#ff7a3c', width: 0.05 },
  // The Jarl to the hero he has named, and the two bound in his rune circle
  challenge: { colour: '#bfe6f5', width: 0.04 },
  duel: { colour: '#9fd8ff', width: 0.08 },
};

const alive = (u: CombatUnit): boolean => u.currentHp > 0;

export function eliteLinks(units: CombatUnit[]): EliteLink[] {
  const byId = new Map(units.map((u) => [u.id, u] as const));
  const out: Record<EliteLink['kind'], [HexCoord, HexCoord][]> = {
    authority: [], soul: [], briar: [], mind: [], warband: [], challenge: [], duel: [],
  };

  for (const u of units) {
    if (!alive(u)) continue;

    // Each ally under the Captain's word, to the Captain who gave it
    const word = u.activeEffects.find((e) => e.type === AuraType.Authority);
    const lead = word?.sourceUnitId ? byId.get(word.sourceUnitId) : undefined;
    if (lead && alive(lead)) out.authority.push([lead.position, u.position]);

    // A soul fragment, to the body it is racing to; a seed, to the hero it feeds on
    if (u.objective?.kind === SOUL_FRAGMENT_KIND) {
      const body = byId.get(u.objective.ownerId);
      if (body && alive(body)) out.soul.push([u.position, body.position]);
    }
    if (u.objective?.kind === SEED_KIND && u.objective.linkedUnitId) {
      const hero = byId.get(u.objective.linkedUnitId);
      if (hero && alive(hero)) out.briar.push([u.position, hero.position]);
    }

    // A hero the Mage holds, and a hero the Warchief has named
    const held = u.activeEffects.find((e) => e.type === AfflictionType.MindControl);
    const mage = held?.sourceUnitId ? byId.get(held.sourceUnitId) : undefined;
    if (mage && alive(mage)) out.mind.push([mage.position, u.position]);
    const named = u.activeEffects.find((e) => e.type === AfflictionType.Warband);
    const chief = named?.sourceUnitId ? byId.get(named.sourceUnitId) : undefined;
    if (chief && alive(chief)) out.warband.push([chief.position, u.position]);

    // A challenge awaiting its answer, drawn from the Jarl to the hero; and each duel once, by its Jarl
    const asked = u.challenge ? byId.get(u.challenge.jarlId) : undefined;
    if (asked && alive(asked)) out.challenge.push([asked.position, u.position]);
    const rival = u.duel ? byId.get(u.duel.partnerId) : undefined;
    if (rival && alive(rival) && u.id < rival.id) out.duel.push([u.position, rival.position]);
  }

  return (Object.keys(out) as EliteLink['kind'][])
    .filter((kind) => out[kind].length > 0)
    .map((kind) => ({ kind, pairs: out[kind], ...ELITE_LINK_STYLE[kind] }));
}
