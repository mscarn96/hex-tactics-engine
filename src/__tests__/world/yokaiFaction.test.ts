import { EnemyRole, FACTIONS, factionCandidates, factionMembers, factionTagline, findFaction, walksIn } from '@/data/templates/factions';
import { composeForBand, shapesAtBand, shapesFor } from '@/systems/world/encounterGenerator';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { THREAT_BANDS, ThreatBand } from '@/systems/world/threat';
import { AfflictionType, AuraType, HeroSkill, SkillTargetType, TileType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { foxfire } from '@/data/skills/yokaiSkills';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { hasEffect, isHiddenFrom } from '@/systems/combat/statusEffects';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Yokai of the low forest (the private project notes), held to what the
 * brief asks: Jadeveil's own at bands 0–2 on its bamboo forest and terraced slope, all
 * five roles filled, and each member doing the one thing its row says.
 */

const ROLES: EnemyRole[] = ['chaff', 'front', 'ranged', 'caster', 'elite'];
const yokai = findFaction('yokai')!;
const template = (id: string) => enemyTemplates.find((t) => t.id === id)!;

/** How often each faction comes up on this Jadeveil ground, out of every candidate entry. */
function shares(band: ThreatBand, terrain: TileType): Map<string, number> {
  const pool = factionCandidates(band, terrain, Infinity, 'jadeveil');
  const out = new Map<string, number>();
  for (const f of pool) out.set(f.id, (out.get(f.id) ?? 0) + 1 / pool.length);
  return out;
}

describe('the Yokai roster', () => {

  it('fills every role from its own templates, one elite among them', () => {
    const owners = new Map<string, string>();
    for (const f of FACTIONS) for (const role of ROLES) for (const id of f.roles[role]) owners.set(id, f.id);
    for (const id of factionMembers('yokai')) expect(owners.get(id)).toBe('yokai');
    const elites = factionMembers('yokai').filter((id) => template(id).tier === 'elite');
    expect(elites).toEqual(['nue']);
  });

  /** The shrine campaign moved her into the Silk Hollow: a boss there, never rolled on the map. */
  it('keeps the Jorōgumo out of the roaming roster: she is the Silk Hollow’s boss', () => {
    expect(factionMembers('yokai')).not.toContain('jorogumo');
    expect(template('jorogumo').tier).toBe('boss');
  });
});

describe('Jadeveil’s low forest', () => {
  it('walks Jadeveil and nowhere else', () => {
    expect(yokai.worlds).toEqual(['jadeveil']);
    expect(walksIn(yokai, 'empire')).toBe(false);
    for (const band of THREAT_BANDS) {
      for (const terrain of Object.values(TileType)) {
        expect(factionCandidates(band, terrain).includes(yokai)).toBe(false);
      }
    }
  });

  /** On its own forest and plains at bands 0–2 it is a candidate, and none outranks it. */
  it('is at home on forest and plains at bands 0–2', () => {
    const faults: string[] = [];
    for (const band of [0, 1, 2] as ThreatBand[]) {
      for (const ground of [TileType.Forest, TileType.Plains]) {
        const share = shares(band, ground);
        const mine = share.get('yokai') ?? 0;
        if (mine === 0) faults.push(`band ${band} ${ground}: absent`);
        if (mine < Math.max(...share.values())) faults.push(`band ${band} ${ground}: outranked`);
      }
    }
    expect(faults).toEqual([]);
    expect(yokai.threatRange).toEqual([0, 2]);
  });

  it('rolls in real Jadeveil fights on its ground', () => {
    for (const band of [0, 1, 2] as ThreatBand[]) {
      for (const ground of [TileType.Forest, TileType.Plains]) {
        let seen = false;
        for (let i = 0; i < 200 && !seen; i++) {
          seen = composeForBand(band, ground, Infinity, [], Math.random, 'jadeveil').factionId === 'yokai';
        }
        expect({ band, ground, seen }).toEqual({ band, ground, seen: true });
      }
    }
  });

  it('is arranged into every shape at every band of its range', () => {
    const shut: string[] = [];
    for (const band of [0, 1, 2] as ThreatBand[]) {
      const fielded = new Set(shapesFor(band, yokai).map((s) => s.id));
      for (const shape of shapesAtBand(band)) if (!fielded.has(shape.id)) shut.push(`${band}/${shape.id}`);
    }
    expect(shut).toEqual([]);
  });
});

describe('kits the enemy AI will actually use', () => {
  const single = (s: HeroSkill) => s.targetType === SkillTargetType.Single && (s.damage ?? 0) > 0;

  it('makes every single-target cooldown skill out-damage its owner’s at-will', () => {
    const unpressed: string[] = [];
    for (const id of factionMembers('yokai')) {
      const t = template(id);
      const atWill = Math.max(0, ...t.skills.filter((s) => single(s) && !s.cooldown).map((s) => s.damage!));
      for (const s of t.skills.filter((s) => single(s) && s.cooldown)) {
        if (s.damage! <= atWill) unpressed.push(`${id}/${s.id}: ${s.damage} vs ${atWill}`);
      }
    }
    expect(unpressed).toEqual([]);
  });

  it('gives every member a damaging skill to press on any turn', () => {
    const idle = factionMembers('yokai').filter((id) => !template(id).skills.some((s) => !s.cooldown && (s.damage ?? 0) > 0));
    expect(idle).toEqual([]);
  });
});

describe('each does what its row says', () => {
  const skill = (id: string, skillId: string) => template(id).skills.find((s) => s.id === skillId)!;
  const effect = (s: HeroSkill) => [s.appliesEffect].flat()[0];

  it('Kodama: weak, and its blow shoves the hero a hex', () => {
    const kodama = template('kodama');
    expect(kodama.baseStats.maxHp).toBeLessThanOrEqual(24);
    expect(kodama.skills[0].pushDistance).toBe(1);
  });

  it('Kappa: its grapple has a chance to Root for 2', () => {
    const grapple = skill('kappa', 'kappa_grapple');
    expect(grapple.appliesEffect).toMatchObject({ type: AfflictionType.Root, duration: 2, chance: BALANCE.KAPPA_ROOT_CHANCE });
    expect(BALANCE.KAPPA_ROOT_CHANCE).toBeGreaterThan(0);
    expect(BALANCE.KAPPA_ROOT_CHANCE).toBeLessThan(1);
  });

  it('Kitsune: casts Silence and blinks away', () => {
    const hush = skill('kitsune', 'kitsune_hush');
    expect(effect(hush)?.type).toBe(AfflictionType.Silence);
    expect(effect(hush)?.duration).toBeGreaterThanOrEqual(2);
    expect(hush.selfMove?.kind).toBe('retreat');
  });

  it('Nue: claws at will, and Black Thunder strikes everyone beside it', () => {
    const nue = template('nue');
    expect(nue.tier).toBe('elite');
    expect(nue.skills.map((s) => s.id)).toEqual(['nue_claws', 'nue_black_thunder']);
    expect(skill('nue', 'nue_black_thunder').targetType).toBe(SkillTargetType.Ring);
    expect(nue.passives).toEqual(['nueThundercloud', 'nueSerpentTail']);
  });

  describe('on the board', () => {
    const hero = makeUnit({
      id: 'h', heroId: 'h', name: 'h', position: at(0, 0),
      stats: makeStats({ maxHp: 4000, attack: 30, defense: 0, speed: 5, critChance: 0, dodgeChance: 0 }),
    });
    const swing = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 0.2, range: 8 });

    const field = (id: string) => {
      const store = useCombatStore.getState();
      store.reset();
      const [unit] = createEnemyUnits([id], [at(0, -2)], 1, 1);
      store.initCombat([{ ...hero, skills: [swing] }], [unit]);
      return useCombatStore.getState().units.find((u) => u.templateId === id)!;
    };

    it('Tanuki: struck and still standing, it slips into Stealth, out of reach of a single target', () => {
      const tanuki = field('tanuki');
      resolveSkillUse(useCombatStore.getState().units.find((u) => u.id === 'h')!, swing, tanuki.position, SILENT_SINK);
      const struck = useCombatStore.getState().units.find((u) => u.id === tanuki.id)!;
      expect(struck.currentHp).toBeLessThan(struck.stats.maxHp);
      expect(hasEffect(struck, AuraType.Stealth)).toBe(true);
      expect(isHiddenFrom(struck, swing)).toBe(true);
    });

    it('Onibi: its foxfire Burn stacks with every throw', () => {
      const onibi = field('onibi');
      const target = () => useCombatStore.getState().units.find((u) => u.id === 'h')!;
      const always = { ...foxfire, range: 9 };
      resolveSkillUse(onibi, always, target().position, SILENT_SINK);
      resolveSkillUse(onibi, always, target().position, SILENT_SINK);
      const burn = target().activeEffects.find((e) => e.type === AfflictionType.Burn);
      expect(burn?.stacks ?? 1).toBeGreaterThanOrEqual(2);
    });
  });
});
