import {
  EnemyRole,
  FACTIONS,
  FactionId,
  factionCandidates,
  factionMembers,
  findFaction,
  roams,
} from '@/data/templates/factions';
import {
  composeForBand,
  composeForFaction,
  shapesAtBand,
  shapesFor,
} from '@/systems/world/encounterGenerator';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { THREAT_BANDS, ThreatBand } from '@/systems/world/threat';
import { HeroSkill, SkillTargetType, TileType } from '@/models/types';

/**
 * The four factions of the frozen-north plan
 * (the private project notes), held to what each was added
 * for: a native faction on ground that had none, at the bands it was missing
 * from, able to be arranged into every fight its bands offer.
 */

const ROLES: EnemyRole[] = ['chaff', 'front', 'ranged', 'caster', 'elite'];

/** Where each wandering faction belongs, as the plan places it. */
const HOMES: { id: FactionId; terrain: TileType[]; bands: [ThreatBand, ThreatBand] }[] = [
  // The plan placed them at bands 1–3; the release check took them to 4, where
  // the deep desert had no native faction
  { id: 'sandscourge', terrain: [TileType.Desert], bands: [1, 4] },
  { id: 'thunder_herd', terrain: [TileType.Plains, TileType.Highlands], bands: [2, 4] },
  { id: 'rime_jarls', terrain: [TileType.Tundra], bands: [2, 4] },
];

const NEW: FactionId[] = ['sandscourge', 'thunder_herd', 'rime_jarls', 'hoarfrost'];

const inRange = (band: ThreatBand, [low, high]: [ThreatBand, ThreatBand]) => band >= low && band <= high;

/** How often each faction comes up on this ground, out of every candidate entry. */
function shares(band: ThreatBand, terrain: TileType): Map<string, number> {
  const pool = factionCandidates(band, terrain);
  const out = new Map<string, number>();
  for (const f of pool) out.set(f.id, (out.get(f.id) ?? 0) + 1 / pool.length);
  return out;
}

describe('the four new rosters', () => {
  it('fill all five roles from their own templates', () => {
    const owners = new Map<string, string>();
    for (const faction of FACTIONS) {
      for (const role of ROLES) for (const id of faction.roles[role]) owners.set(id, faction.id);
    }
    const gaps: string[] = [];
    for (const id of NEW) {
      const faction = findFaction(id)!;
      for (const role of ROLES) {
        if (faction.roles[role].length === 0) gaps.push(`${id}/${role}`);
        for (const member of faction.roles[role]) {
          if (owners.get(member) !== id) gaps.push(`${id}/${member} is also ${owners.get(member)}'s`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('are five templates each, one elite among them', () => {
    const tiers = NEW.map((id) => {
      const members = factionMembers(id);
      const elites = members.filter((m) => enemyTemplates.find((t) => t.id === m)?.tier === 'elite');
      return `${id}: ${members.length}/${elites.length}`;
    });
    expect(tiers).toEqual(NEW.map((id) => `${id}: 5/1`));
  });
});

describe('a native faction on its own ground', () => {
  /**
   * The reason the three wanderers exist: desert had no native faction at any
   * band, band-3 plains had none, and there was no cold ground at all. On its
   * own terrain, at every band of its range, each is a candidate and none is
   * more likely than it — other locals may tie, nobody outranks it.
   */
  it.each(HOMES)('puts $id at home on its ground at every band it covers', ({ id, terrain, bands }) => {
    const faults: string[] = [];
    for (const band of THREAT_BANDS) {
      for (const ground of terrain) {
        const share = shares(band, ground);
        const mine = share.get(id) ?? 0;
        if (!inRange(band, bands)) {
          if (mine > 0) faults.push(`band ${band} ${ground}: present outside its range`);
          continue;
        }
        if (mine === 0) faults.push(`band ${band} ${ground}: absent`);
        const top = Math.max(...share.values());
        if (mine < top) faults.push(`band ${band} ${ground}: ${mine.toFixed(2)} under ${top.toFixed(2)}`);
      }
    }
    expect(faults).toEqual([]);
  });

  it.each(HOMES)('rolls $id in real fights on its ground', ({ id, terrain, bands }) => {
    const missing: string[] = [];
    for (let band = bands[0]; band <= bands[1]; band++) {
      for (const ground of terrain) {
        let seen = false;
        for (let i = 0; i < 300 && !seen; i++) {
          seen = composeForBand(band as ThreatBand, ground).factionId === id;
        }
        if (!seen) missing.push(`band ${band} ${ground}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * Away from home it is nobody: the three are `homeLocked`, so a faction with
   * an identity does not wander (the private project notes, decision 1).
   */
  it('keeps the new wanderers off every other ground', () => {
    const away = shares(3, TileType.Forest);
    for (const id of ['sandscourge', 'thunder_herd', 'rime_jarls']) {
      expect(away.get(id) ?? 0).toBe(0);
    }
  });
});

describe('every fight a band offers', () => {
  /**
   * Each fills all five roles, so no shape's `requires` can shut it out: at every
   * band of its range it is arranged into every shape the table defines there.
   */
  it.each(NEW)('arranges %s into every shape at every band of its range', (id) => {
    const faction = findFaction(id)!;
    const shut: string[] = [];
    for (const band of THREAT_BANDS) {
      if (!inRange(band, faction.threatRange)) continue;
      const offered = shapesAtBand(band).map((s) => s.id);
      const fielded = new Set(shapesFor(band, faction).map((s) => s.id));
      for (const shape of offered) if (!fielded.has(shape)) shut.push(`${band}/${shape}`);
    }
    expect(shut).toEqual([]);
  });
});

// Playtest 2026-10-14: the Hoarfrost was met only in the ice lair, and its Motes and
// Shardcasters never at all. It now walks its own snow at bands 3–4, and the late
// shapes call its chaff and its ranged line.
describe('the Hoarfrost, winter given a will', () => {
  const hoarfrost = findFaction('hoarfrost')!;

  it('roams bands 3–4, and leaves no faction lair-only', () => {
    expect(FACTIONS.filter((f) => !roams(f)).map((f) => f.id)).toEqual([]);
    expect(hoarfrost.threatRange).toEqual([3, 4]);
  });

  /** Winter does not wander into a desert: only the tundra, and only from band 3. */
  it('rolls only on tundra at bands 3–4', () => {
    const met: string[] = [];
    for (const band of THREAT_BANDS) {
      for (const terrain of Object.values(TileType)) {
        for (const fromCastle of [0, 10, Infinity]) {
          if (factionCandidates(band, terrain, fromCastle).includes(hoarfrost)) met.push(`${band}:${terrain}`);
        }
      }
    }
    expect([...new Set(met)].sort()).toEqual(['3:tundra', '4:tundra']);
    let rolled = 0;
    for (let i = 0; i < 300; i++) if (composeForBand(4, TileType.Tundra).factionId === 'hoarfrost') rolled++;
    expect(rolled).toBeGreaterThan(0);
  });

  /** A curated fight names it, the way a lair's guard chamber names its faction. */
  it('is fielded whole — Motes and Shardcasters included — at band 4', () => {
    const fielded = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const { factionId, enemies } = composeForFaction('hoarfrost', 4, 1);
      expect(factionId).toBe('hoarfrost');
      for (const e of enemies) fielded.add(e);
    }
    expect([...fielded].sort()).toEqual([...factionMembers('hoarfrost')].sort());
  });
});

describe('kits the enemy AI will actually use', () => {
  /**
   * `enemyAI` scores expected damage and nothing else, so a single-target skill
   * that waits on a cooldown is pressed only if it out-damages its owner's
   * at-will — otherwise the status it carries never lands (`mireGrasp`'s note in
   * `skillData.ts`). The plan drafted two the other way round; this holds the
   * fix for all four factions.
   */
  it('makes every single-target cooldown skill out-damage its owner’s at-will', () => {
    const single = (s: HeroSkill) => s.targetType === SkillTargetType.Single && (s.damage ?? 0) > 0;
    const unpressed: string[] = [];
    for (const id of NEW.flatMap(factionMembers)) {
      const t = enemyTemplates.find((x) => x.id === id)!;
      const atWill = Math.max(0, ...t.skills.filter((s) => single(s) && !s.cooldown).map((s) => s.damage!));
      for (const s of t.skills.filter((s) => single(s) && s.cooldown)) {
        if (s.damage! <= atWill) unpressed.push(`${id}/${s.id}: ${s.damage} vs ${atWill}`);
      }
    }
    expect(unpressed).toEqual([]);
  });

  /** Every member has something to do on a turn its cooldowns are all running. */
  it('gives every member a skill to press on any turn but the Hurler', () => {
    const idle = NEW.flatMap(factionMembers).filter((id) => {
      const t = enemyTemplates.find((x) => x.id === id)!;
      return !t.skills.some((s) => !s.cooldown && (s.damage ?? 0) > 0);
    });
    // The Hurler's turn between throws is the plan's raise, by design.
    expect(idle).toEqual(['glacier_hurler']);
  });
});
