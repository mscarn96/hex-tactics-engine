import { HeroSkill } from '@/models/types';
import { projectileFamily, skillVfx } from '@/systems/combat/vfxResolve';
import { basicAttackWith } from '@/systems/combat/basicAttack';
import { itemTemplates } from '@/data/items/itemTemplates';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import * as skillData from '@/data/skills/skillData';
import * as champion from '@/data/skills/mastery/champion';
import * as arcanist from '@/data/skills/mastery/arcanist';
import * as druid from '@/data/skills/mastery/druid';
import * as hunter from '@/data/skills/mastery/hunter';
import * as elite from '@/data/skills/eliteSkills';
import * as factionElite from '@/data/skills/factionEliteSkills';

/**
 * **Every projectile is physical or magic, and draws as what it is.** A physical one — an arrow,
 * a quarrel, a thrown weapon, a stone, a spit or a web — flies as a thing; a magic one glows. This
 * walks the whole corpus with the caster each skill is really used by and pins the split.
 */

const isSkill = (v: unknown): v is HeroSkill =>
  typeof v === 'object' && v !== null && 'targetType' in v && 'id' in v && 'range' in v && 'manaCost' in v;
const skillsOf = (mod: object): HeroSkill[] => {
  const out = new Map<string, HeroSkill>();
  const walk = (v: unknown, seen: Set<unknown>) => {
    if (typeof v !== 'object' || v === null || seen.has(v)) return;
    seen.add(v);
    if (isSkill(v)) out.set(v.id, v);
    for (const c of Array.isArray(v) ? v : Object.values(v)) walk(c, seen);
  };
  walk(Object.values(mod), new Set());
  return [...out.values()];
};

const held = (form: string) => basicAttackWith(itemTemplates.find((i) => (i as { form?: string }).form === form) as never);
/** Each class's skills with the weapon its class carries: a Hunter's bow, a Champion's sword… */
const HEROES: [object, HeroSkill][] = [
  [champion, held('long_sword')], [arcanist, held('staff')], [druid, held('branch')], [hunter, held('bow')],
];

interface Row { who: string; skill: string; kind: string; delivery: string; family?: 'physical' | 'magic' }

const rows: Row[] = [];
const add = (who: string, skill: HeroSkill, caster: Parameters<typeof skillVfx>[1]) => {
  const v = skillVfx(skill, caster);
  rows.push({ who, skill: skill.id, kind: v.kind, delivery: v.delivery, family: projectileFamily(v.kind, v.delivery) });
};
for (const [mod, attack] of HEROES) for (const s of skillsOf(mod)) add('hero', s, { skills: [attack] });
for (const s of [...skillsOf(skillData), ...skillsOf(elite), ...skillsOf(factionElite)]) add('shared', s, { skills: [] });
for (const t of enemyTemplates) for (const s of t.skills) add(t.id, s, { skills: t.skills, blow: t.blow });
for (const form of ['bow', 'crossbow', 'throwing_axe', 'throwing_blade', 'staff', 'wand']) add(`basic:${form}`, held(form), { skills: [] });

const projectiles = rows.filter((r) => r.family);

describe('projectile family', () => {
  it('classifies every projectile in the corpus', () => {
    expect(projectiles.length).toBeGreaterThan(40);
    for (const r of projectiles) expect(['physical', 'magic']).toContain(r.family);
  });

  it('makes arrows, quarrels and thrown things physical, and draws them as things', () => {
    const weapon = projectiles.filter((r) => ['bow', 'crossbow', 'thrown'].includes(r.delivery));
    expect(weapon.length).toBeGreaterThan(10);
    const wrong = weapon.filter((r) => r.family !== 'physical' || !['shot', 'throw', 'ricochet', 'arrows'].includes(r.kind));
    expect(wrong).toEqual([]);
  });

  it('makes every spell projectile magic, and never draws a spell as an arrow or a throw', () => {
    const spells = projectiles.filter((r) => r.delivery === 'spell');
    expect(spells.length).toBeGreaterThan(10);
    expect(spells.filter((r) => r.family !== 'magic' || r.kind === 'shot' || r.kind === 'throw')).toEqual([]);
  });

  it('turns spear throwers, slingers and archers physical', () => {
    const ranged = (id: string) => projectiles.filter((r) => r.who === id);
    for (const id of ['goblin_spearthrower', 'delve_slinger', 'skeleton_archer', 'brigand_archer', 'reed_stalker',
      'briar_shrike', 'steppe_archer', 'shardcaster']) {
      expect(ranged(id).length).toBeGreaterThan(0);
      for (const r of ranged(id)) expect({ id, skill: r.skill, family: r.family }).toEqual({ id, skill: r.skill, family: 'physical' });
    }
    expect(ranged('goblin_spearthrower')[0].kind).toBe('throw');
    expect(ranged('delve_slinger')[0].kind).toBe('throw');
  });

  it('pins the split', () => {
    const count = (f: string) => projectiles.filter((r) => r.family === f).length;
    // Both counts move only when the corpus does: a new projectile skill should be classified on purpose
    // (Executioner left the magic count in the Champion pass: it is a slash now, not a stray shot;
    // Talons left the physical count in the 2026-10-14 playtest: claw rakes on the victim)
    // (the Fallen Order's thrown chain-sickles and lantern bolts, its toll and the Vow's strike back
    // came in as projectiles, 2026-10-15, beside the Draconic Host's feathers and lightning)
    // (the Yokai, 2026-10-15: the Jorogumo's spat Silk Shroud and Silk Snare and the foxes' three fires,
    // each counted on the shared roster and on its template)
    // (Jadeveil: Silk Hollow / Yokai, 2026-10-16: the canopy weaver's Canopy Venom, spat from above)
    // (Jadeveil: Kairen, 2026-10-16: the green orb's Orb Bolt)
    expect({ physical: count('physical'), magic: count('magic') }).toEqual({ physical: 63, magic: 64 });
  });
});
