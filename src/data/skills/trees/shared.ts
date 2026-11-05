import { MasteryNode, MasteryTier, SkillId } from '@/models/types';

/**
 * The constructors the twelve mastery paths are built from.
 *
 * **This file and `mantis.ts` are hand-written; the six beside them are not.**
 * `champion.ts`, `arcanist.ts`, `druid.ts`, `hunter.ts`, `firefly.ts` and
 * `beetle.ts` are generated from the private project notes by
 * `scripts/mastery-trees.mjs` (`npm run mastery:build`), and the mastery editor
 * imports and exports the draft — so a hand edit in one of those six fails
 * `masteryLab.test.ts`, and a node's *shape* is changed here while its *content*
 * is changed in the draft.
 *
 * The generated files carry nothing but imports and a banner, which is why the
 * trees are documented here rather than in any of them.
 *
 * Every path is a 5 → 4 → 3 main pyramid (`MASTERY_TIER_WIDTH`) plus two side
 * trees hanging off its capstones — 18 nodes, and 26 for Wildshape, which
 * declares its own `tierWidths`. Prerequisites in the pyramid are **derived
 * from `column`**, so nothing below authors an edge table.
 *
 * The shape is the balance, and it is measured rather than asserted: the
 * cheapest closure to a capstone is 6 points on all twelve paths, and capstone
 * plus raising it plus a whole side tree is exactly the 15 a hero ever earns.
 * `treeEconomy.test.ts` owns both numbers. Nothing here needs balancing against
 * what a player can afford — the budget does that.
 *
 * Two authoring rules:
 *
 * 1. **Every tier carries the path's identity.** A player buying the obvious
 *    nodes should end up playing the fantasy on the tin, not drifting into a
 *    generic stat block. The Bulwark has a taunt-facing node in every tier for
 *    exactly this reason.
 * 2. **Character comes from combination, not invention.** Passives are drawn
 *    from those in `systems/combat/passives.ts`; nodes that want genuinely new
 *    behaviour get a skill instead.
 */

/**
 * Every node costs one point, at every tier.
 *
 * It used to be 1 / 2 / 5, and that 5 *was* the one-capstone rule: the cheapest
 * second capstone came to 20 against a 15-point budget, so two were unreachable
 * by arithmetic. With a flat cost that argument is gone, and the rule is stated
 * directly instead — the three tier-3 nodes of every path share
 * `exclusiveGroup: 'capstone'` and lock each other out.
 *
 * What the flat cost buys is the thing the old table could not express: a node
 * is a **rank**, not a switch. Each holds `NODE_MAX_LEVEL` levels and each level
 * is its own point, so the 15-point budget is spent on *how deep* as much as on
 * *how wide* — which is the whole shape of the v3 trees.
 */
const TIER_COST = { 1: 1, 2: 1, 3: 1, 4: 1 } as const;

type NodeGrants = Partial<Omit<MasteryNode, 'id' | 'name' | 'description' | 'tier' | 'cost'>>;

/**
 * Terse node constructors — the tables below are long enough without ceremony.
 *
 * A node carries ids only: its name and description are read from the class's
 * catalog namespace (`masteryNodeName`, `masteryNodeDescription`). The second
 * form, words passed inline, is for a tree whose text has not moved into the
 * catalogs yet and goes once every tree has.
 */
export function node(tier: MasteryTier, column: number, id: string, grants: NodeGrants): MasteryNode;
export function node(
  tier: MasteryTier, column: number, id: string, name: string, description: string, grants: NodeGrants,
): MasteryNode;
export function node(
  tier: MasteryTier, column: number, id: string, ...rest: [NodeGrants] | [string, string, NodeGrants]
): MasteryNode {
  if (rest.length === 1) return { id, tier, column, cost: TIER_COST[tier], ...rest[0] };
  const [name, description, grants] = rest;
  return { id, name, description, tier, column, cost: TIER_COST[tier], ...grants };
}

// ─── Wildshape's own constructors ─────────────────────────────────────────────
//
// Only this path branches, so the shapes below stay local to it rather than
// joining the vocabulary every other tree has to be read against.

/** Costs, split out because the one-node-short arithmetic depends on all three. */
const FORM_COST = 1;
const BRANCH_SKILL_COST = 3;
const BRANCH_TALENT_COST = 2;
export const APEX_COST = 6;

/** Cell positions: each shape sits over the four nodes that hang off it. */
const BRANCH_X = (column: number) => column;
const FORM_X = (slot: number) => slot * 4 + 1.5;

export const formNode = (
  slot: number,
  id: string,
  name: string,
  grantsSkill: SkillId,
  description: string,
): MasteryNode => ({
  id, name, description,
  tier: 1, column: slot, x: FORM_X(slot),
  cost: FORM_COST,
  grantsSkill,
  // One tag, three members: exclusivity declared once cannot be declared
  // asymmetrically, which is the failure that would let a Druid be two animals.
  exclusiveGroup: 'shape',
});

export const branch = (
  column: number,
  id: string,
  name: string,
  form: string,
  description: string,
  cost: number,
  grants: Partial<MasteryNode>,
): MasteryNode => ({
  id, name, description,
  tier: 2, column, x: BRANCH_X(column),
  cost,
  requires: [form],
  ...grants,
});

export const branchSkill = (
  column: number, id: string, name: string, form: string,
  grantsSkill: SkillId, description: string,
): MasteryNode =>
  branch(column, id, name, form, description, BRANCH_SKILL_COST, { grantsSkill });

export const branchTalent = (
  column: number, id: string, name: string, form: string,
  description: string, grants: Partial<MasteryNode>,
): MasteryNode =>
  branch(column, id, name, form, description, BRANCH_TALENT_COST, grants);

/**
 * Every branch node, which is what Apex asks two of.
 *
 * Listed by id rather than derived from `tier === 2` because it is consumed
 * while the path object is still being built — and naming them is also what
 * makes the gate readable at the node.
 */
export const BRANCH_NODE_IDS = [
  'wild_bear_slam', 'wild_bear_hibernate', 'wild_bear_bristling', 'wild_bear_bulk',
  'wild_wolf_throat', 'wild_wolf_howl', 'wild_wolf_bloodscent', 'wild_wolf_savagery',
  'wild_hawk_screech', 'wild_hawk_cyclone', 'wild_hawk_momentum', 'wild_hawk_evasion',
] as const;

// ═══ CHAMPION ═══════════════════════════════════════════════════════════════
