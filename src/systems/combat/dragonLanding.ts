import { CombatUnit, HeroSkill, HexCoord, PreparedAttack } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { CINDER_RIFT_LABEL, flameWave, skyfireLanding } from '@/data/templates/emeraldDragon';
import { useCombatStore } from '@/stores/combatStore';
import type { BossFx } from '@/systems/combat/bossActions';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { getSkillTargets } from '@/systems/combat/targeting';
import { unitById } from '@/systems/combat/unitLookup';
import { carrierOf, previewPrepared } from '@/systems/combat/preparedAttacks';
import { CombatSink, resolveSkillUse } from '@/systems/combat/skillResolution';
import type { Landing } from '@/systems/combat/encounterScript';
import { JUMP_MS } from '@/data/display/combatMotion';
import {
  dragonLandingHex,
  riftCrossDamage,
  waveFootprint,
} from '@/systems/combat/dragonScript';
import { exposeDragon, quenchDragon } from '@/systems/combat/dragonActions';
import { heatAfterBurst } from '@/systems/combat/dragonHeat';
import { hexKey } from '@/utils/hexUtils';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { heroesOf } from '@/systems/combat/targetLegality';

/**
 * Landing the Dragon's warnings that are more than one blow.
 *
 * The landing (`warnedLanding`) offers this every warning that comes due, and it
 * handles the Dragon's three; each of their blows is struck through the `Landing`, so the
 * answer tally and the whiff count who they reached. It sits beside the resolver
 * rather than in `dragonActions` because the Wing Thrust must call it, and the
 * resolver imports the boss rules.
 *
 * - **Wing Thrust** (`strikeWing`) is instant and two ticks: the wing (damage and the shove, from the
 *   warned origin) and then the flame wave over the arc *and* the hexes the
 *   shove put heroes on — read from the same landings the warning drew, before
 *   the shove, so what the party was shown is what the second tick covers.
 * - **Cinder Rift** erupts on its line and then stays as non-solid burning
 *   ground that costs a crossing fire (`ArenaHazard.crossDamage`), for
 *   `DRAGON_RIFT_TURNS` of his regular turns.
 * - **Skyfire** burns every hex (but not the heroes standing on a burning Rift: the
 *   trench, `PreparedSpec.shelter`), then he comes down on the landing area marked
 *   at the cast and strikes it. A hero standing in that area sprawls him: Exposed,
 *   and his fire quenched. A Rift still burning is left burning.
 * - **Furnace Heart** bursts on whoever carries it and the heroes beside them.
 */

/** How long after the first tick the second is drawn, so the two read as two. */
const SECOND_TICK_DELAY_MS = 700;

let riftSequence = 0;
/** The family of the Rift's ground: a new Rift of his replaces the old (`ArenaHazard.kind`). */
const RIFT_KIND = 'cinder_rift';

const later =
  (sink: CombatSink, delayMs: number): CombatSink => ({
    ...sink,
    vfx: (spec) => sink.vfx({ ...spec, delayMs: (spec.delayMs ?? 0) + delayMs }),
  });

/** Returns true when the warning was landed here, false when the ordinary strike should run. */
export function landDragonWarning(
  landing: Landing,
  caster: CombatUnit,
  sink: CombatSink,
  fx: BossFx,
): boolean {
  switch (landing.attack.skill.id) {
    case 'cinder_rift':
      landRift(landing, caster, sink, fx);
      return true;
    case 'skyfire':
      landSkyfire(landing, caster, sink, fx);
      return true;
    case 'furnace_heart':
      landHeart(landing, caster, sink, fx);
      return true;
    default:
      return false;
  }
}

/**
 * The Furnace Heart bursts on whoever holds it: the carrier and everyone beside them, over the footprint
 * the store has kept round them (`carriedFootprint`, the same the preview reads), and his fire climbs a
 * step. On a carrier who has fallen it is the same burst, on the hex they fell on (`resolveFallenCarriers`).
 * The crystal has gone with the warning (`retireLinkedObjectives`), and its Seared with it.
 */
function landHeart(landing: Landing, caster: CombatUnit, sink: CombatSink, fx: BossFx): void {
  const { attack } = landing;
  const store = useCombatStore.getState();
  const carrierId = carrierOf(attack);
  const carrier = carrierId ? unitById(store.units, carrierId) : undefined;
  const at = carrier?.position ?? attack.aim;
  fx.log('  ' + t(carrier && carrier.currentHp > 0 ? 'bossLog.dragon.heartBursts' : 'bossLog.dragon.heartBurstsFallen', {
    name: carrier ? unitName(carrier) : '',
  }), '#ff6644');
  sink.lands?.(attack.skill, caster.position, at);
  landing.strike(caster, sink, { aim: at, pushOrigin: null });
  const live = unitById(useCombatStore.getState().units, caster.id);
  if (!live || live.currentHp <= 0) return;
  useCombatStore.getState().patchBossScript(live.id, { heat: heatAfterBurst(live) });
  fx.log('  ' + t('bossLog.dragon.heartStokes', { name: unitName(live) }), '#ff8a1e');
}

/**
 * The Wing Thrust, made now: the wing, then the flame wave over the arc and the
 * hexes the shove reached (read from the same trace before anything moves).
 * Instant — nothing was announced — so it is run straight from his turn.
 */
export function strikeWing(caster: CombatUnit, skill: HeroSkill, aim: HexCoord, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const hexes = getSkillTargets(skill, caster.position, aim, store.units);
  const attack = { id: 'wing', casterId: caster.id, skill, spec: {}, aim, origin: caster.position,
    hexes, responders: [], responded: [] } as PreparedAttack;
  const landings = previewPrepared(attack, store.units, store.hazards)
    .landings.filter((m) => m.moved)
    .map((m) => m.to);
  const wave = waveFootprint(attack.hexes, landings);

  store.setFacing(caster.id, aim);
  store.startCooldown(caster.id, skill);
  resolveSkillUse(caster, skill, aim, sink, {
    resolving: true,
    fixedHexes: attack.hexes,
    pushOrigin: attack.origin,
  });
  const striker = unitById(useCombatStore.getState().units, caster.id) ?? caster;
  if (striker.currentHp <= 0) return;
  sink.log('  ' + t('bossLog.dragon.flameWave'), '#ff8a1e');
  resolveSkillUse(striker, flameWave, attack.aim, later(sink, SECOND_TICK_DELAY_MS), {
    resolving: true,
    fixedHexes: wave,
  });
}

function landRift(landing: Landing, caster: CombatUnit, sink: CombatSink, fx: BossFx): void {
  const { attack } = landing;
  landing.strike(caster, sink);
  const live = unitById(useCombatStore.getState().units, caster.id) ?? caster;
  if (live.currentHp <= 0) return;
  // It burns for `DRAGON_RIFT_TURNS` of his regular turns after this one, whatever he casts meanwhile:
  // `tickHazards` counts it down as each of his turns begins, so it goes out as the turn after the last
  // of them begins (this turn, spent on the eruption, has already begun). A new one replaces it
  useCombatStore.getState().addHazard({
    id: `rift_${++riftSequence}`,
    hexes: attack.hexes.map((h) => ({ q: h.q, r: h.r })),
    solid: false,
    label: CINDER_RIFT_LABEL,
    lasts: 'replaced',
    turnsLeft: BALANCE.DRAGON_RIFT_TURNS + 1,
    kind: RIFT_KIND,
    ownerId: caster.id,
    crossDamage: riftCrossDamage(getCombatEffectiveStats(live).attack),
  });
  fx.log('  ' + t('bossLog.dragon.riftBurns'), '#ff8a1e');
}

function landSkyfire(landing: Landing, caster: CombatUnit, sink: CombatSink, fx: BossFx): void {
  const { attack } = landing;
  const area = attack.landing ?? [];
  // The flame first, from where he took off: the whole arena, but for the Rift's sheltered ground
  landing.strike(caster, sink);
  const store = useCombatStore.getState();
  const flown = unitById(store.units, caster.id) ?? caster;
  if (flown.currentHp <= 0) return;

  // Then he comes down on the marked area — the free hex nearest its centre
  const hex = dragonLandingHex(attack.aim, area, flown, store.units, store.hazards);
  if (hex) {
    store.moveUnit(flown.id, hex, 'jump');
    store.setFacing(flown.id, attack.origin);
    fx.log('  ' + t('bossLog.dragon.lands', { name: unitName(flown) }), '#ff8a1e');
  }
  const landed = unitById(useCombatStore.getState().units, caster.id) ?? flown;

  // The sprawl: a hero standing in the landing mark when he comes down makes him land badly,
  // Exposed and his fire quenched. The landing blow is the same (the hero still takes it)
  const marked = new Set(area.map(hexKey));
  if (heroesOf(useCombatStore.getState().units).some((h) => marked.has(hexKey(h.position)))) {
    fx.log('  ' + t('bossLog.dragon.sprawls', { name: unitName(landed) }), '#ffdd66');
    exposeDragon(landed, fx);
    quenchDragon(landed.id);
  }
  // The landing blow is the warning's second blow, outside the plan: the trench shelters a hero
  // from the flame, not from him coming down on them
  landing.blow(landed, skyfireLanding, attack.aim, later(sink, Math.max(SECOND_TICK_DELAY_MS, JUMP_MS)), area);
  // A Rift still burning outlasts the flame: it goes out on its own clock (`landRift`)
}
