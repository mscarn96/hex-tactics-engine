import { AfflictionType, AuraType, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import type { ArenaHazard, PreparedAttack, PreparedReaction, ScriptedWarning } from '@/models/units';
import { STATUS_DISPLAY } from '@/data/display/statusDisplay';
import { BOARD_HIGHLIGHTS } from '@/data/display/voxelTheme';
import { CORAL_KIND, POWDER_LOOK, REDSAIL_LANE, TIDE_KIND, VARR_FIRE } from '@/data/display/archipelagoEffects';
import { deathBurstOf } from '@/data/templates/summonTemplates';
import { warningToneFor, type WarningTone } from '@/systems/combat/bossPhaseCard';
import { duelHexes } from '@/systems/combat/factionEliteKits';
import { landingPlan, previewPrepared, shelteredHexes, warnedPushes } from '@/systems/combat/preparedAttacks';
import { heartBurstDrawn } from '@/systems/combat/dragonScript';
import { hasFacing, hexesBehind } from '@/systems/combat/facing';
import { blinksInBehind } from '@/systems/combat/mantis';
import { inArena } from '@/systems/combat/arenaGeometry';
import { getHexesInRange, getNeighbors, hexDistance } from '@/utils/hexUtils';
import { BLACK_GLASS_KIND } from '@/systems/combat/bossScript';

/**
 * What the board draws over the ground, as pure functions of the units, the
 * hazards and the prepared attacks.
 *
 * `CombatScene` memoises each one on the inputs it actually reads, so a change
 * to the units does not rebuild the hexes only a hazard decides. `boardOverlays`
 * is all of them at once, for a test or a capture that wants the whole picture.
 */

const hexKey = (h: HexCoord) => `${h.q},${h.r}`;

/** Warnings drawn in their kind's tone whoever casts them. */
const SCRIPTED_TONES: Partial<Record<ScriptedWarning, WarningTone>> = {
  // Jadeveil: Kairen's lightning marks are drawn cold, apart from the violet of his warned moves
  kairen_storm: 'frost',
  // The archipelago: Varr's lanes in his own yellow, the Redsail ship's in signal red, the storm deck cold
  varr_lane: 'varr',
  gunner_lane: 'redsail',
  deck_storm: 'frost',
  deck_wave: 'frost',
};
const casterTone = (p: PreparedAttack, units: CombatUnit[]) =>
  (p.scripted && SCRIPTED_TONES[p.scripted]) || (warningToneFor(units.find((u) => u.id === p.casterId)?.templateId) ?? '');

/** A cannon lane, drawn by `LaneMarks` with its chevrons rather than as a plain footprint. */
export const isLane = (p: Pick<PreparedAttack, 'scripted'>): boolean => p.scripted === 'varr_lane' || p.scripted === 'gunner_lane';

/**
 * Each hex once, grouped by a boss's warning colour: the default violet, or its own.
 * A hex the warning's shelter spares (`PreparedSpec.shelter`) is not struck and is left out;
 * `shelterGroups` draws it apart. Cannon lanes are left to `laneGroups`.
 */
export function warnedGroups(prepared: PreparedAttack[], units: CombatUnit[], hazards: ArenaHazard[] = []) {
  const groups = new Map<string, Map<string, HexCoord>>();
  for (const p of prepared) {
    if (isLane(p)) continue;
    // A carried Heart's burst is drawn round its carrier only when it is near (`heartBurstDrawn`)
    if (p.spec.carried && !heartBurstDrawn(p, units)) continue;
    const colour = casterTone(p, units);
    const seen = groups.get(colour) ?? new Map<string, HexCoord>();
    const spared = new Set([...shelteredHexes(p, p.hexes, units, hazards), ...heldHexesOf(p, units, hazards)].map(hexKey));
    for (const h of p.hexes) if (!spared.has(hexKey(h))) seen.set(hexKey(h), h);
    groups.set(colour, seen);
  }
  return [...groups.entries()].map(([colour, hexes]) => ({
    tone: (colour || undefined) as WarningTone | undefined,
    hexes: [...hexes.values()],
  }));
}

/** Where a push will throw each body, as an arrow in the warning's tone. */
export function warnedPushGroups(prepared: PreparedAttack[], units: CombatUnit[], hazards: ArenaHazard[]) {
  const groups = new Map<string, { from: HexCoord; to: HexCoord }[]>();
  for (const p of prepared) {
    const tone = casterTone(p, units);
    groups.set(tone, [...(groups.get(tone) ?? []), ...warnedPushes(p, units, hazards)]);
  }
  return [...groups.entries()]
    .filter(([, pushes]) => pushes.length > 0)
    .map(([tone, pushes]) => ({ tone: (tone || undefined) as WarningTone | undefined, pushes }));
}

/**
 * Each cannon lane (Varr's, the Redsail ship's), grouped by tone, its hexes in the order they were
 * warned — from the gun outward — and the hex the shot comes from: the one before the first along
 * the lane's line, so a lane from a ship offshore comes in off the board's edge. `LaneMarks` flows
 * its chevrons from there.
 */
export function laneGroups(prepared: PreparedAttack[], units: CombatUnit[]) {
  const groups = new Map<string, { from: HexCoord; hexes: HexCoord[] }[]>();
  for (const p of prepared) {
    if (!isLane(p) || p.hexes.length === 0) continue;
    const tone = casterTone(p, units);
    const [first, second] = p.hexes;
    const from = second ? { q: 2 * first.q - second.q, r: 2 * first.r - second.r } : p.origin;
    groups.set(tone, [...(groups.get(tone) ?? []), { from, hexes: p.hexes }]);
  }
  return [...groups.entries()].map(([tone, lanes]) => ({ tone: (tone || undefined) as WarningTone | undefined, lanes }));
}

/** The storm deck's lightning marks, which crackle (`StormMarks`) over their warning until struck. */
export const stormHexes = (prepared: PreparedAttack[]) =>
  prepared.filter((p) => p.scripted === 'deck_storm').flatMap((p) => p.hexes);

/** A Siren's song: a strand from the singer to each living hero it holds, while she lives to sing. */
export function songTethers(prepared: PreparedAttack[], units: CombatUnit[]): [HexCoord, HexCoord][] {
  const out: [HexCoord, HexCoord][] = [];
  for (const p of prepared) {
    if (p.scripted !== 'siren_song') continue;
    const singer = units.find((u) => u.id === p.casterId);
    if (!singer || singer.currentHp <= 0) continue;
    for (const id of p.bound ?? []) {
      const hero = units.find((u) => u.id === id);
      if (hero && hero.currentHp > 0) out.push([singer.position, hero.position]);
    }
  }
  return out;
}

/** The hexes of the heroes holding their point behind a shield (`PreparedSpec.heldBy`: Crownfall). */
function heldHexesOf(p: PreparedAttack, units: CombatUnit[], hazards: ArenaHazard[]): HexCoord[] {
  if (!p.spec.heldBy) return [];
  const holders = new Set(landingPlan(p, units, hazards).holders ?? []);
  return units.filter((u) => holders.has(u.id)).map((u) => ({ q: u.position.q, r: u.position.r }));
}

/** The held points of every warning, drawn apart from the points that fall in full. */
export const heldGroupHexes = (prepared: PreparedAttack[], units: CombatUnit[], hazards: ArenaHazard[]) =>
  prepared.flatMap((p) => heldHexesOf(p, units, hazards));

/**
 * The footprint hexes a warning's shelter spares, drawn apart from the hexes it strikes, and where
 * each hero a body keeps off Kairen's Downdraft will stand (`PreparedPreview.windSheltered`).
 */
export const shelterGroupHexes = (prepared: PreparedAttack[], units: CombatUnit[], hazards: ArenaHazard[]) =>
  prepared.flatMap((p) => [...shelteredHexes(p, p.hexes, units, hazards), ...galeShelterHexes(p, units, hazards)]);

/** Where the heroes a body keeps off the Downdraft will stand once the Gale has blown. */
function galeShelterHexes(p: PreparedAttack, units: CombatUnit[], hazards: ArenaHazard[]): HexCoord[] {
  if (!p.wind) return [];
  const preview = previewPrepared(p, units, hazards);
  return preview.windSheltered.map((id) =>
    preview.landings.find((m) => m.unitId === id)?.to ?? units.find((u) => u.id === id)!.position);
}

/** The hexes an orb charge added to a warning. */
export const orbHexes = (prepared: PreparedAttack[]) => prepared.flatMap((p) => p.bonusHexes ?? []);
/** Where Skyfire will land. */
export const landingHexes = (prepared: PreparedAttack[]) => prepared.flatMap((p) => p.landing ?? []);
/** The vents of a warned Undermine. */
export const ventHexes = (prepared: PreparedAttack[]) => prepared.flatMap((p) => p.vents ?? []);

/** Each chain: the two heroes carrying Aethelred's Chained from the same source. */
export function chainPairs(units: CombatUnit[]): [HexCoord, HexCoord][] {
  const bySource = new Map<string, HexCoord[]>();
  for (const u of units) {
    if (u.currentHp <= 0) continue;
    const link = u.activeEffects.find((e) => e.type === AfflictionType.Chained);
    if (!link?.sourceUnitId) continue;
    bySource.set(link.sourceUnitId, [...(bySource.get(link.sourceUnitId) ?? []), u.position]);
  }
  return [...bySource.values()].filter((p) => p.length === 2) as [HexCoord, HexCoord][];
}

const hazardHexes = (hazards: ArenaHazard[], pick: (h: ArenaHazard) => unknown) =>
  hazards.filter((h) => pick(h)).flatMap((h) => h.hexes);

/** Ground a detonation left burning, or a Cinder Rift. */
export const burningHexes = (hazards: ArenaHazard[]) => hazardHexes(hazards, (h) => h.ignites || h.crossDamage !== undefined);
/**
 * Warren Collapse's rubble: solid ground (Crownfall's black glass and the Reef Titan's coral are
 * drawn apart, as `glassHexes` and `coralHexes`).
 */
export const rubbleHexes = (hazards: ArenaHazard[]) =>
  hazardHexes(hazards, (h) => h.solid && h.kind !== BLACK_GLASS_KIND && h.kind !== CORAL_KIND);
/** Crownfall's black glass: solid ground that lasts until the phase turns. */
export const glassHexes = (hazards: ArenaHazard[]) => hazardHexes(hazards, (h) => h.solid && h.kind === BLACK_GLASS_KIND);
/** The Heart of Winter's ice: ground that costs a movement point (the risen tide is drawn as water). */
export const iceHexes = (hazards: ArenaHazard[]) => hazardHexes(hazards, (h) => h.moveCost !== undefined && h.kind !== TIDE_KIND);
/** The Reef Titan's coral walls: solid ground grown from the reef (`CoralField`). */
export const coralHexes = (hazards: ArenaHazard[]) => hazardHexes(hazards, (h) => h.kind === CORAL_KIND);
/** The Drowned Queen's risen water (`TideField`). */
export const tideHexes = (hazards: ArenaHazard[]) => hazardHexes(hazards, (h) => h.kind === TIDE_KIND);

/**
 * How far each living powder cask will blow (a unit whose death burst is black powder,
 * `POWDER_LOOK.color`): the arena hexes inside its radius, each once, so the blast is forecast
 * before anybody strikes the cask.
 */
export function powderHexes(units: CombatUnit[], burstOf = deathBurstOf): HexCoord[] {
  const seen = new Map<string, HexCoord>();
  for (const u of units) {
    if (u.currentHp <= 0) continue;
    const burst = burstOf(u);
    if (burst?.color !== POWDER_LOOK.color) continue;
    for (const h of getHexesInRange(u.position, burst.radius)) if (inArena(h)) seen.set(hexKey(h), h);
  }
  return [...seen.values()];
}
/** Wild Sanctuary's living ground. */
export const sanctuaryHexes = (hazards: ArenaHazard[]) => hazardHexes(hazards, (h) => h.sanctuary);
/** Aftershock's marked Tremor ground. */
export const aftershockHexes = (hazards: ArenaHazard[]) => hazardHexes(hazards, (h) => h.aftershock);
/** Carapace Bastion's ground, where a struck ally's blow is split with the Beetle. */
export const bastionHexes = (hazards: ArenaHazard[]) => hazardHexes(hazards, (h) => h.bastion);
/** Firefly Motes waiting to be arrived on. */
export const moteHexes = (hazards: ArenaHazard[]) => hazardHexes(hazards, (h) => h.mote);

/** The Skirmisher's smoke clouds, drawn from each living caster's cover. */
export const smokeHexes = (units: CombatUnit[]) =>
  units.filter((u) => u.currentHp > 0)
    .flatMap((u) => u.activeEffects.filter((e) => e.type === AuraType.SmokeCover).flatMap((e) => e.zone ?? []));

/**
 * Shoulder to Shoulder's ring: the six hexes around each living unit wearing its
 * badge (`AuraType.ShoulderGuard`), on the board, each once. Drawn for the whole
 * fight, wherever the Beetle stands, so the player can see where to stand.
 */
export function shoulderHexes(units: CombatUnit[]): HexCoord[] {
  const seen = new Map<string, HexCoord>();
  for (const u of units) {
    if (u.currentHp <= 0 || !u.activeEffects.some((e) => e.type === AuraType.ShoulderGuard)) continue;
    for (const h of getNeighbors(u.position)) if (inArena(h)) seen.set(hexKey(h), h);
  }
  return [...seen.values()];
}

/**
 * Vengeful Shell's reach: every hex within its intercept range of each living owner
 * while the Reaction is prepared, so the player can see which allies it covers
 * (playtest 2026-10-30). Follows the Beetle as it moves; gone when it expires.
 */
export function interceptHexes(units: CombatUnit[], reactions: readonly PreparedReaction[]): HexCoord[] {
  const seen = new Map<string, HexCoord>();
  for (const reaction of reactions) {
    const trigger = reaction.spec.trigger;
    if (trigger.kind !== 'interceptAlly') continue;
    const owner = units.find((u) => u.id === reaction.ownerId);
    if (!owner || owner.currentHp <= 0) continue;
    for (const h of getHexesInRange(owner.position, trigger.reach)) {
      if (hexDistance(h, owner.position) > 0 && inArena(h)) seen.set(hexKey(h), h);
    }
  }
  return [...seen.values()];
}

/** The Rime Jarl's rune circle: each centre once. */
export function circleHexes(units: CombatUnit[], hazards: ArenaHazard[]): HexCoord[] {
  const seen = new Map<string, HexCoord>();
  for (const u of units) {
    const ring = u.currentHp > 0 ? (u.duel ?? u.challenge) : undefined;
    if (!ring) continue;
    for (const h of duelHexes(ring.centre, ring.radius, hazards)) seen.set(hexKey(h), h);
  }
  return [...seen.values()];
}

export function boardOverlays(units: CombatUnit[], hazards: ArenaHazard[], prepared: PreparedAttack[], reactions: readonly PreparedReaction[] = []) {
  return {
    warned: warnedGroups(prepared, units, hazards),
    sheltered: shelterGroupHexes(prepared, units, hazards),
    held: heldGroupHexes(prepared, units, hazards),
    warnedPushes: warnedPushGroups(prepared, units, hazards),
    orb: orbHexes(prepared),
    landing: landingHexes(prepared),
    vents: ventHexes(prepared),
    chains: chainPairs(units),
    burning: burningHexes(hazards),
    rubble: rubbleHexes(hazards),
    glass: glassHexes(hazards),
    ice: iceHexes(hazards),
    sanctuary: sanctuaryHexes(hazards),
    aftershock: aftershockHexes(hazards),
    bastion: bastionHexes(hazards),
    motes: moteHexes(hazards),
    smoke: smokeHexes(units),
    circle: circleHexes(units, hazards),
    intercept: interceptHexes(units, reactions),
    lanes: laneGroups(prepared, units),
    coral: coralHexes(hazards),
    tide: tideHexes(hazards),
    storm: stormHexes(prepared),
    songs: songTethers(prepared, units),
    powder: powderHexes(units),
  };
}

const WARNING_TONE_COLOUR: Record<WarningTone, string> = {
  crimson: '#c4122e', frost: '#5fd2ff', varr: VARR_FIRE, redsail: REDSAIL_LANE,
};
const GROUND_COLOUR = STATUS_DISPLAY[AfflictionType.Burn].color;

/**
 * The colour a highlight is drawn in. It resolves from a *kind* (or a boss's
 * tone), never from a caller's colour, so no call site can put the accent on the
 * board — which is how gold got there before.
 */
export function highlightColour(kind: keyof typeof BOARD_HIGHLIGHTS | 'ground', tone?: WarningTone): string {
  if (tone) return WARNING_TONE_COLOUR[tone];
  return kind === 'ground' ? GROUND_COLOUR : BOARD_HIGHLIGHTS[kind];
}

/**
 * Whose rear the board tints (`FlankHexes`): the units selected — the hero the
 * player is choosing an action for, and a unit tapped to read — and, while a
 * damaging skill is being aimed, every lit enemy the blow could flank, which is
 * one beside the caster or any the skill closes on first (a dash or a blink).
 * Units with no front are left out; they are never flanked.
 */
export function flankShownIds(
  units: readonly CombatUnit[],
  selectedIds: readonly (string | null | undefined)[],
  aiming?: { caster: CombatUnit; skill: HeroSkill; lit: readonly HexCoord[] },
): string[] {
  const shown = new Set<string>();
  const flankable = (u: CombatUnit | undefined): u is CombatUnit => !!u && u.currentHp > 0 && hasFacing(u) && u.facing !== undefined;
  for (const id of selectedIds) {
    const selected = units.find((u) => u.id === id);
    if (flankable(selected)) shown.add(selected.id);
  }
  if (aiming && (aiming.skill.damage || blinksInBehind(aiming.skill))) {
    const closes = aiming.skill.selfMove?.kind === 'dash' || aiming.skill.selfMove?.kind === 'blink'
      // Mantis Execution and Marked Prey's release land behind their prey first
      || blinksInBehind(aiming.skill);
    const lit = new Set(aiming.lit.map(hexKey));
    for (const u of units) {
      if (!flankable(u) || u.isPlayer === aiming.caster.isPlayer || !lit.has(hexKey(u.position))) continue;
      if (closes || hexDistance(u.position, aiming.caster.position) === 1) shown.add(u.id);
    }
  }
  return [...shown];
}

/**
 * The rear hexes of those units, on the board: each one's back hex and its two
 * side hexes. A hex that is one unit's back and another's side is drawn as a back,
 * the stronger claim.
 */
export function flankTint(units: readonly CombatUnit[], ids: readonly string[]): { sides: HexCoord[]; backs: HexCoord[] } {
  const backs = new Map<string, HexCoord>();
  const sides = new Map<string, HexCoord>();
  for (const id of ids) {
    const unit = units.find((u) => u.id === id);
    if (!unit) continue;
    const [back, ...rear] = hexesBehind(unit);
    if (back && inArena(back)) backs.set(hexKey(back), back);
    for (const h of rear) if (inArena(h)) sides.set(hexKey(h), h);
  }
  for (const key of backs.keys()) sides.delete(key);
  return { sides: [...sides.values()], backs: [...backs.values()] };
}
