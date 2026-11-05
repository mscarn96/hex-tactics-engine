import { HexCoord, SkillTargetType } from '@/models/types';
import { getSkillTargets } from '@/systems/combat/targeting';
import { arenaHexes, inArena } from '@/systems/combat/arenaGeometry';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { makeSkill } from '../support/fixtures';
import { BALANCE } from '@/data/balanceConstants';

/**
 * The four mechanics the v3 trees needed that the game could not already do.
 *
 * Everything else the rework added is a new arrangement of existing fields; these
 * four are new *rules*, and each one is a place a skill can silently do nothing —
 * a shape nothing resolves, a flag nothing reads, a summon that resolves to the
 * wrong creature.
 */

const at = (q: number, r: number): HexCoord => ({ q, r });
const key = (h: HexCoord) => `${h.q},${h.r}`;
// Both pools: a tree node may grant a shared skill (`meteor`, `divine_light`)
// as readily as a path-exclusive one.
const skillById = new Map([...ALL_SKILLS, ...MASTERY_SKILLS].map((s) => [s.id, s]));

describe('the cross shape', () => {
  const cross = (radius: number) =>
    getSkillTargets(
      makeSkill({ targetType: SkillTargetType.Cross, range: 3, aoeRadius: radius }),
      at(0, 0),
      at(0, 0),
      [],
    );

  /**
   * Four arms and two gaps. The gaps are the whole reason it is not a Ring:
   * they are what make aiming at the middle of a formation the right play
   * rather than aiming at whatever stands nearest.
   */
  it('covers four arms and leaves the diagonals between them alone', () => {
    const hit = new Set(cross(2).map(key));
    expect(hit.has(key(at(0, 0)))).toBe(true);
    // The two axes are `HEX_DIRS[0]` (1,0) and `HEX_DIRS[2]` (0,-1) — two steps
    // apart in rotational order, so 120°, which is what leaves the gaps.
    for (const step of [1, 2]) {
      expect(hit.has(key(at(step, 0)))).toBe(true);
      expect(hit.has(key(at(-step, 0)))).toBe(true);
      expect(hit.has(key(at(0, -step)))).toBe(true);
      expect(hit.has(key(at(0, step)))).toBe(true);
    }
    // The two neighbours lying in the gaps between the arms
    expect(hit.has(key(at(1, -1)))).toBe(false);
    expect(hit.has(key(at(-1, 1)))).toBe(false);
  });

  it('counts each hex once, however the arms overlap at the centre', () => {
    const hexes = cross(3);
    expect(new Set(hexes.map(key)).size).toBe(hexes.length);
    // Centre plus four arms of `radius`
    expect(hexes).toHaveLength(1 + 4 * 3);
  });

  it('grows only with its radius, never with its range', () => {
    expect(cross(1)).toHaveLength(5);
    expect(cross(2)).toHaveLength(9);
  });
});

describe('a random-strike skill', () => {
  const skyfall = skillById.get('skyfall')!;

  // Playtest 2026-10-17, PT-18: aimed at an area, the strikes random inside it
  it('is authored as random enemies inside an aimed area, within a limited range', () => {
    expect(skyfall.randomEnemies).toBeGreaterThan(1);
    expect(skyfall.targetType).toBe(SkillTargetType.Ring);
    expect(skyfall.range).toBe(BALANCE.SKYFALL_RANGE);
    expect(skyfall.aoeRadius).toBe(BALANCE.SKYFALL_RADIUS);
  });

  /**
   * The board its reach is drawn over is `inArena`'s, not a second copy of the
   * two constants.
   */
  it('reaches over exactly the hexes the arena is made of', () => {
    const board = arenaHexes();
    expect(board.length).toBeGreaterThan(0);
    expect(board.every(inArena)).toBe(true);
    // Nothing legal is missing: the bounding box minus what `inArena` refuses
    let legal = 0;
    for (let q = -10; q <= 10; q++) for (let r = -10; r <= 10; r++) if (inArena(at(q, r))) legal++;
    expect(board).toHaveLength(legal);
  });
});

describe('a free action', () => {
  /**
   * Exactly one skill in the game leaves the turn unspent, and it stays that way
   * by test rather than by hope: `freeAction` bypasses the one-action-per-turn
   * rule the whole combat model rests on, so a second one is a design decision
   * and not a field somebody set.
   */
  // Primal Surge (Wildshape remaster) is the second: its extra action is the cast not spending the turn.
  // Disengage is the third (playtest 2026-10-08): the Hunter breaks away and still acts.
  // Lantern Glide is the fourth (the Firefly, Monk): a blink that heals where it lands, and the
  // turn's action is still the bolt.
  it('is carried by Reposition, Primal Surge, Disengage and Lantern Glide and nothing else', () => {
    const free = [...ALL_SKILLS, ...MASTERY_SKILLS].filter((s) => s.freeAction).map((s) => s.id).sort();
    expect(free).toEqual(['disengage', 'lantern_glide', 'primal_surge', 'reposition']);
  });

  it('still charges mana and a cooldown, because only the turn is free', () => {
    const reposition = skillById.get('reposition')!;
    expect(reposition.manaCost).toBeGreaterThan(0);
    expect(reposition.cooldown).toBeGreaterThan(0);
  });
});

describe('self-damage', () => {
  it('is flat, so raising the node cannot shrink the price', () => {
    const bloodPrice = skillById.get('blood_price')!;
    expect(bloodPrice.selfDamage).toBeGreaterThan(0);
    // A fraction would scale with the caster and quietly stop being a cost on
    // a Berserker with gear; `selfDamage` is deliberately absolute.
    expect(Number.isInteger(bloodPrice.selfDamage)).toBe(true);
  });
});

describe('every skill the new trees grant', () => {
  /**
   * The failure this catches is silent by construction: `deriveHeroSkills` skips
   * an id it cannot resolve, so a node naming a skill that does not exist is a
   * node that costs a point and hands over nothing.
   */
  it('actually exists', () => {
    const missing: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const node of path.nodes) {
        if (node.grantsSkill && !skillById.has(node.grantsSkill)) {
          missing.push(`${path.id}/${node.id}: ${node.grantsSkill}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
