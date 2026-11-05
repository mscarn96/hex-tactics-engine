import { ArenaHazard, CombatUnit, HeroSkill, HexCoord, MasteryId, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { TROLL_PHASES, warrenCollapse } from '@/data/templates/trollChieftain';
import { arcHexes } from '@/systems/combat/arenaGeometry';
import type { AIAction } from '@/systems/combat/enemyAI';
import { createPreparedAttack } from '@/systems/combat/preparedAttacks';
import { collapseFootprint, isCoveredFrom, preyTarget } from '@/systems/combat/trollScript';
import { trollFort, trollStand } from '@/systems/sim/balance/trollAnswers';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { at, makeStats, makeUnit } from '../support/fixtures';
import { useInventoryStore } from '@/stores/inventoryStore';
import { createPlayerUnits, generatePlayerPositions } from '@/systems/combat/unitFactory';
import { defaultSpec } from '@/systems/sim/balance/encounters';
import { runBalanceFight } from '@/systems/sim/balance/fight';
import { PartyConstraints, RolledParty, rollParty } from '@/systems/sim/balance/partyRoll';
import { roleOf } from '@/systems/sim/balance/partyPolicy';
import { fightSeed, partyRng } from '@/systems/sim/balance/rng';
import { buildSimHero } from '@/systems/sim/simHarness';

/**
 * The simulator's party policy (`partyPolicy.ts`): what is pinned is the behaviour a sensible player
 * has — a hero knows what it is for, and the party answers the warning the fight is built around —
 * not the numbers a fight produces.
 */

function rolled(constraints: PartyConstraints, seed: number, id: 'dragon' | 'heart' = 'dragon'): RolledParty {
  return rollParty(defaultSpec(id), constraints, partyRng(seed));
}

function unitsOf(party: RolledParty) {
  useInventoryStore.getState().reset();
  const mint = useInventoryStore.getState().addItem;
  const heroes = party.heroes.map((config, i) => buildSimHero(config, mint, `policy_${i}`)!);
  return createPlayerUnits(heroes, generatePlayerPositions(heroes.length));
}

describe('what a hero is for', () => {
  it('reads a Taunt in the kit as a tank', () => {
    const party = rolled({ mustPath: 'bulwark' as MasteryId }, 1);
    const bulwark = unitsOf(party)[party.heroes.findIndex((h) => h.masteryPath === 'bulwark')];
    expect(roleOf(bulwark)).toBe('tank');
  });

  it('reads two support skills as a healer', () => {
    const party = rolled({ mustPath: 'lifewarden' as MasteryId }, 2);
    const healer = unitsOf(party)[party.heroes.findIndex((h) => h.masteryPath === 'lifewarden')];
    expect(roleOf(healer)).toBe('healer');
  });
});

describe('answering the Dragon', () => {
  const answered = (responds: boolean) => {
    let count = 0;
    for (let i = 0; i < 6; i++) {
      const seed = fightSeed(3, 0, i);
      const party = rolled({ mustPath: 'bulwark' as MasteryId }, seed);
      const transcript: string[] = [];
      runBalanceFight(defaultSpec('dragon'), party, seed, { responds, transcript });
      if (transcript.some((line) => /interrupts .*Skyfire/.test(line))) count++;
    }
    return count;
  };

  it('breaks Skyfire with the Taunt a Bulwark carries', () => {
    expect(answered(true)).toBeGreaterThanOrEqual(4);
  });

  it('is not what the plain brain does, which scores damage alone', () => {
    expect(answered(true)).toBeGreaterThan(answered(false));
  });
});

describe('tanks, shapes and shields', () => {
  const play = (path: string, id: 'dragon' | 'heart', seed: number) => {
    const party = rolled({ mustPath: path as MasteryId }, seed, id);
    const transcript: string[] = [];
    runBalanceFight(defaultSpec(id), party, seed, { responds: true, transcript });
    return transcript;
  };

  it('has a Wildshape hero take a shape before anything else it does', () => {
    for (let i = 0; i < 4; i++) {
      const lines = play('wildshape', 'heart', fightSeed(6, 0, i));
      expect(lines.some((l) => l.includes('takes a shape'))).toBe(true);
    }
  });

  it('walks a Bulwark up to the boss', () => {
    expect(play('bulwark', 'dragon', fightSeed(7, 0, 0)).some((l) => l.includes('closes on the boss'))).toBe(true);
  });

  it('reads a Beetle, which shields others and does not taunt, as a tank', () => {
    const party = rolled({ mustPath: 'beetle' as MasteryId }, 1);
    const beetle = unitsOf(party)[party.heroes.findIndex((h) => h.masteryPath === 'beetle')];
    expect(roleOf(beetle)).toBe('tank');
  });
});

describe('the transcript names the branch each hero turn took', () => {
  it('writes a line per policy turn and none for the plain party', () => {
    const seed = fightSeed(4, 0, 0);
    const party = rolled({}, seed);
    const withPolicy: string[] = [];
    const plain: string[] = [];
    runBalanceFight(defaultSpec('dragon'), party, seed, { responds: true, transcript: withPolicy });
    runBalanceFight(defaultSpec('dragon'), party, seed, { responds: false, transcript: plain });
    expect(withPolicy.some((l) => /^ {2}· (tank|healer|ranged|melee): /.test(l))).toBe(true);
    expect(plain.some((l) => l.includes('·'))).toBe(false);
  });
});

describe('the Dragon\'s other answers', () => {
  const lines = (() => {
    const out: string[] = [];
    for (let i = 0; i < 6; i++) {
      const seed = fightSeed(8, 0, i);
      const transcript: string[] = [];
      runBalanceFight(defaultSpec('dragon'), rolled({}, seed), seed, { responds: true, transcript });
      out.push(...transcript);
    }
    return out;
  })();

  it('walks into the fire at Skyfire when nobody can stop it: the trench, or the sprawl', () => {
    expect(lines.some((l) => l.includes('walks into Skyfire'))).toBe(true);
  });

  it('plays hot potato with the Furnace Heart: it is passed or taken, and its crystal struck', () => {
    expect(lines.some((l) => /(passes|takes) the Heart/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes('breaks the furnace_heart'))).toBe(true);
  });

  it('keeps the interrupt first: a party that can break Skyfire does not also walk into it', () => {
    const party = rolled({ mustPath: 'bulwark' as MasteryId }, fightSeed(3, 0, 0));
    const transcript: string[] = [];
    runBalanceFight(defaultSpec('dragon'), party, fightSeed(3, 0, 0), { responds: true, transcript });
    const broke = transcript.findIndex((l) => /interrupts .*Skyfire/.test(l));
    expect(broke).toBeGreaterThan(-1);
    // Between the cast and the break, no hero turn walked into the fire
    const cast = transcript.slice(0, broke).map((l, i) => [l, i] as const).filter(([l]) => /prepares Skyfire/.test(l)).pop();
    const between = transcript.slice(cast?.[1] ?? 0, broke);
    expect(between.some((l) => l.includes('walks into Skyfire'))).toBe(false);
  });
});

describe('answering the Heart of Winter', () => {
  const lines = (() => {
    const out: string[] = [];
    for (let i = 0; i < 4; i++) {
      const seed = fightSeed(9, 0, i);
      const transcript: string[] = [];
      runBalanceFight(defaultSpec('heart'), rolled({}, seed, 'heart'), seed, { responds: true, transcript });
      out.push(...transcript);
    }
    return out;
  })();

  it('stands a melee hero beside an anchor while Creeping Winter is up', () => {
    expect(lines.some((l) => l.includes('stands beside an anchor, sheltered from the ice'))).toBe(true);
  });

  it('puts a round into the anchor the chain strains against', () => {
    expect(lines.some((l) => l.includes('breaks the blood_iron_anchor the warning is tied to'))).toBe(true);
  });

  it('counts Creeping Winter in the tally with the sheltered and the stepped answers both in play', () => {
    const rows = lines.map((l) => /^tally creeping_winter: stepped (\d+), took (\d+), blocked \d+, unharmed (\d+)/.exec(l)).filter((m) => !!m);
    expect(rows.length).toBeGreaterThan(0);
    const sum = (i: number) => rows.reduce((total, m) => total + Number(m![i]), 0);
    expect(sum(1)).toBeGreaterThan(0);
    expect(sum(3)).toBeGreaterThan(0);
  });
});

// ─── The Troll's fort ────────────────────────────────────────────────────────

describe("playing the Troll's fort", () => {
  const swing: HeroSkill = {
    id: 'swing' as never, targetType: SkillTargetType.Single, range: 1, damage: 1, unlockLevel: 1, manaCost: 0,
  };
  const stats = (over = {}) => makeStats({ maxHp: 300, attack: 20, defense: 5, speed: 8, moveRange: 3, critChance: 0, dodgeChance: 0, ...over });
  const hero = (id: string, position: HexCoord, over: Partial<CombatUnit> = {}): CombatUnit =>
    makeUnit({ id, name: id, heroId: id, position, stats: stats(), skills: [swing], ...over });
  const troll = (step: number): CombatUnit =>
    makeUnit({
      id: 'boss', name: 'Troll', isPlayer: false, templateId: 'troll_chieftain', position: at(0, 0),
      stats: makeStats({ maxHp: 5000, attack: 60, defense: 5, speed: 5, moveRange: 2 }), skills: TROLL_PHASES[0].skills,
      bossScript: { step, phaseTurns: 3, unharmedRounds: 0 },
    });
  const fort = (...hexes: HexCoord[]): ArenaHazard[] =>
    [{ id: 'fort', hexes, solid: true, label: 'Rubble', lasts: 'replaced', kind: 'troll_rubble', ownerId: 'boss' }];
  const moveOf = (actions: AIAction[] | undefined) => actions?.find((a) => a.type === 'move')?.targetPos;

  it('baits the Prey with the sturdier hero: beside a heap, and farther from him than the partner', () => {
    const units = [troll(0), hero('tough', at(0, 2)), hero('frail', at(1, 1), { currentHp: 120 })];
    const hazards = fort(at(-1, 4));
    const played = trollFort(units[1], units, hazards, []);
    expect(played?.reason).toBe('baits the Prey onto rubble');
    const to = moveOf(played?.actions)!;
    expect(hexDistance(to, at(-1, 4))).toBeLessThanOrEqual(BALANCE.TROLL_PREY_RADIUS);
    // From there he hunts the bait, and the mark holds the heap
    const moved = units.map((u) => (u.id === 'tough' ? { ...u, position: to } : u));
    expect(preyTarget(units[0], moved)?.id).toBe('tough');
    // The frailer partner sets no bait
    expect(trollFort(units[2], units, hazards, [])?.reason).not.toBe('baits the Prey onto rubble');
  });

  it('takes cover behind a heap from a Sweep that would take a large share of a hero', () => {
    const units = [troll(1), hero('hurt', at(0, 1), { currentHp: 60 }), hero('other', at(-3, 3))];
    const hazards = fort(at(1, 0));
    const played = trollFort(units[1], units, hazards, []);
    expect(played?.reason).toBe('takes cover behind a heap');
    const to = moveOf(played?.actions)!;
    expect(isCoveredFrom(units[0], { ...units[1], position: to }, hazards)).toBe(true);
  });

  it('strikes him up close from the side away from the heaps the pair keeps', () => {
    const units = [troll(4), hero('brawler', at(1, 2)), hero('other', at(-3, 0))];
    // Heaps south-west of him: the nearest hexes to strike him from would draw the Sweep through them
    const hazards = fort(at(-1, 2), at(0, 2));
    const played = trollFort(units[1], units, hazards, []);
    expect(played?.reason).toBe('fights him from the side away from the heaps');
    const to = moveOf(played?.actions) ?? units[1].position;
    const sweep = TROLL_PHASES[0].skills.find((s) => s.id === 'bonebreaker_sweep')!;
    const arc = new Set(arcHexes(sweep, at(0, 0), to).map(hexKey));
    expect([at(-1, 2), at(0, 2)].some((h) => arc.has(hexKey(h)))).toBe(false);
    expect(hexDistance(to, at(0, 0))).toBe(1);
  });

  it("walks under a partner's roof when both survive the half, and the partner waits for it", () => {
    const boss = troll(4);
    const under = hero('under', at(2, 1));
    const partner = hero('partner', at(-1, 2));
    const units = [boss, under, partner];
    const roof = createPreparedAttack(boss, warrenCollapse, at(2, 1), collapseFootprint(at(2, 1)), units);
    const order = ['under', 'partner', 'boss'];
    expect(trollStand(under, units, [], [roof], order)?.reason).toBe('waits under the roof for the partner');
    const walked = trollStand(partner, units, [], [roof], order);
    expect(walked?.kind).toBe('move');
    const to = moveOf(walked?.kind === 'move' ? walked.actions : undefined)!;
    expect(roof.hexes.map(hexKey)).toContain(hexKey(to));
  });
});
