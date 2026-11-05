import { DEFAULT_LOCALE, LOCALES, setLocale, type Locale } from '@/i18n';
import { BALANCE } from '@/data/balanceConstants';
import { pathDescription, pathName, skillDescription, skillName } from '@/data/gameText';
import { lifewarden, stoneshaper, wildshape } from '@/data/skills/trees/druid';
import { beetle } from '@/data/skills/trees/beetle';
import { firefly } from '@/data/skills/trees/firefly';
import { mantis } from '@/data/skills/trees/mantis';
import * as druidSkills from '@/data/skills/mastery/druid';
import * as beetleSkills from '@/data/skills/mastery/beetle';
import * as fireflySkills from '@/data/skills/mastery/firefly';
import * as mantisSkills from '@/data/skills/mastery/mantis';
import { mantisStageDescription, markedPrey, threefoldScythe } from '@/data/skills/mastery/mantis';
import type { HeroSkill, MasteryPath } from '@/models/types';
import type { TableNamespace } from '@/i18n/dataText';
import { catalogGaps } from '../support/catalogEntries';
import { nodeDescription, nodeName } from '../support/masteryNodeText';

/**
 * The Druid's and the Monk's mastery words — paths, nodes and the skills their
 * trees grant — live in `masteryDruid` and `masteryMonk`, keyed by id
 * (the private project notes, "Data tables keep ids").
 */

afterEach(() => setLocale(DEFAULT_LOCALE));

/** Every skill a module defines, with the Reactions' answers that ride inside them. */
function skillsOf(mod: Record<string, unknown>): HeroSkill[] {
  const out = new Map<string, HeroSkill>();
  const add = (s: HeroSkill) => {
    out.set(s.id, s);
    if (s.reaction?.response) add(s.reaction.response);
  };
  for (const v of Object.values(mod)) {
    if (v && typeof v === 'object' && 'id' in v && 'targetType' in v) add(v as HeroSkill);
  }
  return [...out.values()];
}

const TABLES: { ns: TableNamespace; paths: MasteryPath[]; skills: HeroSkill[]; extra: string[] }[] = [
  { ns: 'masteryDruid', paths: [lifewarden, stoneshaper, wildshape], skills: skillsOf(druidSkills), extra: [] },
  {
    ns: 'masteryMonk',
    paths: [beetle, firefly, mantis],
    skills: [beetleSkills, fireflySkills, mantisSkills].flatMap(skillsOf),
    extra: [
      'skill.marked_prey.releaseDescription',
      'skill.threefold_scythe.stage2Description',
      'skill.threefold_scythe.stage3Description',
    ],
  },
];

/** A node names its own prerequisites in a label exactly when it asks for "any N of" them. */
const labelled = (paths: MasteryPath[]) =>
  paths.flatMap((p) => p.nodes).filter((n) => n.requiresCount !== undefined).map((n) => `node.${n.id}.requiresLabel`);

describe.each(TABLES)('$ns', ({ ns, paths, skills, extra }) => {
  it('has every path, node and skill in every language, and nothing else', () => {
    const ids = [
      ...paths.map((p) => `path.${p.id}`),
      ...paths.flatMap((p) => p.nodes.map((n) => `node.${n.id}`)),
      ...skills.map((s) => `skill.${s.id}`),
    ];
    const extras = new Set([...labelled(paths), ...extra]);
    const gaps = catalogGaps(ns, ids, ['name', 'description'])
      .filter((g) => !(g.endsWith(' has no data entry') && extras.has(g.slice(g.indexOf('.') + 1, -' has no data entry'.length))));
    expect(gaps).toEqual([]);
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      const entries = (LOCALES[locale].catalog as Record<string, Record<string, unknown>>)[ns];
      expect([...extras].filter((key) => !(key in entries)).map((key) => `${locale}:${key}`)).toEqual([]);
    }
  });

  it('carries no words on the data itself', () => {
    for (const p of paths) {
      expect([p.id, p.name, p.tagline]).toEqual([p.id, undefined, undefined]);
      for (const n of p.nodes) expect([n.id, n.name, n.description, n.requiresLabel]).toEqual([n.id, undefined, undefined, undefined]);
    }
    for (const s of skills) expect([s.id, s.name, s.description]).toEqual([s.id, undefined, undefined]);
  });
});

/**
 * These lines used to be built from the balance table; the catalogs write the
 * figures out, so a retune that leaves them behind fails here (and the check
 * above carries the English figures into the Polish).
 */
describe('figures written into the text match the balance', () => {
  const B = BALANCE.BEETLE;
  const F = BALANCE.FIREFLY;
  const M = BALANCE.MANTIS;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const cases: [string, string, string[]][] = [
    ['skill', 'iron_carapace', [`up to ${B.CARAPACE_MAX}.`, `+${B.CARAPACE_DEFENSE} Physical Defense`, `With ${B.CARAPACE_MAX},`]],
    ['skill', 'horn_sweep', [`has ${B.HORN_SWEEP_ATTACK_DOWN} less Attack`]],
    ['skill', 'carapace_leap', [`within ${B.LEAP_CAST_RANGE} hexes`, `For ${B.LEAP_TURNS} turns`]],
    ['skill', 'grip_and_throw', [`throw it ${B.THROW_DISTANCE} hexes`]],
    ['skill', 'shell_wall', [`within ${B.SHELL_WALL_RADIUS} hexes`, `for ${B.SHELL_WALL_TURNS} turns`]],
    ['skill', 'vengeful_shell', [`For ${B.VENGEFUL_TURNS} turns`, `within ${B.VENGEFUL_REACH} hexes`, `Up to ${B.VENGEFUL_ANSWERS} a round`]],
    ['skill', 'carapace_bastion', [`for ${B.BASTION_TURNS} turns`]],
    ['skill', 'shell_swap', [`within ${B.SWAP_RANGE} hexes`, `has ${B.SWAP_ATTACK_DOWN} less Attack`]],
    ['skill', 'firefly_motes', [`within ${F.MOTES_RADIUS} of you`, `+${F.MOTE_ATTACK} Attack`, `+${F.MOTE_CRIT}% critical`]],
    ['skill', 'firefly_swarm', [`lose ${F.SWARM_ATTACK_DOWN} Attack`]],
    ['skill', 'lantern_beacon', [`within ${F.BEACON_RADIUS} of it`, `+${F.BEACON_CRIT}% critical`, `take ${pct(F.BEACON_EXPOSED)} more`]],
    ['skill', 'pinning_cut', [`next ${M.EXPOSE_TURNS} turns`, `${pct(M.EXPOSE)} more damage`]],
    ['node', 'mantis_pinning_cut', [`for ${M.EXPOSE_TURNS} turns`]],
    ['skill', 'apex_form', [`for ${BALANCE.APEX_TURNS} turns`, `needs ${BALANCE.APEX_COOLDOWN} turns`]],
    ['skill', 'blood_howl', [`+${BALANCE.BLOOD_HOWL_CRIT}% Critical Chance`, BALANCE.BLOOD_HOWL_TURN_CAP === 1 ? 'at most once between' : `at most ${BALANCE.BLOOD_HOWL_TURN_CAP} between`]],
  ];
  it.each(cases)('%s %s', (kind, id, figures) => {
    const text = kind === 'skill' ? skillDescription({ id }) : nodeDescription({ id });
    for (const figure of figures) expect(text).toContain(figure);
  });
});
