import { AuraType, CombatUnit, HeroSkill, HexCoord, PreparedAttack, SoundIntent } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import type { BossFx } from '@/systems/combat/bossActions';
import type { CombatSink } from '@/systems/combat/combatSink';
import type { PreparedPreview } from '@/systems/combat/preparedAttacks';
import { unitById } from '@/systems/combat/unitLookup';
import { mendIntent } from '@/systems/combat/soundIntents';
import { FLOAT_COLOR } from '@/data/display/floatColors';
import { JUMP_MS } from '@/data/display/combatMotion';
import { castPrepared } from '@/systems/combat/preparedCast';
import { launchIntent, strikeDelivery } from '@/systems/combat/soundIntents';
import { resolveSkillUse } from '@/systems/combat/skillResolution';
import { arcHexes } from '@/systems/combat/arenaGeometry';
import {
  collapseCentre,
  collapseFootprint,
  isRubbleOf,
  isTroll,
  isUnharmed,
  preyFootprint,
  preyTarget,
  PREY_EXPOSED_TURNS,
  regenAmount,
  regenerationOn,
  RUBBLE_KIND,
  rubbleHexes,
  sweepThroughFort,
  trollMoveOfSkill,
  trollPreyLanding,
} from '@/systems/combat/trollScript';
import { resolveVfxColor } from '@/systems/combat/vfxResolve';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { hexKey } from '@/utils/hexUtils';

/**
 * The store-writing half of the Troll Chieftain's script.
 *
 * `trollScript` decides and measures; this puts it on the board. Shared by every
 * driver — the scene, the headless simulator, a harness — because `beginTurn`,
 * the AI's executor and the landing all call it, so a warning raised in the app
 * and one raised in a measured fight are one rule.
 *
 * The leap and the rubble are the two halves either side of the ordinary strike,
 * which `warnedLanding` runs between them. The Sweep is struck here, through the
 * resolver, because the fort changes who it reaches.
 */

const WARNING_ORANGE = '#ffaa44';
const RUBBLE_LABEL = 'bossLog.hazard.rubble';
const ROCK = '#9a7a52';
const EXPOSED_GOLD = '#ffdd66';
/** The Collapse's rubble, kept here too for the callers that lay or clear it. */
export { RUBBLE_KIND };

let rubbleSequence = 0;

// ── raising the two warnings with a footprint of their own ───────────────────

/**
 * Raises Farthest Prey or Warren Collapse.
 *
 * Both fix what they cover *here*, at the cast, and then go through the shared
 * `castPrepared` like every other warning — so the HUD line, the marked hexes,
 * the response window and the landing are the machinery every delayed attack
 * uses. What is new is only where the footprint comes from: the area around the
 * hero farthest from him, or the densest knot of heroes. The Prey is cast from his
 * cycle; the Collapse only by the Smash's landing (`afterTrollLanding`).
 */
export function castTrollMove(boss: CombatUnit, skill: HeroSkill, fx: BossFx): { ok: boolean } {
  const store = useCombatStore.getState();
  const units = store.units;
  const move = trollMoveOfSkill(skill);

  let hexes: HexCoord[];
  let aim: HexCoord;
  let scripted: PreparedAttack['scripted'];

  switch (move) {
    case 'prey': {
      const target = preyTarget(boss, units);
      if (!target) return { ok: false };
      aim = { ...target.position };
      hexes = preyFootprint(aim);
      scripted = 'prey';
      fx.log('  ' + t('bossLog.troll.prey', { name: unitName(boss), target: unitName(target) }), WARNING_ORANGE);
      break;
    }
    case 'collapse': {
      const centre = collapseCentre(units);
      if (!centre) return { ok: false };
      aim = centre;
      hexes = collapseFootprint(centre);
      scripted = 'collapse';
      fx.log('  ' + t('bossLog.troll.collapse'), WARNING_ORANGE);
      break;
    }
    default:
      return { ok: false };
  }

  const cast = castPrepared(unitById(units, boss.id) ?? boss, skill, aim, hexes, units, fx.log);
  if (!cast.ok) return { ok: false };
  store.updatePreparedAttack(cast.attack.id, { scripted });

  // The raise of the club: the caster's own motion, nothing struck. The marked
  // ground is drawn by the board from the warning itself.
  fx.vfx?.({
    kind: 'nova', delivery: 'spell',
    casterId: boss.id,
    casterPos: boss.position,
    targetCoord: boss.position,
    hitUnitIds: [],
    hitCoords: [],
    color: resolveVfxColor(skill),
    durationScale: 0.6,
  });
  fx.sound?.(launchIntent(boss, skill, strikeDelivery(skill, boss)));
  return { ok: true };
}

// ── the fort giving way ──────────────────────────────────────────────────────

/** A heap crumbling, for the ear: stone breaking, heard where it stood. Not a unit, so it has a key of its own. */
const crumbleIntent = (at: HexCoord): SoundIntent => ({ kind: 'fall', unitId: `rubble:${hexKey(at)}`, at, material: 'stone' });

/** Why heaps broke, for the log line. */
type Break = 'prey' | 'brace' | 'sweep';

/** A sink that may draw a picture on the blow's own clock (`CombatSink.impactVfx`). */
type BreakFx = BossFx & Partial<Pick<CombatSink, 'impactVfx'>>;

/**
 * Breaks these heaps of his rubble: they leave the floor, and each is a short debris picture,
 * a crumble of stone and one log line for the lot. Hexes that hold none of his rubble are left
 * alone, so a brace against the wall breaks nothing. The picture lands with the blow that broke
 * them (`impactVfx`), or `delayMs` after now when no blow is landing yet (the leap coming down).
 */
export function breakRubble(boss: CombatUnit, hexes: readonly HexCoord[], why: Break, fx: BreakFx, delayMs = 0): HexCoord[] {
  const store = useCombatStore.getState();
  const wanted = new Set(hexes.map(hexKey));
  const broken: HexCoord[] = [];
  for (const heap of store.hazards.filter((h) => isRubbleOf(boss.id, h))) {
    const hit = heap.hexes.filter((h) => wanted.has(hexKey(h)));
    if (hit.length === 0) continue;
    broken.push(...hit);
    const rest = heap.hexes.filter((h) => !wanted.has(hexKey(h)));
    // Laid again without the broken heaps, under its own id: `addHazard` keeps one of his kind
    useCombatStore.getState().removeHazard(heap.id);
    if (rest.length > 0) useCombatStore.getState().addHazard({ ...heap, hexes: rest });
  }
  if (broken.length === 0) return broken;
  const line = why === 'prey' ? 'bossLog.troll.breaks.prey' : why === 'brace' ? 'bossLog.troll.breaks.brace' : 'bossLog.troll.breaks.sweep';
  fx.log('  ' + t(line, { count: broken.length }), ROCK);
  const debris = delayMs > 0 ? fx.vfx : (fx.impactVfx ?? fx.vfx);
  debris?.({
    kind: 'quake', delivery: 'blunt',
    casterId: boss.id,
    casterPos: broken[0],
    targetCoord: broken[0],
    hitUnitIds: [],
    hitCoords: broken,
    color: ROCK,
    durationScale: 0.5,
    aftermath: 'dust',
    ...(delayMs > 0 && { delayMs }),
  });
  for (const heap of broken) fx.sound?.(crumbleIntent(heap));
  return broken;
}

// ── the Sweep ────────────────────────────────────────────────────────────────

/**
 * Bonebreaker Sweep, struck through the fort: the ordinary resolver over the arc, less the
 * heroes a heap shields (`sweepThroughFort`: no damage, no wound), and then every heap of his
 * in the arc breaks, whether or not anyone stood behind it. A swing that a heap took whole still
 * happened — he turns, the club is drawn and the stone breaks — so it is struck as a landing is
 * (nothing refunded for finding nobody); the Sweep costs nothing, so nothing is skipped.
 */
export function strikeSweep(boss: CombatUnit, skill: HeroSkill, target: HexCoord, sink: CombatSink): boolean {
  const store = useCombatStore.getState();
  const caster = unitById(store.units, boss.id) ?? boss;
  const arc = arcHexes(skill, caster.position, target);
  const { covered, broken } = sweepThroughFort(caster, arc, store.units, store.hazards);
  const shielded = new Set(
    covered.map((id) => unitById(store.units, id)).filter((u): u is CombatUnit => !!u).map((u) => hexKey(u.position)),
  );
  const struck = resolveSkillUse(caster, skill, target, sink, {
    resolving: true,
    fixedHexes: arc.filter((h) => !shielded.has(hexKey(h))),
  });
  if (!struck.ok) return false;
  if (covered.length > 0) {
    const names = covered.map((id) => unitById(useCombatStore.getState().units, id)).filter((u): u is CombatUnit => !!u).map(unitName);
    sink.log('  ' + t('bossLog.troll.covered', { names: names.join(', ') }), ROCK);
  }
  breakRubble(caster, broken, 'sweep', sink);
  return true;
}

// ── turn start ───────────────────────────────────────────────────────────────

/**
 * What his own regular turn beginning does before he chooses anything: the
 * deferred Fury (a blow that crossed half health while he had yet to begin a
 * turn here waits for one, so no phase is skipped) and the regeneration of a round
 * nobody fought him in. The turn is counted after (`bossRegistry.turnBegun`).
 *
 * The regeneration reads the unharmed counter *before* this turn adds to it: 1 or
 * more means no hero has damaged him since his last regular turn began. It is off
 * once only one hero stands (`regenerationOn`). Fury actions and speed bonus turns
 * take the short road in `beginTurn` and never arrive here, so they neither heal him
 * nor count.
 */
export function beginTrollTurn(unitId: string, fx: BossFx): void {
  const store = useCombatStore.getState();
  const boss = unitById(store.units, unitId);
  if (!boss || boss.currentHp <= 0 || !isTroll(boss)) return;

  const entered = store.enterPendingPhase(unitId);
  if (entered) {
    fx.log(`${unitName(boss)}: ${entered}`, '#ff4422');
    fx.announce?.(entered);
  }
  const live = useCombatStore.getState();
  const now = unitById(live.units, unitId);
  if (now && isUnharmed(now) && regenerationOn(live.units)) regenerate(now, fx);
}

/** Heals him for the round nobody fought him in: a number over him, a line in the log and a sound. */
function regenerate(boss: CombatUnit, fx: BossFx): void {
  const restored = useCombatStore.getState().healUnit(boss.id, regenAmount(boss), boss.id);
  if (restored <= 0) return;
  fx.log('  ' + t('bossLog.troll.regenerates', { name: unitName(boss), amount: restored }), FLOAT_COLOR.heal);
  fx.sound?.(mendIntent(boss));
  fx.float?.(boss.position, t('combatLog.float.trollRegen', { amount: restored }), FLOAT_COLOR.heal);
}

// ── landing ──────────────────────────────────────────────────────────────────

/**
 * Before the strike of a landing warning. Farthest Prey is a leap: he comes down
 * in the marked area (`trollPreyLanding`) so the blow lands from where he stands.
 * A mark that holds his rubble baits him onto it: the heap gives way under him and
 * he is Exposed (`TROLL_PREY_EXPOSED`) until his own next regular turn begins — the
 * pair's next round, exactly. Returns the caster as the strike should see him.
 */
export function beforeTrollLanding(attack: PreparedAttack, boss: CombatUnit, fx: BreakFx): CombatUnit {
  if (attack.scripted !== 'prey') return boss;
  const store = useCombatStore.getState();
  const landing = trollPreyLanding(attack.aim, attack.hexes, boss, store.units, store.hazards);
  if (!landing) return boss;
  const { hex, onRubble } = landing;
  // The heap gives way as he comes down on it, at the end of the leap
  if (onRubble) breakRubble(boss, [hex], 'prey', fx, JUMP_MS);
  if (hex.q !== boss.position.q || hex.r !== boss.position.r) {
    useCombatStore.getState().moveUnit(boss.id, hex, 'jump');
    useCombatStore.getState().setFacing(boss.id, attack.aim);
    fx.log('  ' + t('bossLog.troll.leaps', { name: unitName(boss) }), WARNING_ORANGE);
  }
  if (onRubble) {
    useCombatStore.getState().applyEffect(boss.id, {
      type: AuraType.Exposed,
      magnitude: BALANCE.TROLL_PREY_EXPOSED,
      duration: PREY_EXPOSED_TURNS,
      sourceUnitId: boss.id,
    });
    fx.log('  ' + t('bossLog.troll.exposed', { name: unitName(boss) }), EXPOSED_GOLD);
  }
  return unitById(useCombatStore.getState().units, boss.id) ?? boss;
}

/** The heaps the braced heroes leaned on, read off the plan the landing held: a wall brace leans on no heap. */
function leanedOn(boss: CombatUnit, held: PreparedPreview | undefined): HexCoord[] {
  if (!held) return [];
  const braced = new Set(held.braced);
  return held.landings
    .filter((m) => braced.has(m.unitId) && m.blockedBy?.kind === 'hazard')
    .map((m) => m.blockedBy!.at)
    .filter((at) => useCombatStore.getState().hazards.some((h) => isRubbleOf(boss.id, h) && h.hexes.some((x) => hexKey(x) === hexKey(at))));
}

/**
 * After the strike.
 *
 * - **Boundary Smash.** A hero who braced against his rubble (`PreparedPreview.braced`, the plan
 *   the landing held) kept the hex, and the heap they leaned on breaks; a brace against the wall
 *   breaks nothing. Then the roof comes down: the Smash casts the Warren Collapse over the
 *   densest cluster where the throw left the heroes (`collapseCentre`, read now), so the pair
 *   decides at once whether to walk under a partner's roof to halve it, or leave them.
 * - **Warren Collapse** leaves rubble on the empty ground it struck (`rubbleHexes`): never under
 *   a living unit and never enough to seal the board. The rubble stands until his **next Collapse
 *   lands** (`ArenaHazard.lasts` `'replaced'`, kind `RUBBLE_KIND`) or the fight breaks it: that
 *   landing clears the last one's first, so the new heaps are chosen on the floor as it will be,
 *   and a Collapse that leaves none still takes the old heaps away.
 */
export function afterTrollLanding(attack: PreparedAttack, boss: CombatUnit, fx: BreakFx, held?: PreparedPreview): void {
  if (!isTroll(boss)) return;
  if (trollMoveOfSkill(attack.skill) === 'smash') {
    breakRubble(boss, leanedOn(boss, held), 'brace', fx);
    const live = unitById(useCombatStore.getState().units, boss.id);
    const roof = live?.skills.find((s) => trollMoveOfSkill(s) === 'collapse');
    if (live && live.currentHp > 0 && roof) castTrollMove(live, roof, fx);
    return;
  }
  if (attack.scripted !== 'collapse') return;
  const store = useCombatStore.getState();
  const old = store.hazards.filter((h) => h.lasts === 'replaced' && h.kind === RUBBLE_KIND && h.ownerId === boss.id);
  for (const h of old) store.removeHazard(h.id);
  const standing = useCombatStore.getState();
  const hexes = rubbleHexes(attack.hexes, standing.units, standing.hazards);
  if (hexes.length === 0) return;
  standing.addHazard({
    id: `rubble_${++rubbleSequence}`,
    hexes,
    solid: true,
    label: RUBBLE_LABEL,
    lasts: 'replaced',
    kind: RUBBLE_KIND,
    ownerId: boss.id,
  });
  fx.log('  ' + t('bossLog.troll.rubble', { count: hexes.length }), '#b89a6a');
}
