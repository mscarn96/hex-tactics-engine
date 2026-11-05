import { HeroStats, MasteryId } from '@/models/types';

/**
 * Extra stats per level, per mastery path, on top of the class's own growth.
 *
 * **This is where a class's three paths stop levelling identically.** Growth was
 * a property of the hero *template* alone, so a Bulwark, a Templar and a
 * Berserker each gained the same +15 HP / +3 attack / +2 defence every level and
 * the only thing separating them was which nodes they had bought. A Pyromancer
 * and a Hydromancer were likewise the same body in different colours.
 *
 * **A table of its own rather than a field on `MasteryPath`,** because
 * `data/skills/trees/*.ts` is generated from the private project notes — a
 * property hand-added to a generated file survives exactly until the next
 * regeneration. Keyed by `MasteryId` so `masteryGrowth.test.ts` can require an
 * entry for every path in `MASTERY_PATHS`; a missing one is a path that quietly
 * levels like its two siblings, which is the whole thing this fixes.
 *
 * **Counted from `BALANCE.MASTERY_UNLOCK_LEVEL`, not from level 1** — see
 * `masteryPathGrowth`. The class table still carries the bulk of a hero's body;
 * these are the tilt, which is why they are small. Fifteen levels at +4 HP is
 * +60, against a Champion's own +840 over the same stretch.
 *
 * Authored at final value and deliberately **outside** `BALANCE.HERO_GROWTH_SCALE`:
 * that knob exists to lift the class tables, which were written long before it,
 * and applying it here too would mean tuning one number by way of another.
 */
export const MASTERY_GROWTH: Record<MasteryId, Partial<HeroStats>> = {
  // ── Champion ────────────────────────────────────────────────────────────────
  /**
   * The wall. Everything it does is measured in what it can stand in front of.
   * The negative attack is deliberate: the sheet showed a protector hitting as hard
   * as a Templar on top of a warhammer. Measured with each path's starter weapons
   * (attack, before / after): L10 50 / 45, L20 86 / 71, L30 119 / 94,
   * against Templar 52 / 89 / 122 and Berserker 61 / 110 / 143. The playtest of
   * 2026-10-14 still found its Attack too high, so the tilt is −2: L20 about 56.
   */
  bulwark: { maxHp: 5, defense: 1, attack: -2 },
  /** Holy weight behind a steady line — durable, but paying for it in magic. */
  templar: { maxHp: 3, defense: 1, magic: 1 },
  /** Two blades, no shield: the health is a resource the path spends. */
  berserker: { maxHp: 3, attack: 1 },

  // ── Arcanist ────────────────────────────────────────────────────────────────
  /** Burn everything. The mana is the fuel the whole path is priced against. */
  pyromancer: { magic: 1, maxMana: 3 },
  /** Ice as control and as armour — the Arcanist that expects to be reached. */
  hydromancer: { magic: 1, maxHp: 3 },
  /** Tempo: the storm rewards acting again, so speed is the second axis. */
  stormcaller: { magic: 1, speed: 1 },

  // ── Druid ───────────────────────────────────────────────────────────────────
  /** The mending hand. Output and the pool to keep paying for it. */
  lifewarden: { magic: 1, maxMana: 3 },
  /** Stone: shields others and outlasts everything on its own account. */
  stoneshaper: { maxHp: 4, defense: 1 },
  /** The beast is bought with a body, and the shapes scale off both axes. */
  wildshape: { maxHp: 4, attack: 1 },

  // ── Hunter ──────────────────────────────────────────────────────────────────
  /**
   * Range and the crit build. Crit is the Marksman's identity rather than a stat
   * it happens to like — Follow-Through turns a critical kill into a free turn,
   * which is what makes its stat nodes and its Rapid Fire window one build.
   *
   * `critChance` is a percentage and `getEffectiveStats` folds it onto
   * `BALANCE.BASE_CRIT_CHANCE` rather than replacing it, the same way a crit node
   * does — so this is +15 points on top of the floor by the cap, not a flat 15%.
   */
  marksman: { attack: 1, critChance: 1 },
  /** Thrown steel at a spear's length: closer in, so it carries more body. */
  skirmisher: { attack: 1, maxHp: 3 },
  /** Poison and the dark: it has to *be* there, and then it has to leave. */
  /**
   * Was `{ attack: 1, speed: 1 }`. Speed past `TEMPO_FULL_EDGE` over the foes buys no
   * more bonus-turn chance, and the Hunter's own growth plus this tilt put a gearless
   * Shadowblade over that line by the level cap, which left both its speed nodes
   * buying nothing. The tilt is attack alone now (`speedCurve.test.ts` pins it).
   */
  shadowblade: { attack: 2 },

  // ── Monk ────────────────────────────────────────────────────────────────────
  /**
   * The blade dancer: it reaps what it cuts and keeps moving, so the tilt is the
   * blow and the step (the private project notes, "The base class"). No flat HP —
   * the Monk's body grows through its class growth alone.
   */
  mantis: { attack: 1, speed: 1 },
  /**
   * The support that heals by hurting: Glowmote's bolt and its mote both scale off
   * Magic, so the tilt is all Magic (the private project notes, "The base class").
   * No path growth adds flat HP to a Monk.
   */
  firefly: { magic: 2 },
  /**
   * The shell. Both defences, never flat HP (the private project notes, "The
   * base class"): the Beetle's Barriers are a factor of these two, so its growth
   * is also how its protection grows. Doubled from +1 each by the playtest of
   * 2026-10-22 (PT-04): the bodyguard read too soft; verify in playtest.
   */
  beetle: { defense: 2, magicDefense: 2 },
};
