import { runFight } from '@/systems/sim/combatSim';
import { createEnemyUnits, generatePlayerPositions } from '@/systems/combat/unitFactory';
import { enemyFormation } from '@/systems/combat/eliteKits';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { behindLineFloor, formationOf, lineFront } from '@/systems/combat/formation';
import { slash } from '@/data/skills/skillData';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { setDice } from '@/systems/combat/dice';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { createRNG } from '@/utils/rng';
import { hexDistance } from '@/utils/hexUtils';
import { AfflictionType, CombatUnit, HexCoord } from '@/models/types';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * PT-12: the Obsidian Legion fought back to front. Its Stalker (speed 15, move 4)
 * and Arcanist (speed 9) act before its Infantry (6) and Sentinel (4), and the
 * line spent its first turn on Shield Wall and Rune Dome with the party eight hexes
 * off — so the Stalker reached the party in round 3 and the Arcanist was in range in
 * round 2, while the Infantry first stood beside a hero in round 4 and 5.
 *
 * `EnemyTemplate.formation` now says who leads: the line marches until a foe is near,
 * the Stalker and the Arcanist spawn on the back rank and keep behind the line's
 * front until it engages. Measured with the same roster and seed after the change:
 * both Infantry reach the party in round 4, the Stalker in round 5, and the Arcanist
 * stands at range after the line.
 */

const ROSTER = ['obsidian_infantry', 'blood_thirster_stalker', 'obsidian_infantry', 'blood_iron_arcanist', 'runeguard_sentinel'];

const nearest = (pos: HexCoord, foes: CombatUnit[]) => Math.min(...foes.map((f) => hexDistance(pos, f.position)));

function party(): CombatUnit[] {
  return generatePlayerPositions(4).map((position, i) => makeUnit({
    id: `hero${i}`, isPlayer: true, heroId: `h${i}`, position, skills: [slash],
    // Unkillable and harmless: what is measured is how the Legion arrives
    stats: makeStats({ maxHp: 5000, attack: 1, defense: 50, speed: 8 }),
  }));
}

function march() {
  const positions = enemyFormation(ROSTER);
  if (!positions) throw new Error('the Legion should spawn in formation');
  const enemies = createEnemyUnits(ROSTER, positions, 10, 1);
  const contact = new Map<string, number>();
  const breaches: string[] = [];
  let heroTurns = 0;
  runFight(party(), enemies, {
    maxTurns: 90,
    quiet: true,
    policy: (unit, units) => {
      const heroes = units.filter((u) => u.isPlayer && u.currentHp > 0);
      if (unit.isPlayer) {
        heroTurns++;
        return [{ type: 'endturn' }];
      }
      const round = Math.floor(heroTurns / heroes.length) + 1;
      // Every Legion unit, every turn: before the line has engaged, nobody behind it
      // stands nearer the party than the line's front plus the gap
      for (const u of units.filter((x) => !x.isPlayer && x.currentHp > 0 && formationOf(x) === 'behind')) {
        const front = lineFront(u, units, heroes);
        if (front === null || front <= BALANCE.AI_LINE_ENGAGED_REACH) continue;
        if (nearest(u.position, heroes) < front + BALANCE.AI_BEHIND_LINE_GAP) {
          breaches.push(`r${round} ${u.name} at ${nearest(u.position, heroes)}, line at ${front}`);
        }
      }
      const key = `${unit.templateId}:${unit.id}`;
      if (nearest(unit.position, heroes) <= 1 && !contact.has(key)) contact.set(key, round);
      return null;
    },
  });
  const first = (templateId: string) => Math.min(
    ...[...contact].filter(([k]) => k.startsWith(`${templateId}:`)).map(([, r]) => r),
  );
  return { breaches, first };
}

describe('the Legion advances as a formation (PT-12)', () => {
  beforeEach(() => {
    const rng = createRNG(7);
    setDice(() => rng.next());
    setTempoRandom(() => rng.next());
  });
  afterEach(() => {
    setDice(null);
    setTempoRandom(null);
  });

  it('keeps the Stalker and the Arcanist behind the line until it engages', () => {
    expect(march().breaches).toEqual([]);
  });

  it('lets the line reach the party first, and the Stalker follow it in', () => {
    const { first } = march();
    const infantry = first('obsidian_infantry');
    const stalker = first('blood_thirster_stalker');
    expect(Number.isFinite(infantry)).toBe(true);
    expect(Number.isFinite(stalker)).toBe(true);
    expect(infantry).toBeLessThan(stalker);
  });
});

describe('formation spawn', () => {
  it('puts the Stalker and the Arcanist on the back rank, the line in front', () => {
    const spots = enemyFormation(ROSTER)!;
    const rows = ROSTER.map((id, i) => `${id}:${spots[i].r}`);
    expect(rows).toEqual([
      'obsidian_infantry:-3', 'blood_thirster_stalker:-4', 'obsidian_infantry:-3',
      'blood_iron_arcanist:-4', 'runeguard_sentinel:-3',
    ]);
  });

  it('leaves a warband with no formation to its own rows', () => {
    expect(enemyFormation(['bandit', 'footpad'])).toBeNull();
  });
});

describe('formation rules, one turn at a time', () => {
  const legion = (templateId: string, position: HexCoord) => {
    const [u] = createEnemyUnits([templateId], [position], 1, 1);
    return { ...u, id: templateId };
  };
  const hero = (position: HexCoord) => makeUnit({ id: 'hero', isPlayer: true, heroId: 'h', position, skills: [slash] });
  const start = (heroes: CombatUnit[], enemies: CombatUnit[]) => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat(heroes, enemies);
    return useCombatStore.getState().units;
  };
  const floorOf = (id: string, units: CombatUnit[]) =>
    behindLineFloor(units.find((u) => u.id === id)!, units, units.filter((u) => u.isPlayer));

  it('marches the line instead of locking shields with nobody near', () => {
    const units = start([hero(at(0, 4))], [legion('obsidian_infantry', at(0, -4)), legion('runeguard_sentinel', at(1, -4))]);
    for (const id of ['obsidian_infantry', 'runeguard_sentinel']) {
      const actions = decideEnemyAction(units.find((u) => u.id === id)!, units);
      expect({ id, first: actions[0].type }).toEqual({ id, first: 'move' });
    }
  });

  it('holds a Stalker behind a line that has not engaged', () => {
    const units = start([hero(at(0, 4))], [legion('obsidian_infantry', at(0, -2)), legion('blood_thirster_stalker', at(1, -4))]);
    // The Infantry is six hexes from the hero, so the Stalker (eight off) closes to seven and no nearer
    expect(floorOf('blood_thirster_stalker', units)).toBe(6 + BALANCE.AI_BEHIND_LINE_GAP);
    const stalker = { ...units.find((u) => u.id === 'blood_thirster_stalker')!, cooldowns: { melt_away: 9 } };
    const move = decideEnemyAction(stalker, units).find((a) => a.type === 'move');
    expect(move?.targetPos).toBeDefined();
    expect(hexDistance(move!.targetPos!, at(0, 4))).toBe(6 + BALANCE.AI_BEHIND_LINE_GAP);
  });

  it('releases the Stalker once the line has engaged', () => {
    const units = start([hero(at(0, 4))], [legion('obsidian_infantry', at(0, 3)), legion('blood_thirster_stalker', at(2, -2))]);
    expect(floorOf('blood_thirster_stalker', units)).toBeNull();
  });

  it('moves freely when its line is gone', () => {
    const units = start([hero(at(0, 4))], [legion('blood_thirster_stalker', at(0, -3))]);
    expect(floorOf('blood_thirster_stalker', units)).toBeNull();
  });

  it('answers a taunt whatever the formation says', () => {
    const taunter = hero(at(1, 3));
    const units = start([taunter], [legion('obsidian_infantry', at(0, -4)), legion('blood_thirster_stalker', at(1, -2))]);
    const live = units.find((u) => u.id === 'blood_thirster_stalker')!;
    const taunted = {
      ...live,
      cooldowns: { melt_away: 9 },
      activeEffects: [{ type: AfflictionType.Taunt, magnitude: 1, duration: 2, sourceUnitId: taunter.id }],
    };
    const move = decideEnemyAction(taunted, units).find((a) => a.type === 'move');
    expect(move?.targetPos).toBeDefined();
    // Past the line's front (seven hexes off), which the formation alone would forbid
    expect(hexDistance(move!.targetPos!, taunter.position)).toBeLessThan(7);
  });
});
