import { EnemyRole, FACTIONS, factionCandidates, factionMembers, factionsForBand, factionTagline, findFaction, walksIn } from '@/data/templates/factions';
import { composeForBand, composeForFaction, shapesAtBand, shapesFor } from '@/systems/world/encounterGenerator';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { JADE_DISPLAY } from '@/data/display/terrainDisplay';
import { DRACONIC_HOST_SKILLS, JADE_GALE, JADE_LIGHT, JADE_STORM } from '@/data/skills/draconicHostSkills';
import { THREAT_BANDS, ThreatBand } from '@/systems/world/threat';
import { HeroSkill, SkillTargetType, TileType } from '@/models/types';

/**
 * The Draconic Host, Jadeveil's summit approach (the private project notes):
 * elite units of the jade dragon Kairen, at the top two bands on the high ground, with no
 * chaff, every role filled from its own templates, a kit the AI will use, and a jade light
 * that reads against Jadeveil's green ground.
 */

const HOST = findFaction('draconic_host')!;
const ROLES: EnemyRole[] = ['chaff', 'front', 'ranged', 'caster', 'elite'];
const HOME = [TileType.Mountain, TileType.Highlands];
const template = (id: string) => enemyTemplates.find((t) => t.id === id)!;
const effectType = (s: HeroSkill): string | undefined => [s.appliesEffect ?? []].flat()[0]?.type;

/** How often each faction comes up on this Jadeveil ground, out of every candidate entry. */
function shares(band: ThreatBand, terrain: TileType): Map<string, number> {
  const pool = factionCandidates(band, terrain, Infinity, 'jadeveil');
  const out = new Map<string, number>();
  for (const f of pool) out.set(f.id, (out.get(f.id) ?? 0) + 1 / pool.length);
  return out;
}

describe('the Draconic Host roster', () => {

  it('has two elites, and four ordinary members a step over the frozen north at their role', () => {
    const tiers = factionMembers('draconic_host').map((id) => `${id}:${template(id).tier}`);
    expect(tiers.filter((t) => t.endsWith(':elite')).map((t) => t.split(':')[0]).sort()).toEqual(['daitengu', 'oni_warlord']);
    // Elite units: the Brute holds more than the Rime Giantling, the Warlord more than the Rime Jarl
    expect(template('oni_brute').baseStats.maxHp).toBeGreaterThan(template('rime_giantling').baseStats.maxHp);
    expect(template('oni_warlord').baseStats.maxHp).toBeGreaterThan(template('rime_jarl').baseStats.maxHp);
    // and short of the Legion, the army that took the world
    expect(template('oni_warlord').baseStats.maxHp).toBeLessThan(template('dread_knight').baseStats.maxHp);
  });
});

describe('where the Host walks', () => {
  it('walks Jadeveil and nowhere else', () => {
    expect(walksIn(HOST, 'jadeveil')).toBe(true);
    expect(walksIn(HOST, 'empire')).toBe(false);
    for (const band of THREAT_BANDS) expect(factionsForBand(band, 'empire')).not.toContain(HOST);
  });

  /** The roles fill the high bands: bands 3 and 4 only, as the summit approach. */
  it('rolls at bands 3–4 only', () => {
    for (const band of THREAT_BANDS) {
      expect(factionsForBand(band, 'jadeveil').includes(HOST)).toBe(band >= 3);
    }
  });

  it('is at home on the mountain and the highlands, outranked by nobody there', () => {
    const faults: string[] = [];
    for (const band of [3, 4] as ThreatBand[]) {
      for (const ground of HOME) {
        const share = shares(band, ground);
        const mine = share.get('draconic_host') ?? 0;
        if (mine === 0) faults.push(`band ${band} ${ground}: absent`);
        if (mine < Math.max(...share.values())) faults.push(`band ${band} ${ground}: outranked`);
      }
    }
    expect(faults).toEqual([]);
  });

  it('rolls in real fights on its ground', () => {
    const missing: string[] = [];
    for (const band of [3, 4] as ThreatBand[]) {
      for (const ground of HOME) {
        let seen = false;
        for (let i = 0; i < 300 && !seen; i++) {
          seen = composeForBand(band, ground, Infinity, [], Math.random, 'jadeveil').factionId === 'draconic_host';
        }
        if (!seen) missing.push(`band ${band} ${ground}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * Every shape at bands 3 and 4 but the two that call for chaff: the Host has none, as the
   * Legion has none, so its chaff slot falls through to the front line and `fieldsDistinctly`
   * shuts the Raid and the Storm. That is the brief's statement, and it costs the Karasu-Tengu
   * band 4: the Storm is band 4's one shape with a ranged slot.
   */
  it('is arranged into every shape at bands 3 and 4 that does not call for chaff', () => {
    const shut: string[] = [];
    for (const band of [3, 4] as ThreatBand[]) {
      const fielded = new Set(shapesFor(band, HOST).map((s) => s.id));
      for (const shape of shapesAtBand(band)) {
        if ((shape.requires ?? []).includes('chaff')) continue;
        if (!fielded.has(shape.id)) shut.push(`${band}/${shape.id}`);
      }
    }
    expect(shut).toEqual([]);
  });

  it('fields every member at band 3, and all but the Karasu-Tengu at band 4', () => {
    const fielded = (band: ThreatBand) => {
      const out = new Set<string>();
      for (let i = 0; i < 300; i++) for (const e of composeForFaction('draconic_host', band, 1).enemies) out.add(e);
      return [...out].sort();
    };
    expect(fielded(3)).toEqual([...factionMembers('draconic_host')].sort());
    expect(fielded(4)).toEqual(factionMembers('draconic_host').filter((id) => id !== 'karasu_tengu').sort());
  });
});

describe('kits the enemy AI will actually use', () => {
  /** `enemyAI` scores expected damage: a single-target cooldown skill must out-hit the at-will. */
  it('makes every single-target cooldown skill out-damage its owner’s at-will', () => {
    const single = (s: HeroSkill) => s.targetType === SkillTargetType.Single && (s.damage ?? 0) > 0;
    const unpressed: string[] = [];
    for (const id of factionMembers('draconic_host')) {
      const t = template(id);
      const atWill = Math.max(0, ...t.skills.filter((s) => single(s) && !s.cooldown).map((s) => s.damage!));
      for (const s of t.skills.filter((s) => single(s) && s.cooldown)) {
        if (s.damage! <= atWill) unpressed.push(`${id}/${s.id}`);
      }
    }
    expect(unpressed).toEqual([]);
  });

  it('gives every member an at-will damage skill for the turns its cooldowns run', () => {
    const idle = factionMembers('draconic_host').filter(
      (id) => !template(id).skills.some((s) => !s.cooldown && (s.damage ?? 0) > 0),
    );
    expect(idle).toEqual([]);
  });

  it('carries the brief\'s statuses and moves: shove, Burn, Shock chain, Doom, a pushing arc, Silence', () => {
    const kit = (id: string) => template(id).skills;
    expect(kit('oni_brute').every((s) => (s.pushDistance ?? 0) > 0)).toBe(true);
    expect(kit('wyrmling').some((s) => effectType(s) === 'burn')).toBe(true);
    expect(kit('karasu_tengu').some((s) => s.selfMove?.kind === 'retreat')).toBe(true);
    expect(kit('raiju').some((s) => s.targetType === SkillTargetType.Chain && effectType(s) === 'shock')).toBe(true);
    expect(kit('oni_warlord').some((s) => s.prepares && effectType(s) === 'doom')).toBe(true);
    expect(kit('oni_warlord').some((s) => s.targetType === SkillTargetType.Arc)).toBe(true);
    expect(kit('daitengu').some((s) => s.prepares && s.targetType === SkillTargetType.Arc && (s.pushDistance ?? 0) > 0)).toBe(true);
    expect(kit('daitengu').some((s) => effectType(s) === 'silence')).toBe(true);
  });
});

describe('the jade light against green ground', () => {
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /**
   * Every green surface a Host fight or its map can stand on. The Host is
   * Jadeveil's alone (`factions.ts`, `worlds: ['jadeveil']`), so these are the
   * range's grounds — its arenas draw their boards from the same rows. The
   * Empire's world-map tops used to stand in here; the board look (2026-10-29)
   * brightened them, and no Host fight stands on them.
   */
  const GREENS = [
    JADE_DISPLAY.moss.tile, JADE_DISPLAY.bamboo.tile, JADE_DISPLAY.ridge.tile, JADE_DISPLAY.crown.tile,
  ];

  /** Hue alone does not separate at game size: the jade reads by value, 3:1 or better. */
  it('keeps every jade effect colour 3:1 or more over every green ground', () => {
    const jades = [...new Set([JADE_LIGHT, JADE_STORM, JADE_GALE,
      ...DRACONIC_HOST_SKILLS.map((s) => s.vfxColor).filter((c): c is string => !!c && c !== '#e4e6ea')])];
    const faint = jades.flatMap((c) => GREENS.filter((g) => contrast(c, g) < 3).map((g) => `${c} on ${g}`));
    expect(faint).toEqual([]);
  });

  /** No volcanic ash: nothing the Host casts is the Empire's ember orange or red. */
  it('casts nothing in ember orange or red', () => {
    const warm = DRACONIC_HOST_SKILLS.filter((s) => {
      const c = s.vfxColor ?? '#ffffff';
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      return r > g + 40 && r > b + 40;
    }).map((s) => s.id);
    expect(warm).toEqual([]);
  });
});
