import { AfflictionType, CombatUnit, HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { arcaneBolt, heal, rangedShot, slash } from '@/data/skills/skillData';
import { greatGale, kanaboBlow, oniCrush, warlordsDoom } from '@/data/skills/draconicHostSkills';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { previewPrepared, statusInterrupts } from '@/systems/combat/preparedAttacks';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { SILENT_SINK } from '@/systems/combat/skillResolution';
import { hasEffect } from '@/systems/combat/statusEffects';
import { warningLines } from '@/data/display/preparedDisplay';
import { enemyFormation } from '@/systems/combat/eliteKits';
import { runFight } from '@/systems/sim/combatSim';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Draconic Host's two elites, pinned as rules (the private project notes):
 * the Oni Warlord's telegraphed Doom and his two-handed sweep, the Daitengu's wind in an arc
 * that pushes and its Silence, and the Brute's shove. Each signature is a warning the party
 * can read and answer — leave the footprint, or Stun, Silence or Freeze the caster — and each
 * elite is fought to the end without the rules breaking.
 */

const swing = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 8 });

const hero = (id: string, position = at(0, 2)) =>
  makeUnit({
    id, heroId: id, name: id, position,
    stats: makeStats({ maxHp: 4000, attack: 30, defense: 0, speed: 5, critChance: 0, dodgeChance: 0, maxMana: 50 }),
    skills: [swing],
  });

const units = () => useCombatStore.getState().units;
const find = (id: string) => units().find((u) => u.id === id)!;
const byTemplate = (t: string): CombatUnit => units().find((u) => u.templateId === t)!;
const prepared = () => useCombatStore.getState().preparedAttacks;

function start(template: string, spot: ReturnType<typeof at>, heroes: CombatUnit[]) {
  const store = useCombatStore.getState();
  store.reset();
  const [elite] = createEnemyUnits([template], [spot], 1, 1);
  store.initCombat(heroes, [elite]);
}

/** One turn of the elite through the real AI, a skill forced when `only` names one. */
function eliteTurn(template: string, only?: string) {
  const unit = byTemplate(template);
  useCombatStore.getState().beginTurnFlags(unit.id);
  const view = only ? { ...unit, skills: unit.skills.filter((s) => s.id === only) } : unit;
  const actions = decideEnemyAction(view, units());
  executeAIActions(unit, actions);
  return actions;
}

/** Every responder has had their turn: whatever is open lands from its caster's turn. */
function land(template: string) {
  const store = useCombatStore.getState();
  for (const p of prepared()) store.updatePreparedAttack(p.id, { responded: p.responders });
  resolveDuePrepared(byTemplate(template).id, SILENT_SINK);
}

// ── Oni Warlord ──────────────────────────────────────────────────────────────

describe("Oni Warlord: Warlord's Doom", () => {
  const WARLORD = at(0, -2);

  it('is chosen over his at-will and announced as a circle round a hero, dealing nothing yet', () => {
    start('oni_warlord', WARLORD, [hero('a', at(0, 1)), hero('b', at(1, 1))]);
    const actions = eliteTurn('oni_warlord');
    expect(actions.some((a) => a.type === 'skill' && a.skill?.id === 'warlords_doom')).toBe(true);
    expect(prepared()).toHaveLength(1);
    const warning = prepared()[0];
    expect(warning.skill.id).toBe('warlords_doom');
    // The circle has the authored radius round its aim, and both heroes owe a turn
    expect(warning.hexes.every((h) => hexDistance(h, warning.aim) <= BALANCE.DRACONIC_HOST.DOOM_RADIUS)).toBe(true);
    expect([...warning.responders].sort()).toEqual(['a', 'b']);
    expect(hasEffect(find('a'), AfflictionType.Doom)).toBe(false);
    expect(find('a').currentHp).toBe(find('a').stats.maxHp);
    expect(byTemplate('oni_warlord').cooldowns?.warlords_doom).toBeGreaterThan(0);
  });

  it('Dooms whoever stays on the mark, and nobody who stepped off', () => {
    start('oni_warlord', WARLORD, [hero('a', at(0, 1)), hero('b', at(1, 1))]);
    eliteTurn('oni_warlord', 'warlords_doom');
    const footprint = new Set(prepared()[0].hexes.map(hexKey));
    const away = [at(-3, 4), at(3, 3), at(-4, 2)].find((h) => !footprint.has(hexKey(h)))!;
    useCombatStore.getState().moveUnit('b', away);
    land('oni_warlord');
    const doom = find('a').activeEffects.find((e) => e.type === AfflictionType.Doom);
    expect(doom).toBeDefined();
    // One turn to answer, and a payload worth answering: a multiple of his Attack
    expect(doom!.duration).toBe(BALANCE.DRACONIC_HOST.DOOM_TURNS);
    expect(doom!.magnitude).toBeGreaterThan(byTemplate('oni_warlord').stats.attack * 1.5);
    expect(hasEffect(find('b'), AfflictionType.Doom)).toBe(false);
  });

  it('is broken by a Stun, Silence or Freeze on him before it lands', () => {
    start('oni_warlord', WARLORD, [hero('a', at(0, 1))]);
    eliteTurn('oni_warlord', 'warlords_doom');
    for (const type of [AfflictionType.Stun, AfflictionType.Silence, AfflictionType.Freeze]) {
      expect(statusInterrupts(prepared()[0], type)).toBe(true);
    }
    expect(statusInterrupts(prepared()[0], AfflictionType.Root)).toBe(false);
  });

  it('never brands a circle in which every hero is already Doomed', () => {
    start('oni_warlord', WARLORD, [hero('a', at(0, 1))]);
    useCombatStore.getState().applyEffect('a', {
      type: AfflictionType.Doom, magnitude: 10, duration: 3, sourceUnitId: byTemplate('oni_warlord').id,
    });
    const actions = eliteTurn('oni_warlord');
    expect(actions.some((a) => a.skill?.id === 'warlords_doom')).toBe(false);
  });

  it('tells the party on the banner what it does and how to answer it', () => {
    start('oni_warlord', WARLORD, [hero('a', at(0, 1))]);
    eliteTurn('oni_warlord', 'warlords_doom');
    const [line] = warningLines(prepared(), prepared().map((p) => previewPrepared(p, units())), units());
    expect(line.title).toBe("Oni Warlord: Warlord's Doom");
    expect(line.detail).toMatch(/Doomed/);
    expect(line.detail).toMatch(/leave the mark/);
    expect(line.detail).toMatch(/Stun, Silence or Freeze/);
  });

  it('sweeps a deep wedge with both hands, on a rest so it is not his at-will', () => {
    start('oni_warlord', WARLORD, [hero('a', at(0, -1)), hero('b', at(1, -2)), hero('c', at(-1, -1))]);
    // Doom resting, three heroes in front of him: the sweep is the better blow
    const warlord = byTemplate('oni_warlord');
    useCombatStore.getState().startCooldown(warlord.id, warlordsDoom);
    const before = ['a', 'b', 'c'].map((id) => find(id).currentHp);
    eliteTurn('oni_warlord');
    const struck = ['a', 'b', 'c'].filter((id, i) => find(id).currentHp < before[i]);
    expect(struck.length).toBeGreaterThanOrEqual(2);
    expect(byTemplate('oni_warlord').cooldowns?.two_handed_sweep).toBeGreaterThan(0);
  });
});

// ── Daitengu ─────────────────────────────────────────────────────────────────

describe('Daitengu: Great Gale and Hush of the Peaks', () => {
  const DAITENGU = at(0, -2);

  it('announces a wedge over the heroes and pushes nobody yet', () => {
    start('daitengu', DAITENGU, [hero('a', at(0, 0)), hero('b', at(1, -1))]);
    const actions = eliteTurn('daitengu');
    expect(actions.some((a) => a.skill?.id === 'great_gale')).toBe(true);
    const warning = prepared()[0];
    expect(warning.skill.id).toBe('great_gale');
    expect(warning.responders.length).toBeGreaterThanOrEqual(1);
    expect(find('a').position).toEqual(at(0, 0));
    // The board is told where the wind will put each body
    const preview = previewPrepared(prepared()[0], units());
    expect(preview.landings.some((m) => m.moved)).toBe(true);
  });

  it('lands as damage and a shove of GALE_PUSH hexes away from where he stood', () => {
    start('daitengu', DAITENGU, [hero('a', at(0, 0))]);
    eliteTurn('daitengu', 'great_gale');
    const origin = prepared()[0].origin;
    const before = hexDistance(origin, find('a').position);
    land('daitengu');
    expect(find('a').currentHp).toBeLessThan(find('a').stats.maxHp);
    expect(hexDistance(origin, find('a').position)).toBe(before + BALANCE.DRACONIC_HOST.GALE_PUSH);
  });

  it('is broken by a Stun, Silence or Freeze on him', () => {
    start('daitengu', DAITENGU, [hero('a', at(0, 0))]);
    eliteTurn('daitengu', 'great_gale');
    for (const type of [AfflictionType.Stun, AfflictionType.Silence, AfflictionType.Freeze]) {
      expect(statusInterrupts(prepared()[0], type)).toBe(true);
    }
    const [line] = warningLines(prepared(), prepared().map((p) => previewPrepared(p, units())), units());
    expect(line.detail).toMatch(/blows everyone in the wedge back/);
  });

  it('Silences with Hush of the Peaks while the Gale rests', () => {
    start('daitengu', DAITENGU, [hero('a', at(0, 1))]);
    useCombatStore.getState().startCooldown(byTemplate('daitengu').id, greatGale);
    eliteTurn('daitengu');
    expect(hasEffect(find('a'), AfflictionType.Silence)).toBe(true);
  });
});

// ── Oni Brute ────────────────────────────────────────────────────────────────

describe('Oni Brute: every blow shoves', () => {
  it('pushes with its at-will, and drives two hexes with the crush', () => {
    expect(kanaboBlow.pushDistance).toBe(1);
    expect(oniCrush.pushDistance).toBe(2);
    start('oni_brute', at(0, -1), [hero('a', at(0, 0))]);
    const from = byTemplate('oni_brute').position;
    eliteTurn('oni_brute', 'oni_crush');
    expect(hexDistance(from, find('a').position)).toBe(3);
  });
});

// ── fought to the end ────────────────────────────────────────────────────────

describe('the Host elites fought to the end', () => {
  const party = (): CombatUnit[] => [
    makeUnit({ id: 'tank', heroId: 'tank', name: 'tank', position: at(-1, 3),
      stats: makeStats({ maxHp: 420, attack: 20, defense: 14, magic: 5, speed: 8, moveRange: 3, critChance: 0, dodgeChance: 0 }), skills: [slash] }),
    makeUnit({ id: 'blade', heroId: 'blade', name: 'blade', position: at(0, 3),
      stats: makeStats({ maxHp: 300, attack: 30, defense: 8, magic: 5, speed: 11, moveRange: 4, critChance: 0, dodgeChance: 0 }), skills: [slash] }),
    makeUnit({ id: 'bow', heroId: 'bow', name: 'bow', position: at(1, 3),
      stats: makeStats({ maxHp: 240, attack: 28, defense: 5, magic: 5, speed: 10, moveRange: 3, critChance: 0, dodgeChance: 0 }), skills: [rangedShot] }),
    makeUnit({ id: 'mage', heroId: 'mage', name: 'mage', position: at(2, 3),
      stats: makeStats({ maxHp: 220, attack: 5, defense: 4, magic: 30, speed: 9, moveRange: 3, maxMana: 120, critChance: 0, dodgeChance: 0 }), skills: [arcaneBolt, heal] }),
  ];

  for (const roster of [['oni_warlord', 'oni_brute'], ['daitengu', 'oni_brute'], ['oni_brute', 'wyrmling', 'karasu_tengu', 'raiju']]) {
    it(`${roster.join(' + ')}: resolves, nobody shares a hex, and the signatures are used`, () => {
      const broken = new Set<string>();
      const cast = new Set<string>();
      for (let run = 0; run < 3; run++) {
        const spots = enemyFormation(roster) ?? roster.map((_, i) => at(i - 1, -3));
        const enemies = createEnemyUnits(roster, spots, 5, 1.6);
        const result = runFight(party(), enemies, {
          quiet: true,
          maxTurns: 500,
          policy: () => {
            const living = useCombatStore.getState().units.filter((u) => u.currentHp > 0);
            const hexes = living.map((u) => hexKey(u.position));
            if (new Set(hexes).size !== hexes.length) broken.add('two living units share a hex');
            for (const p of useCombatStore.getState().preparedAttacks) cast.add(p.skill.id);
            return null;
          },
        });
        expect(result.outcome).not.toBe('draw');
      }
      expect([...broken]).toEqual([]);
      if (roster[0] === 'oni_warlord') expect(cast.has('warlords_doom')).toBe(true);
      if (roster[0] === 'daitengu') expect(cast.has('great_gale')).toBe(true);
    });
  }
});
