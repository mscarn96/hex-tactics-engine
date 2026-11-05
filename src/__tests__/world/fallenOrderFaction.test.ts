import { EnemyRole, factionCandidates, factionMembers, findFaction } from '@/data/templates/factions';
import {
  bandsFielding,
  composeForBand,
  composeForFaction,
  shapesAtBand,
  shapesFor,
  shapeViolations,
} from '@/systems/world/encounterGenerator';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { fallenOrderSkillValue } from '@/systems/combat/fallenOrderKits';
import { THREAT_BANDS, ThreatBand } from '@/systems/world/threat';
import { HeroSkill, SkillTargetType, TileType } from '@/models/types';
import { makeUnit } from '../support/fixtures';

/**
 * The Fallen Order (the private project notes, the board's "Author Fallen Order
 * roster around Monk disciplines"): Jadeveil's shrine ground and mist ridges at bands 1–3,
 * every role fielded from its own monks, the Novice met only in the band-2 Ambush.
 */

const ORDER = findFaction('fallen_order')!;
const ROLES: EnemyRole[] = ['chaff', 'front', 'ranged', 'caster', 'elite'];
const HOME = [TileType.Highlands, TileType.Mountain];
const template = (id: string) => enemyTemplates.find((t) => t.id === id)!;

describe('the Fallen Order roster', () => {
  it('walks Jadeveil alone, at bands 1–3, on the highlands and the mountain', () => {
    expect(ORDER.worlds).toEqual(['jadeveil']);
    expect(ORDER.threatRange).toEqual([1, 3]);
    expect(ORDER.terrain).toEqual(HOME);
    for (const band of THREAT_BANDS) {
      for (const ground of HOME) {
        expect(factionCandidates(band, ground, Infinity, 'empire')).not.toContain(ORDER);
      }
    }
  });

  it('fills every role from its own seven monks, two of them elites', () => {
    for (const role of ROLES) expect(ORDER.roles[role].length).toBeGreaterThan(0);
    const members = factionMembers('fallen_order');
    expect(members.sort()).toEqual([
      'beetle_warden', 'bell_keeper', 'chain_sickle_monk', 'fallen_abbot', 'firefly_chanter', 'mantis_adept', 'order_novice',
    ]);
    for (const id of members) expect(template(id)).toBeDefined();
    expect(ORDER.roles.elite.every((id) => template(id).tier === 'elite')).toBe(true);
    expect(members.filter((id) => template(id).tier === 'elite').sort()).toEqual(['bell_keeper', 'fallen_abbot']);
  });

  it('is at home on its ground in Jadeveil at every band it covers', () => {
    const missing: string[] = [];
    for (let band = 1; band <= 3; band++) {
      for (const ground of HOME) {
        const pool = factionCandidates(band as ThreatBand, ground, Infinity, 'jadeveil');
        if (!pool.includes(ORDER)) missing.push(`band ${band} ${ground}: not a candidate`);
        let seen = false;
        for (let i = 0; i < 300 && !seen; i++) {
          seen = composeForBand(band as ThreatBand, ground, Infinity, [], Math.random, 'jadeveil').factionId === 'fallen_order';
        }
        if (!seen) missing.push(`band ${band} ${ground}: never rolled`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('every role fields legally', () => {
  /** Band 3's Raid asks for chaff the Order keeps for the Ambush, so it is the one shape withheld. */
  it('is arranged into every shape its bands offer but the Raid', () => {
    const shut: string[] = [];
    for (let band = 1; band <= 3; band++) {
      const fielded = new Set(shapesFor(band as ThreatBand, ORDER).map((s) => s.id));
      for (const shape of shapesAtBand(band as ThreatBand)) if (!fielded.has(shape.id)) shut.push(`${band}/${shape.id}`);
    }
    expect(shut).toEqual(['3/raid']);
  });

  it('fields only its own members, at the band’s size and elite count', () => {
    const members = new Set<string>(factionMembers('fallen_order'));
    for (let band = 1; band <= 3; band++) {
      for (let i = 0; i < 200; i++) {
        const { shape, enemies } = composeForFaction('fallen_order', band as ThreatBand);
        expect(shapeViolations(band as ThreatBand, shape)).toEqual([]);
        expect(enemies.length).toBe(shape.roles.length);
        for (const e of enemies) expect(members.has(e)).toBe(true);
        const elites = enemies.filter((e) => template(e).tier === 'elite').length;
        expect(elites).toBe(shape.roles.filter((r) => r === 'elite').length);
      }
    }
  });

  it('puts the Novice in the band-2 Ambush and nowhere else', () => {
    const seen = new Set<string>();
    for (let band = 1; band <= 3; band++) {
      for (let i = 0; i < 400; i++) {
        const { shape, enemies } = composeForFaction('fallen_order', band as ThreatBand);
        if (enemies.includes('order_novice')) seen.add(`${band}/${shape.id}`);
      }
    }
    expect([...seen]).toEqual(['2/ambush']);
    expect(bandsFielding(ORDER, new Set(['order_novice']))).toEqual([2]);
  });

  it('fields every member somewhere in its range', () => {
    const fielded = new Set<string>();
    for (let band = 1; band <= 3; band++) {
      for (let i = 0; i < 400; i++) for (const e of composeForFaction('fallen_order', band as ThreatBand).enemies) fielded.add(e);
    }
    expect([...fielded].sort()).toEqual([...factionMembers('fallen_order')].sort());
  });
});

describe('kits the enemy AI will actually use', () => {
  const caster = makeUnit({ id: 'x', isPlayer: false });
  /** The signatures `fallenOrderKits` scores on what they buy, not on their damage. */
  const SCORED = new Set(
    factionMembers('fallen_order').flatMap((id) => template(id).skills)
      .filter((s) => fallenOrderSkillValue(caster, s, [], []) !== undefined)
      .map((s) => s.id as string),
  );

  it('scores the four signatures that deal little or nothing at the cast', () => {
    expect([...SCORED].sort()).toEqual(['abbot_vow', 'great_ring', 'toll_of_passing', 'warden_bastion']);
  });

  it('makes every other single-target cooldown skill out-damage its owner’s at-will', () => {
    const single = (s: HeroSkill) => s.targetType === SkillTargetType.Single && (s.damage ?? 0) > 0;
    const unpressed: string[] = [];
    for (const id of factionMembers('fallen_order')) {
      const t = template(id);
      const atWill = Math.max(0, ...t.skills.filter((s) => single(s) && !s.cooldown).map((s) => s.damage!));
      for (const s of t.skills.filter((s) => single(s) && s.cooldown && !SCORED.has(s.id))) {
        if (s.damage! <= atWill) unpressed.push(`${id}/${s.id}: ${s.damage} vs ${atWill}`);
      }
    }
    expect(unpressed).toEqual([]);
  });

  it('gives every member something to press on a turn its cooldowns are all running', () => {
    const idle = factionMembers('fallen_order').filter((id) =>
      !template(id).skills.some((s) => !s.cooldown && (s.damage ?? 0) > 0));
    expect(idle).toEqual([]);
  });
});
