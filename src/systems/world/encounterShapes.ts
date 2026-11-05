import { ThreatBand, THREAT_BANDS, threatEliteCount, threatEncounterSize } from "@/systems/world/threat";
import { EnemyRole, Faction, fieldsDistinctly, membersForRole, roams } from "@/data/templates/factions";
import type { EnemyTemplateId } from "@/models/types";
import { t } from "@/i18n";

/**
 * How a warband is arranged, and which arrangements a band offers.
 *
 * Split out of `encounterGenerator` rather than living beside the composer, and
 * the reason is a cycle rather than tidiness. `questHints` has to answer "at
 * which bands can this template actually turn up", and the only honest answer is
 * the one this table gives — but `encounterGenerator` imports `questEvents` for
 * `huntedTemplates()`, and `questEvents` imports `questHints`. A hint reaching
 * back for the composer would close
 * `questHints → encounterGenerator → questEvents → questHints`, which Metro
 * allows, warns about, and then hands somebody an `undefined` binding a long way
 * from the cause. `importCycles.test.ts` exists for exactly that.
 *
 * So the table sits below both. `encounterGenerator` re-exports everything here
 * so no existing caller has to know it moved.
 */

/**
 * One way a warband can be put together.
 *
 * Roles rather than templates: the faction resolves each slot from its own
 * roster, so one table describes every faction's escalation. Elites lead so the
 * dangerous thing is at the front of the turn order.
 */
export type ShapeId =
  | 'pack' | 'patrol' | 'skirmish' | 'warband' | 'hunting_party' | 'ambush'
  | 'vanguard' | 'skirmish_line' | 'raid' | 'phalanx' | 'storm';

/** A shape's name for the encounter banner, in the current language. */
export function shapeName(id: ShapeId): string {
  return t(`worldEvents.shape.${id}`);
}

export interface EncounterShape {
  /**
   * Stable id. Read by the encounter banner and pinned by tests. Its name is
   * `shapeName(id)`, from the `worldEvents` catalog: named for the tactic, never
   * for the units. A shape is resolved through `membersForRole`, so the same
   * `caster` slot is a Goblin Shaman for one faction and a Brigand Archer for
   * another. A name like "witch circle" would be a lie the moment the second
   * faction rolled it.
   */
  id: ShapeId;
  /** The spine. Its length is the encounter's size — see `SHAPES`. */
  roles: EnemyRole[];
  /**
   * Roles that must resolve to something other than this faction's front line
   * before the shape may be rolled. Without it a "skirmish" is three identical
   * wolves whenever Beasts come up. See `fieldsDistinctly`.
   */
  requires?: EnemyRole[];
  /** Relative weight within the band. Defaults to 1. */
  weight?: number;
}

/**
 * Every shape a band can produce.
 *
 * This replaced a single `EnemyRole[]` per band, which meant band 0 had three
 * possible fights in the entire game and band 4 had one. The roster did not
 * change; what changed is that the same roster is now asked for several
 * different arrangements of itself.
 *
 * Two invariants hold across the whole table, both pinned by `factions.test.ts`
 * rather than by review:
 *
 * - **`roles.length` equals `threatEncounterSize(band)`** (2, 2, 3, 4, 5). Size
 *   is not a per-shape knob. More bodies is more actions per round against a
 *   fixed party, so a "swarm" shape is a difficulty *increase* wearing the word
 *   "weaker" — and at bands 3–4 it cannot even be delivered, because the Coven
 *   and the Legion have no chaff and it would resolve to Thralls and Infantry.
 * - **The elite count equals `threatEliteCount(band)`** (0, 0, 1, 2, 2). Elite
 *   weight is nearly flat across bands, so how many elite slots a fight has is
 *   almost the whole difficulty curve. Pin that and no shape roll can invert it.
 *
 * Band 0 is deliberately a single shape, and that is a wall rather than a gap in
 * the table. The game hands you **one** hero at level 1: two Footpads leave a
 * level-1 Arcanist 6.7 rounds against the survivability bar of 6, and three
 * leave 4.4. Two Goblin Spearthrowers leave 4.2. A `front` slot admits the Orc
 * Grunt, which `homeRing.test.ts` exists to memorialise as unwinnable, and the
 * wolves carry passives the home ring forbids. There is exactly one legal
 * arrangement of band 0 and this is it.
 */
const SHAPES: Record<ThreatBand, EncounterShape[]> = {
  0: [
    { id: 'pack', roles: ['chaff', 'chaff'] },
  ],
  1: [
    // The first elite still waits until band 2. Meeting a Cave Bear at 140 HP
    // one ring out from home was a cliff rather than a ramp.
    { id: 'patrol', roles: ['front', 'chaff'], weight: 2 },
    { id: 'skirmish', roles: ['ranged', 'chaff'], requires: ['ranged'] },
  ],
  2: [
    // The caster arrives before the second body: a warband that can debuff is a
    // harder problem than one more sword, and that is the step to feel.
    { id: 'warband', roles: ['elite', 'front', 'caster'], weight: 2 },
    { id: 'hunting_party', roles: ['elite', 'front', 'ranged'], requires: ['ranged'] },
    { id: 'ambush', roles: ['elite', 'chaff', 'chaff'], requires: ['chaff'] },
  ],
  // One body more from band 3 (`THREAT_LATE_EXTRA_ENEMIES`, playtest 2026-10-14),
  // and shapes that call on the support roles, so a faction with chaff and a
  // ranged line — the Hoarfrost's Motes and Shardcasters — fields them.
  3: [
    { id: 'warband', roles: ['elite', 'elite', 'front', 'caster'], weight: 2 },
    { id: 'vanguard', roles: ['elite', 'elite', 'front', 'front'] },
    { id: 'skirmish_line', roles: ['elite', 'elite', 'ranged', 'front'], requires: ['ranged'] },
    { id: 'raid', roles: ['elite', 'elite', 'caster', 'chaff'], requires: ['caster', 'chaff'] },
  ],
  4: [
    { id: 'warband', roles: ['elite', 'elite', 'front', 'caster', 'front'], weight: 2 },
    { id: 'phalanx', roles: ['elite', 'elite', 'front', 'front', 'caster'] },
    { id: 'storm', roles: ['elite', 'elite', 'caster', 'ranged', 'chaff'], requires: ['ranged', 'chaff'], weight: 2 },
  ],
};

/** The shapes this faction is allowed to be arranged into at this band. */
export function shapesFor(band: ThreatBand, faction: Faction): EncounterShape[] {
  return SHAPES[band].filter(
    (s) => (s.requires ?? []).every((role) => fieldsDistinctly(faction, role, s.id)),
  );
}

/** Every shape defined for a band, whoever can field it. For tests and tooling. */
export function shapesAtBand(band: ThreatBand): EncounterShape[] {
  return SHAPES[band];
}

/**
 * The bands at which this faction can actually put one of these templates on the
 * board.
 *
 * **Not the faction's `threatRange`, and the difference is a shipped bug.** The
 * range says where the faction turns up; it says nothing about which of its
 * members turn up there, because that is decided one layer down by the shape
 * table. Greenskins run bands 0–2, but band 0 has exactly one shape — `pack`,
 * two `chaff` — and Greenskin chaff is the Goblin Whelp alone. An Orc Grunt is
 * `front`, so it can never appear in Home Reach.
 *
 * The Goblin Tithe asks for two Orc Grunts, and `huntGround` read the range
 * directly: the log told the player to look in Home Reach, and the map painted
 * it. That is worse than no hint at all — it is a search of ground the quarry
 * provably is not on, which is the exact failure the whole module was written to
 * stop.
 *
 * Everything is asked through `membersForRole` and `shapesFor`, so both of the
 * composer's own indirections are honoured: a faction that leaves a role empty
 * fills it from the fallback chain (Beasts field wolves as shooters), and a
 * shape whose `requires` the faction cannot satisfy is never rolled and so never
 * contributes a band.
 *
 * The answer is a **list rather than a window** because it need not be
 * contiguous — a template that is only ever `chaff` is fielded at bands 0–2 and
 * again at 2 via `ambush`, but a role that vanishes from the middle of a
 * faction's range would leave a hole, and reporting a hole as a range would put
 * the paint back on ground nothing walks.
 */
export function bandsFielding(
  faction: Faction,
  wanted: ReadonlySet<string>,
): ThreatBand[] {
  // A lair-only faction is never met on open ground, so there is no band of it
  // to paint — the hint for its quarry is the lair, which is not this module's.
  if (!roams(faction)) return [];
  const [low, high] = faction.threatRange;
  const standIns = huntStandIns(faction, wanted).length > 0;
  return THREAT_BANDS.filter((band) => {
    if (band < low || band > high) return false;
    return shapesFor(band, faction).some((shape) =>
      (standIns && shape.roles.includes('chaff'))
      || shape.roles.some((role) =>
        membersForRole(faction, role, shape.id).some((member) => wanted.has(member)),
      ),
    );
  });
}

/**
 * The hunted members a hunt fight may stand in a `chaff` slot when no shape of
 * the band fields them: the faction's own shooters and casters.
 *
 * Playtest PT-09: What the Reeds Hide asks for Reed Stalkers or Silt Speakers,
 * and band 0's only shape is two chaff, so on the swamp nearest the city the
 * quarry could not stand at all and band 1 fielded it one roll in four. A hunt
 * fight there trades one Fen Spawn for one of them instead. Only the support
 * roles: a `front` or `elite` stand-in is the Orc Grunt the home ring was built
 * to keep out (`homeRing.test.ts`), and one shooter beside one chaff stays a
 * two-body fight with no elite, inside the band's own budget.
 *
 * Read by `bandsFielding`, so the quest hint paints the bands this opens, and by
 * the composer's hunt path (`standInHuntPlans`), which is the only place a
 * stand-in is fielded — a fight nobody is hunting anything in never gets one.
 */
export function huntStandIns(faction: Faction, wanted: ReadonlySet<string>): EnemyTemplateId[] {
  return [...faction.roles.ranged, ...faction.roles.caster].filter((m) => wanted.has(m));
}

/**
 * What is wrong with a shape, as a list of sentences. Empty means it is legal.
 *
 * This is where `threatEncounterSize` and `threatEliteCount` become load-bearing
 * rather than decorative — `threatEliteCount` had no caller at all and was
 * quietly returning exactly the elite counts the old table happened to use,
 * which is the same thing as not existing. The table answers to these two
 * functions now, so retuning the curve is one edit in `threat.ts` and a failing
 * test naming every shape that no longer fits, rather than a silent drift.
 */
export function shapeViolations(band: ThreatBand, shape: EncounterShape): string[] {
  const out: string[] = [];
  const size = threatEncounterSize(band);
  if (shape.roles.length !== size) {
    out.push(`${shape.id} at band ${band} fields ${shape.roles.length}, want ${size}`); // i18n-exempt: table check for the suite
  }
  const elites = shape.roles.filter((r) => r === 'elite').length;
  const wantElites = threatEliteCount(band);
  if (elites !== wantElites) {
    out.push(`${shape.id} at band ${band} has ${elites} elites, want ${wantElites}`); // i18n-exempt: table check for the suite
  }
  return out;
}
