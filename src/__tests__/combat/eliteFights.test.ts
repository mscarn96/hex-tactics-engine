import { CombatUnit } from '@/models/types';
import { arcaneBolt, heal, rangedShot, slash } from '@/data/skills/skillData';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { enemyFormation, wearsAuthority } from '@/systems/combat/eliteKits';
import { isEncased, TOMB_KIND } from '@/systems/combat/factionEliteKits';
import { hexDistance } from '@/utils/hexUtils';
import { combatMaxHp } from '@/systems/combat/forms';
import { runFight } from '@/systems/sim/combatSim';
import { hexKey } from '@/utils/hexUtils';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * Every elite, fought to the end by the same brain the app drives, against a party of
 * four. Not a balance claim — the numbers are the plan's open tuning questions — but the
 * guarantee underneath every one of them: each fight resolves (no soft-lock, no turn the
 * mechanic swallows), nobody ever shares a hex, nobody exceeds their maximum, a borrowed
 * hero is always handed back, and a Captain's word never outlives him.
 */

const party = (): CombatUnit[] => [
  makeUnit({
    id: 'tank', heroId: 'tank', name: 'tank', position: at(-1, 3),
    stats: makeStats({ maxHp: 420, attack: 20, defense: 14, magic: 5, speed: 8, moveRange: 3, critChance: 0, dodgeChance: 0 }),
    skills: [slash],
  }),
  makeUnit({
    id: 'blade', heroId: 'blade', name: 'blade', position: at(0, 3),
    stats: makeStats({ maxHp: 300, attack: 30, defense: 8, magic: 5, speed: 11, moveRange: 4, critChance: 0, dodgeChance: 0 }),
    skills: [slash],
  }),
  makeUnit({
    id: 'bow', heroId: 'bow', name: 'bow', position: at(1, 3),
    stats: makeStats({ maxHp: 240, attack: 28, defense: 5, magic: 5, speed: 10, moveRange: 3, critChance: 0, dodgeChance: 0 }),
    skills: [rangedShot],
  }),
  makeUnit({
    id: 'mage', heroId: 'mage', name: 'mage', position: at(2, 3),
    stats: makeStats({ maxHp: 220, attack: 5, defense: 4, magic: 30, speed: 9, moveRange: 3, maxMana: 120, critChance: 0, dodgeChance: 0 }),
    skills: [arcaneBolt, heal],
  }),
];

const ELITES: { name: string; roster: string[] }[] = [
  { name: 'Cave Bear', roster: ['cave_bear'] },
  { name: 'Dark Mage', roster: ['dark_mage'] },
  { name: 'Bog Hulk', roster: ['bog_hulk'] },
  { name: 'Orc Berserker', roster: ['orc_berserker', 'orc_grunt'] },
  { name: 'Orc Warchief', roster: ['orc_warchief'] },
  { name: 'Revenant', roster: ['revenant', 'skeleton_warrior'] },
  { name: 'Coven Matriarch', roster: ['coven_matriarch', 'hexer'] },
  { name: 'Ashwood Crone', roster: ['ashwood_crone'] },
  { name: 'Delve Overseer', roster: ['delve_overseer', 'delve_pickhand'] },
  { name: 'Brigand Captain', roster: ['brigand_captain', 'bandit', 'brigand_archer'] },
  // The four new-faction elites
  { name: 'Burrowmother', roster: ['burrowmother', 'scorpid_brute'] },
  { name: 'Herd-Khan', roster: ['herd_khan', 'colt_runner'] },
  { name: 'Rime Jarl', roster: ['rime_jarl', 'hold_thrall'] },
  { name: 'Glacier Colossus', roster: ['glacier_colossus', 'frost_mote'] },
];

/** What must be true after every turn of every fight. */
function invariants(): string[] {
  const broken: string[] = [];
  const units = useCombatStore.getState().units;
  const living = units.filter((u) => u.currentHp > 0);
  // A sealed hero shares its hex with the block that holds them, by design
  const hexes = living.filter((u) => !isEncased(u)).map((u) => hexKey(u.position));
  if (new Set(hexes).size !== hexes.length) broken.push('two living units share a hex');
  // Every sealed hero has a standing block, and every standing block a sealed hero
  const tombs = living.filter((u) => u.objective?.kind === TOMB_KIND);
  for (const hero of living.filter(isEncased)) {
    if (!tombs.some((t) => t.objective?.linkedUnitId === hero.id)) broken.push(`${hero.name} is sealed in nothing`);
  }
  for (const tomb of tombs) {
    const held = living.find((u) => u.id === tomb.objective?.linkedUnitId);
    if (!held || !isEncased(held)) broken.push('a tomb holds nobody');
  }
  // A duel is two living bodies bound to each other, both inside the circle
  for (const u of living.filter((x) => x.duel)) {
    const partner = living.find((p) => p.id === u.duel!.partnerId);
    if (!partner?.duel || partner.duel.partnerId !== u.id) broken.push(`${u.name} is bound to a duelist who is not bound back`);
    if (hexDistance(u.duel!.centre, u.position) > u.duel!.radius) broken.push(`${u.name} has left the rune circle`);
  }
  for (const u of living) {
    if (u.currentHp > combatMaxHp(u)) broken.push(`${u.name} is above its maximum`);
    if (u.seized && u.isPlayer) broken.push(`${u.name} is seized and still on its own side`);
    if (hasAuthority(u) !== wearsAuthority(u, units)) broken.push(`${u.name} wears the wrong Authority`);
    if (getCombatEffectiveStats(u).speed < 1) broken.push(`${u.name} has no speed`);
  }
  return broken;
}

const hasAuthority = (u: CombatUnit) => u.activeEffects.some((e) => e.type === 'authority');

describe('every elite fought to the end', () => {
  for (const elite of ELITES) {
    it(`${elite.name}: the fight resolves and the rules hold on every turn`, () => {
      const violations = new Set<string>();
      for (let run = 0; run < 3; run++) {
        const spots = enemyFormation(elite.roster) ?? elite.roster.map((_, i) => at(i - 1, -3));
        const enemies = createEnemyUnits(elite.roster, spots, 5, 1.6);
        const result = runFight(party(), enemies, {
          quiet: true,
          maxTurns: 500,
          policy: () => {
            for (const v of invariants()) violations.add(v);
            return null;
          },
        });
        expect(result.outcome).not.toBe('draw');
        // Whoever stands at the end has been handed back to its own side
        for (const u of useCombatStore.getState().units) expect(u.seized ?? false).toBe(false);
      }
      expect([...violations]).toEqual([]);
    });
  }
});
