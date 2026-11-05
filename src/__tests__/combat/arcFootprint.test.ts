import { arcHexes, inArena } from '@/systems/combat/arenaGeometry';
import { generateEnemyPositions, generatePlayerPositions } from '@/systems/combat/unitFactory';
import { HexCoord, HeroSkill, SkillTargetType } from '@/models/types';
import { hexKey } from '@/utils/hexUtils';
import * as skillData from '@/data/skills/skillData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { imperialCleave } from '@/data/templates/aethelred';
import { enemyTemplates } from '@/data/templates/enemyTemplates';

/**
 * What an arc is actually worth, measured against the formations the game fields.
 *
 * The retune from `Cone` to `Arc` grew nine skills' footprints, and a footprint
 * is not what a skill is worth — bodies are. Four hexes of empty ground and four
 * hexes with three enemies standing in them are the same shape and different
 * skills, so pricing the change off area alone would have been arithmetic about
 * the wrong quantity.
 *
 * So this measures **bodies caught at best aim**, against
 * `generateEnemyPositions` — the real spawn rows, which are two ranks of up to
 * five and therefore genuinely clustered. That is the number the damage
 * multiplier has to be sized against, and it is deliberately *sub-linear* in
 * area: doubling a wedge that already covers the front rank adds ground behind
 * the fight, not targets in it.
 */

const at = (q: number, r: number): HexCoord => ({ q, r });

/** Every hex a unit could stand on and aim from. */
const arenaHexes = (): HexCoord[] => {
  const out: HexCoord[] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -5; r <= 5; r++) if (inArena(at(q, r))) out.push(at(q, r));
  }
  return out;
};

/**
 * The most bodies this depth can catch, over every place the caster could stand
 * and every hex it could aim at.
 *
 * Best case rather than average, because a player aims: the interesting number
 * is what the skill is worth when used well, which is what it will be balanced
 * against in practice.
 */
function bestHits(depth: number, targets: HexCoord[]): number {
  const occupied = new Set(targets.map(hexKey));
  let best = 0;
  for (const caster of arenaHexes()) {
    if (occupied.has(hexKey(caster))) continue;
    for (const aim of arenaHexes()) {
      if (aim.q === caster.q && aim.r === caster.r) continue;
      const hit = arcHexes({ aoeRadius: depth }, caster, aim)
        .filter((h) => occupied.has(hexKey(h))).length;
      if (hit > best) best = hit;
    }
  }
  return best;
}

describe('what an arc catches', () => {
  /**
   * The measurement the generous retune was signed off against.
   *
   * Against a five-body warband at best aim, area and bodies come apart sharply:
   *
   * | shape              | hexes | bodies |
   * |--------------------|-------|--------|
   * | old cone, range 2  |     4 |      2 |
   * | new arc, depth 2   |     8 |      3 |
   * | old cone, range 3  |     9 |      3 |
   * | new arc, depth 3   |    15 |      4 |
   *
   * So the footprints grew ×2.0 and ×1.67 while what they *catch* grew ×1.5 and
   * ×1.33 — the front rank was already inside the smaller wedge, and the extra
   * ground is mostly behind the fight. That gap is why the damage multipliers
   * were left where they are: pricing the change off area would have nerfed nine
   * skills against reach they cannot convert into targets, which is the opposite
   * of the point. What the growth *did* pay for is a cooldown on the two arcs
   * that had neither mana nor one — see the cost rules below.
   */
  it('scales sub-linearly in area against a real warband', () => {
    const enemies = generateEnemyPositions(5);
    const shallow = bestHits(2, enemies);
    const deep = bestHits(3, enemies);

    // A depth-2 wedge reaches the whole front rank of a spawned warband
    expect(shallow).toBe(3);
    expect(deep).toBe(4);
    // ...and going a hex deeper is worth well under the 15/8 the area suggests
    expect(deep / shallow).toBeLessThan(15 / 8);
  });

  /**
   * An arc must be worth pressing against the smallest fight in the game.
   *
   * Band 0 fields two bodies. A shape that catches one of them is a single
   * target attack with a worse multiplier, which is what several of these
   * effectively were: the old four-hex rhombus lay along a diagonal and
   * routinely covered exactly one of two adjacent spawns.
   */
  it('catches both bodies of the smallest encounter', () => {
    expect(bestHits(2, generateEnemyPositions(2))).toBe(2);
  });

  /**
   * The other side of the same coin: an arc aimed into the party must be able to
   * catch more than one hero, or the enemy arcs are not a threat worth
   * positioning against.
   */
  it('threatens a spread party from the enemy side', () => {
    expect(bestHits(3, generatePlayerPositions(4))).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The cost rules, restated over *every* arc rather than only the mastery ones.
 *
 * `masteryData.test.ts` owns the tree's own version of this and only sees
 * `MASTERY_SKILLS`. The shape change made the footprint legible to it for the
 * first time — a `Cone`'s extent lived in `range`, so `aoeRadius` was unset and
 * every cone in the game slipped through the "large area skills are limited"
 * check untested. It caught `throwing_blades` immediately, which is the argument
 * for widening the same rule to the shared and boss skills here.
 */
describe('arcs are limited like every other area skill', () => {
  const allArcs: HeroSkill[] = [
    ...Object.values(skillData).filter(
      (s): s is HeroSkill =>
        typeof s === 'object' && s !== null && 'targetType' in s,
    ),
    ...MASTERY_SKILLS,
    imperialCleave,
  ].filter((s) => s.targetType === SkillTargetType.Arc);

  it('finds every arc the game fields', () => {
    // Ten, and a floor rather than an equality: adding one should not fail this,
    // losing one silently should.
    expect(allArcs.length).toBeGreaterThanOrEqual(10);
  });

  it('states a depth on all of them', () => {
    expect(allArcs.filter((s) => s.aoeRadius === undefined).map((s) => s.id)).toEqual([]);
  });

  /**
   * Depth 3 is the deepest anything ships at, for the reason `arcAim.test.ts`
   * measures: the arena is 7 wide against 11 deep, so a depth-4 wedge only opens
   * fully from a minority of positions and would deliver its tuned footprint
   * inconsistently.
   */
  it('keeps every arc inside the depth the arena can deliver', () => {
    expect(allArcs.filter((s) => (s.aoeRadius ?? 0) > 3).map((s) => s.id)).toEqual([]);
  });

  /**
   * **Every arc waits, whoever is casting it — and that includes the bosses.**
   *
   * The tree's own version of this rule exempts nothing but never saw a cone,
   * because `aoeRadius` was unset on all of them. Widened here to the shared and
   * boss skills for one measured reason: `enemyAI` scores in expected damage, so
   * an unlimited AoE beats its owner's single-target skill on literally every
   * turn. A boss holding a free depth-3 arc does not have two moves, it has one,
   * and the second is decoration — which is exactly what the Emerald Dragon was
   * until the footprint change made the cost of it obvious.
   *
   * Mana cannot be the limiter on that side (enemies are built `maxMana: 0`), so
   * for them the cooldown is the only lever there is.
   */
  it('limits every arc with mana or a cooldown', () => {
    const unlimited = allArcs
      .filter((s) => s.manaCost === 0 && !s.cooldown && !BASIC_ARCS.includes(s.id))
      .map((s) => s.id);
    expect(unlimited).toEqual([]);
  });

  /**
   * **The two exceptions are attacks, not area skills an owner also has.**
   *
   * The frozen-north plan gives the Herd-Khan and the Glacier Colossus a
   * three-hex frontal swing *as* their at-will, with no single-target attack
   * beside it — so the failure the rule above prevents, an arc beating its
   * owner's single-target skill on every turn, has no single-target skill to
   * beat. What keeps them from being the free depth-3 wedge the rule is really
   * about is held here: depth 1 (the hex swung at and its two neighbours), a
   * multiplier no larger than a plain swing's, and only an elite pressing one.
   */
  const BASIC_ARCS = ['glaive_sweep', 'glacier_hammer'];

  it('keeps the at-will arcs to one swing in front of an elite', () => {
    const named = allArcs.filter((s) => BASIC_ARCS.includes(s.id));
    expect(named.map((s) => s.id).sort()).toEqual([...BASIC_ARCS].sort());
    const wide = named.filter(
      (s) => s.aoeRadius !== 1 || s.range !== 1 || (s.damage ?? 0) > skillData.slash.damage!,
    );
    expect(wide.map((s) => s.id)).toEqual([]);
    const fielders = enemyTemplates.filter((t) => t.skills.some((s) => BASIC_ARCS.includes(s.id)));
    expect(fielders.filter((t) => t.tier !== 'elite').map((t) => t.id)).toEqual([]);
    expect(fielders.length).toBeGreaterThan(0);
  });
});
