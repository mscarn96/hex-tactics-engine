import { CombatUnit, HeroSkill, HexCoord, PreparedReaction, SkillModeId, SkillTargetType } from '@/models/types';
import { getSkillRangeHexes, getSkillTargets, getValidSkillTargetHexes, isAoESkill } from '@/systems/combat/targeting';
import { inArena } from '@/systems/combat/arenaGeometry';
import { resolveSelfMove } from '@/systems/combat/forcedMovement';
import { RAMPART_KIND, rampartPair } from '@/systems/combat/ramparts';
import { activeTaunt, hasStaleTaunt } from '@/systems/combat/taunt';
import { nothingInRange, noTargetsMessage, skillBlockedReason } from '@/systems/combat/skillAvailability';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { modeQuestionFor } from '@/systems/combat/skillModes';
import { skillVariantFor } from '@/systems/combat/statusEffects';
import { skillTargetKind } from '@/systems/combat/targetKind';
import { getHexesInRange, getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * How many taps on the board a skill press takes (PT-10).
 *
 * - **None**: a skill whose only possible aim is the caster's own hex — a `Self`
 *   skill, a self-centred `Ring` (range 0, Whirlwind) or an arena-wide one — is
 *   cast by its button. Making the player tap the hero they are already looking
 *   at was a second press that chose nothing.
 * - **Two**: an area aimed at a hex — a ring, wedge, line, cross or chain whose
 *   footprint at the aimed hex is more than that hex. The first tap picks the
 *   aim and shows what it covers; the same hex again casts, another valid hex
 *   moves the aim.
 * - **One**: everything else, single-target skills and dashes onto one target
 *   included.
 */

const sameHex = (a: HexCoord, b: HexCoord) => a.q === b.q && a.r === b.r;

/** Whether the skill can only ever be aimed at its caster, so its button casts it. */
export function aimsAtCasterOnly(skill: HeroSkill): boolean {
  return (
    skill.targetType === SkillTargetType.Self
    || !!skill.arenaWide
    || (skill.targetType === SkillTargetType.Ring && !skill.range)
  );
}

/**
 * True when pressing the skill should cast it at once: it aims at its caster only,
 * and the highlight pass offered exactly the caster's hex (so the "nothing to hit"
 * refusals of `getValidSkillTargetHexes` still stand).
 */
export function castsOnPress(skill: HeroSkill, caster: CombatUnit, validTargets: HexCoord[]): boolean {
  return aimsAtCasterOnly(skill) && validTargets.length === 1 && sameHex(validTargets[0], caster.position);
}

/**
 * True when pressing a release fires it: Aimed Shot's release and Marked Prey's
 * may only go at the one unit the aim or the mark names, so once that unit is the
 * one target offered there is nothing left to choose.
 */
export function releasesOnPress(skill: HeroSkill, validTargets: HexCoord[]): boolean {
  const namedRelease = (!!skill.charge?.aimed && !!skill.releasing) || skill.mantisStage === 'release';
  return namedRelease && validTargets.length === 1;
}

/**
 * The hexes a cast aimed at `aim` would cover, read the way the resolver reads
 * them: the occupied variant when the aim holds an enemy, and the area drawn from
 * where a self-move lands. Null when the skill is not aimed as an area — then the
 * tap that picks the hex casts it.
 */
export function aimFootprint(
  skill: HeroSkill,
  caster: CombatUnit,
  aim: HexCoord,
  units: CombatUnit[],
  hazards: Parameters<typeof resolveSelfMove>[4] = [],
): HexCoord[] | null {
  if (aimsAtCasterOnly(skill) || skill.targetType === SkillTargetType.Single) return null;
  // Random strikes inside an aimed area (Skyfall): the area is the picture, the bodies are rolled
  if (skill.randomEnemies) {
    const area = getHexesInRange(aim, skill.aoeRadius ?? 0).filter(inArena);
    return area.length > 1 ? area : null;
  }
  const occupant = units.find((u) => u.currentHp > 0 && sameHex(u.position, aim));
  const pictured = skillVariantFor(skill, !!occupant && occupant.isPlayer !== caster.isPlayer);
  if (pictured.targetType === SkillTargetType.Single) return null;
  const from = pictured.selfMove && pictured.selfMove.kind !== 'retreat'
    ? resolveSelfMove(caster, pictured, aim, units, hazards) ?? caster.position
    : caster.position;
  const seen = new Set<string>();
  const footprint = getSkillTargets(pictured, from, aim, units, hazards).filter((h) => {
    const key = hexKey(h);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return footprint.length > 1 ? footprint : null;
}

/**
 * The footprint split by what the cast does on each hex, for its colours:
 * an enemy the skill harms is `attack`, an ally it helps is `support`, and every
 * other hex — ground, or a body the skill passes over (an attack's allies, a
 * blessing's enemies) — is `area`. Damage and afflictions land on the caster's
 * opponents and heals, auras and cleanses on its side (`skillResolution`), which
 * is the split `skillTargetKind` already reads.
 */
export function footprintSides(
  skill: HeroSkill,
  caster: CombatUnit,
  footprint: HexCoord[],
  units: CombatUnit[],
): { attack: HexCoord[]; support: HexCoord[]; area: HexCoord[] } {
  const kind = skillTargetKind(skill);
  const harms = kind !== 'support';
  const helps = kind !== 'attack';
  const out = { attack: [] as HexCoord[], support: [] as HexCoord[], area: [] as HexCoord[] };
  for (const h of footprint) {
    const body = units.find((u) => u.currentHp > 0 && sameHex(u.position, h));
    if (body && body.isPlayer !== caster.isPlayer && harms) out.attack.push(h);
    else if (body && body.isPlayer === caster.isPlayer && helps) out.support.push(h);
    else out.area.push(h);
  }
  return out;
}

/**
 * The valid target hexes split into the two colours they are lit in: `attack`
 * red or `support` green.
 *
 * Each hex is read as the skill the resolver would run there — the
 * `occupiedVariant` on a hex holding an enemy — so a skill that is two skills
 * by where it is pointed shows both (PT-09). Shadowstep's blink-and-Stealth half
 * is a blessing on the caster, so its open ground is green, but a body is a stab
 * with poison and has to look like one; reading the base skill alone lit every
 * enemy it could strike in green.
 *
 * A `mixed` skill (Thornrow) paints the hexes holding an ally green and every
 * other target red.
 */
export function targetHexSides(
  skill: HeroSkill,
  caster: CombatUnit,
  hexes: readonly HexCoord[],
  units: readonly CombatUnit[],
): { attack: HexCoord[]; support: HexCoord[] } {
  const out = { attack: [] as HexCoord[], support: [] as HexCoord[] };
  for (const h of hexes) {
    const body = units.find((u) => u.currentHp > 0 && sameHex(u.position, h));
    const enemy = !!body && body.isPlayer !== caster.isPlayer;
    const kind = skillTargetKind(skillVariantFor(skill, enemy));
    const ally = !!body && body.isPlayer === caster.isPlayer;
    if (kind === 'support' || (kind === 'mixed' && ally)) out.support.push(h);
    else out.attack.push(h);
  }
  return out;
}

// ─── The step ─────────────────────────────────────────────────────────────────

/**
 * Aiming, as a function from the state of the aim and an event to the next state
 * and what should happen.
 *
 * The rampart's three taps, the area's two, the press that casts at once and the
 * taunt that refuses all lived in `CombatScene` callbacks with hand-curated
 * dependency lists, and the taunt's refusal was written twice with different
 * messages. This is the sequence, with no React and no store: the scene is its
 * adapter, builds the `AimBoard` from the stores, interprets the effects, and
 * keeps the `AimState` it hands back. Nothing here writes anything.
 */

export interface AimState {
  /** An area spell's aimed hex awaiting its second tap; null otherwise. */
  aimCentre: HexCoord | null;
  /** The rampart's rocks so far: the anchor tapped once, then the second rock. */
  rampart: { anchor: HexCoord | null; neighbor: HexCoord | null };
}

export const IDLE_AIM: AimState = { aimCentre: null, rampart: { anchor: null, neighbor: null } };

/** The world as the step reads it, fresh at each event. */
export interface AimBoard {
  current: CombatUnit;
  units: CombatUnit[];
  hazards: Parameters<typeof resolveSelfMove>[4];
  /** What is lit now: a tap on anything else is not a target. */
  highlights: readonly HexCoord[];
  /** The skill selected for aiming, when the phase is targeting. */
  skill: HeroSkill | null;
  /** The Reactions standing on the board: a Reaction pressed with every slot taken is refused at the press. */
  reactions?: readonly PreparedReaction[];
}

export type AimEvent =
  | { type: 'press'; skill: HeroSkill; mode?: SkillModeId }
  | { type: 'tap'; coord: HexCoord }
  | { type: 'cancel' };

/** What the scene is asked to do, in order. */
export type AimEffect =
  | { kind: 'toast'; text: string }
  | { kind: 'log'; text: string; tone: 'taunt' | 'marksman' }
  | { kind: 'select'; skill: HeroSkill | null; mode?: SkillModeId }
  | { kind: 'highlight'; hexes: HexCoord[] }
  | { kind: 'phase'; phase: 'select' | 'target' }
  /** Ask which of a skill's modes (Mercy or Wrath) before selecting anything. */
  | { kind: 'modePrompt'; skill: HeroSkill }
  /** Blink the skill's whole reach: pressing it found nothing in range. */
  | { kind: 'rangeFlash'; hexes: HexCoord[] }
  | { kind: 'removeTaunt'; unitId: string }
  /** `pressed`: a skill its button casts; the selection is dropped once the cast is made. */
  | { kind: 'cast'; skill: HeroSkill; at: HexCoord; neighbor?: HexCoord; pressed?: boolean };

export interface AimResult {
  state: AimState;
  effects: AimEffect[];
}

/**
 * The refusal a Taunt makes, in one place. Pressing an area skill, pressing one the
 * taunter is out of reach of, and tapping something other than the taunter are three
 * ways to be refused, and each names who is enforcing it: "taunted" alone states a
 * fact the badge row already shows and withholds which of the six things on the board
 * the player is being made to hit.
 */
export function tauntRefusal(
  why: 'area' | 'out-of-reach' | 'wrong-target',
  caster: CombatUnit,
  taunter: CombatUnit,
): { text: string; log?: string } {
  switch (why) {
    case 'area':
      return {
        text: t('combatLog.refuse.tauntArea', { name: unitName(taunter) }),
        log: `  ${t('combatLog.log.tauntArea', { name: unitName(caster), taunter: unitName(taunter) })}`,
      };
    case 'out-of-reach':
      return { text: t('combatLog.refuse.tauntReach', { name: unitName(taunter) }) };
    case 'wrong-target':
      return {
        text: t('combatLog.refuse.taunted', { name: unitName(taunter) }),
        log: `  ${t('combatLog.log.taunted', { name: unitName(caster), taunter: unitName(taunter) })}`,
      };
  }
}

/**
 * Why a Taunt bars `skill` this turn, or null when it does not. The one rule the
 * press and the skill bar both read: an area skill is barred outright, any other
 * skill is barred unless the active taunter's hex is among its valid targets. A
 * dead taunter compels nobody, so a stale taunt bars nothing.
 */
export function tauntBars(
  skill: HeroSkill,
  current: CombatUnit,
  units: CombatUnit[],
  hazards: AimBoard['hazards'],
): { why: 'area' | 'out-of-reach'; taunter: CombatUnit } | null {
  const taunter = activeTaunt(current, units);
  if (!taunter) return null;
  if (isAoESkill(skill)) return { why: 'area', taunter };
  const reachable = getValidSkillTargetHexes(skill, current, units, hazards).some((h) => sameHex(h, taunter.position));
  return reachable ? null : { why: 'out-of-reach', taunter };
}

const refuseWith = (refusal: { text: string; log?: string }): AimEffect[] => [
  { kind: 'toast', text: refusal.text },
  ...(refusal.log ? [{ kind: 'log', text: refusal.log, tone: 'taunt' } as const] : []),
];

/** What a Taunt makes of a tap on `coord`, or null when the tap is free to go on. */
function tauntOnTap(board: AimBoard, skill: HeroSkill, coord: HexCoord): { effects: AimEffect[] } | null {
  // Non-area skills must target the taunter; area skills were refused at the press
  if (isAoESkill(skill)) return null;
  const { current, units } = board;
  const taunter = activeTaunt(current, units);
  if (taunter) {
    return sameHex(coord, taunter.position) ? null : { effects: refuseWith(tauntRefusal('wrong-target', current, taunter)) };
  }
  // The taunter is dead: the taunt goes with it
  return hasStaleTaunt(current, units) ? { effects: [{ kind: 'removeTaunt', unitId: current.id }] } : null;
}

function press(state: AimState, board: AimBoard, skill: HeroSkill, mode?: SkillModeId): AimResult {
  const { current, units, hazards } = board;
  const fresh = IDLE_AIM;
  // A Reaction with every slot already standing: the cast would be refused, so the
  // press says why rather than lighting allies that cannot be chosen (PT-06)
  const held = skill.reaction ? skillBlockedReason(skill, current, units, board.reactions) : null;
  if (held) return { state: fresh, effects: [{ kind: 'toast', text: held }] };
  // A skill with a choice on it asks first, and asking costs nothing: nothing is
  // selected and the turn is exactly as it was
  if (modeQuestionFor(current, skill, mode)) return { state, effects: [{ kind: 'modePrompt', skill }] };

  const effects: AimEffect[] = [{ kind: 'select', skill, mode }];

  // Taunt: area skills blocked entirely; others restricted to the taunter
  const taunter = activeTaunt(current, units);
  if (taunter) {
    const barred = tauntBars(skill, current, units, hazards);
    if (barred) {
      // Not left selected: the player was just refused the aim
      return { state: fresh, effects: [...effects, ...refuseWith(tauntRefusal(barred.why, current, taunter)), { kind: 'select', skill: null }] };
    }
    return { state: fresh, effects: [...effects, { kind: 'highlight', hexes: [taunter.position] }, { kind: 'phase', phase: 'target' }] };
  }
  if (hasStaleTaunt(current, units)) effects.push({ kind: 'removeTaunt', unitId: current.id });

  const targets = getValidSkillTargetHexes(skill, current, units, hazards);
  // The same soft-lock as Move: a ranged attacker whose targets have all walked out
  // of range is the common case, and a lone Arcanist hits it constantly
  if (targets.length === 0) {
    const reason = noTargetsMessage(skill, current, units);
    effects.push({ kind: 'toast', text: reason });
    // And show how far it does reach, so "nothing in range" can be read off the board
    if (reason === nothingInRange()) effects.push({ kind: 'rangeFlash', hexes: getSkillRangeHexes(skill, current) });
    effects.push({ kind: 'select', skill: null });
    return { state: fresh, effects };
  }
  // Aimed only at the caster: the press is the cast. A refusal leaves the bar as it was.
  if (castsOnPress(skill, current, targets) || releasesOnPress(skill, targets)) {
    return { state: fresh, effects: [...effects, { kind: 'cast', skill, at: targets[0], pressed: true }] };
  }
  return { state: fresh, effects: [...effects, { kind: 'highlight', hexes: targets }, { kind: 'phase', phase: 'target' }] };
}

function tap(state: AimState, board: AimBoard, coord: HexCoord): AimResult {
  const { skill, current, units, hazards, highlights } = board;
  if (!skill) return { state, effects: [] };
  const lit = (hex: HexCoord) => highlights.some((h) => sameHex(h, hex));
  const toast = (text: string): AimEffect => ({ kind: 'toast', text });

  // The Stoneshaper's rampart: an anchor, then the rock beside it, then the same rock again to raise the pair
  if (skill.places?.kind === RAMPART_KIND) {
    const { anchor, neighbor } = state.rampart;
    if (!anchor) {
      if (!lit(coord)) return { state, effects: [toast(t('combatLog.aim.anchor'))] };
      return {
        state: { ...state, rampart: { anchor: coord, neighbor: null } },
        effects: [
          { kind: 'highlight', hexes: getNeighbors(coord).filter(inArena) },
          toast(t('combatLog.aim.secondRock')),
        ],
      };
    }
    if (hexDistance(anchor, coord) !== 1) {
      return {
        state: { ...state, rampart: { anchor: null, neighbor: null } },
        effects: [
          { kind: 'highlight', hexes: getValidSkillTargetHexes(skill, current, units, hazards) },
          toast(t('combatLog.aim.anchorCleared')),
        ],
      };
    }
    const pair = rampartPair(current, skill, anchor, units, inArena, coord);
    if (neighbor && sameHex(neighbor, coord)) {
      if (pair.length !== 2) return { state, effects: [toast(t('combatLog.aim.bothFree'))] };
      return { state, effects: [{ kind: 'cast', skill, at: anchor, neighbor: coord }] };
    }
    return {
      state: { ...state, rampart: { anchor, neighbor: coord } },
      effects: [toast(t(pair.length === 2 ? 'combatLog.aim.raisePair' : 'combatLog.aim.pairBlocked'))],
    };
  }

  const taunted = tauntOnTap(board, skill, coord);
  if (taunted) return { state, effects: taunted.effects };
  if (!lit(coord)) return { state, effects: [toast(t('combatLog.aim.invalid'))] };

  // An area aimed at a hex takes two taps: the first shows what it covers, the same hex
  // again casts it, and another valid hex moves the aim
  const aimed = state.aimCentre !== null && sameHex(state.aimCentre, coord);
  if (!aimed && aimFootprint(skill, current, coord, units, hazards)) {
    return { state: { ...state, aimCentre: coord }, effects: [] };
  }
  return { state: IDLE_AIM, effects: [{ kind: 'cast', skill, at: coord }] };
}

export function aimStep(state: AimState, event: AimEvent, board: AimBoard): AimResult {
  switch (event.type) {
    case 'press':
      return press(state, board, event.skill, event.mode);
    case 'tap':
      return tap(state, board, event.coord);
    case 'cancel':
      // Back out of aiming, whatever put us there: while aiming there is always a way
      // back to the action bar, so no empty-highlight path can cost a turn
      return {
        state: IDLE_AIM,
        effects: [{ kind: 'highlight', hexes: [] }, { kind: 'select', skill: null }, { kind: 'phase', phase: 'select' }],
      };
  }
}
