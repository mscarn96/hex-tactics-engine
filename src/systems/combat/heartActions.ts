import { ActiveEffect, AuraType, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import type { CombatSink } from '@/systems/combat/combatSink';
import { heartAnchorFeed } from '@/data/templates/bossText';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import type { BossFx } from '@/systems/combat/bossActions';
import { unitById } from '@/systems/combat/unitLookup';
import { castPrepared } from '@/systems/combat/preparedCast';
import { createObjective } from '@/systems/combat/objectives';
import { launchIntent, strikeDelivery } from '@/systems/combat/soundIntents';
import {
  anchorsOf,
  convergencePlan,
  heartChained,
  heartMoveOfSkill,
  isHeart,
  reprisalBinds,
  reprisalPlans,
  SPIRE_KIND,
  winterHexes,
  winterShelter,
} from '@/systems/combat/heartScript';
import { resolveVfxColor } from '@/systems/combat/vfxResolve';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';

/**
 * The store-writing half of the Heart of Winter's script.
 *
 * `heartScript` decides and measures; this puts it on the board. Shared by every
 * driver — the scene, the headless simulator, a harness — because the AI's executor
 * and `beginTurn` both call it, so a warning raised in the app and one raised in a
 * measured fight are one rule. It raises warnings and counts turns and never strikes:
 * landing them is `heartLanding`, which sits beside the resolver.
 */

const WARNING_BLUE = '#8fdcff';

/**
 * Raises Creeping Winter, Icebound Reprisal or Whiteout Convergence.
 *
 * Each fixes what it covers *here*, at the cast, and then goes through the shared
 * `castPrepared` like every other warning, so the HUD line, the marked hexes, the
 * response window and the landing are the machinery every delayed attack uses. What
 * is new is where the footprint comes from, and that the warning is tied to the
 * objectives that can answer it: the anchor Reprisal strains against, the spires.
 */
export function castHeartMove(boss: CombatUnit, skill: HeroSkill, fx: BossFx): { ok: boolean } {
  const store = useCombatStore.getState();
  const units = store.units;
  const caster = unitById(units, boss.id) ?? boss;
  const move = heartMoveOfSkill(skill);

  let hexes: HexCoord[];
  let aim: HexCoord;
  let after: ((attackId: string) => void) | undefined;
  let spared: HexCoord[] = [];

  switch (move) {
    case 'winter': {
      hexes = winterHexes(caster, units, store.hazards);
      if (hexes.length === 0) return { ok: false };
      aim = hexes[0];
      spared = winterShelter(caster, units);
      fx.log('  ' + t('bossLog.heart.winter', { name: unitName(boss) }), WARNING_BLUE);
      break;
    }
    case 'reprisal': {
      // One anchor, or from tier 3 two at once: one warning with a line to each
      const plans = reprisalPlans(caster, units, reprisalBinds(caster));
      if (plans.length === 0) return { ok: false };
      const seen = new Set<string>();
      hexes = plans.flatMap((p) => p.hexes).filter((h) => {
        const key = `${h.q},${h.r}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      aim = plans[0].anchor.position;
      const twin = plans.length > 1;
      after = (attackId) => {
        // Breaking a bound anchor now costs the Heart a share of its health, and cancels the
        // warning — or, when it shares the warning with another, only its own line
        for (const plan of plans) {
          useCombatStore.getState().patchObjective(plan.anchor.id, {
            bindsPrepared: attackId,
            backlash: BALANCE.HEART_REPRISAL_BACKLASH,
            ...(twin && { boundHexes: plan.hexes }),
          });
        }
      };
      fx.log('  ' + t(twin ? 'bossLog.heart.reprisalTwin' : 'bossLog.heart.reprisal', { name: unitName(boss) }), '#ff6a7a');
      break;
    }
    case 'convergence': {
      const plan = convergencePlan(caster, units, store.hazards);
      if (!plan) return { ok: false };
      hexes = plan.footprint;
      aim = plan.spires[0];
      after = (attackId) => {
        const spires = plan.spires.map((position) =>
          createObjective({
            kind: SPIRE_KIND,
            owner: caster,
            position,
            hp: Math.max(1, Math.round(caster.stats.maxHp * BALANCE.HEART_SPIRE_HP)),
            defense: 0,
            areaResist: BALANCE.HEART_SPIRE_AREA_RESIST,
            bindsPrepared: attackId,
            cancelsOnLast: true,
            backlash: BALANCE.HEART_SPIRE_PULSE,
            onLast: 'expose',
            shattersOnPhase: true,
          }),
        );
        useCombatStore.getState().addUnits(spires);
      };
      fx.log('  ' + t('bossLog.heart.convergence', { name: unitName(boss) }), WARNING_BLUE);
      break;
    }
    default:
      return { ok: false };
  }

  const cast = castPrepared(caster, skill, aim, hexes, units, fx.log, spared);
  if (!cast.ok) return { ok: false };
  after?.(cast.attack.id);
  // A free turn at once, in which the open warning leaves it nothing but the Pulse: the
  // attack between spells. Granted only from a regular turn, so it never chains.
  useCombatStore.setState((s) => (s.bonusTurn.active ? s : { bonusTurn: { ...s.bonusTurn, pending: boss.id } }));

  // The change of stance: the caster's own motion, nothing struck. The marked
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

/** The feed's two statuses: whole-fight Attack and Magic it laid on itself. */
const isAnchorFeed = (boss: CombatUnit) => (e: ActiveEffect): boolean =>
  (e.type === AuraType.AttackBuff || e.type === AuraType.MagicBuff) && e.sourceUnitId === boss.id && e.duration === -1;

/**
 * What its own regular turn beginning does before it chooses anything. (The turn is
 * counted after, by `bossRegistry.turnBegun`: that count holds Convergence and Reprisal
 * back from its opening turns.)
 *
 * **While chained, the anchors feed it** (PT-39, playtest 2026-10-21): every anchor
 * still standing adds `HEART_ANCHOR_EMPOWER` of its own Attack and Magic, stacking
 * turn on turn, so a party that leaves the anchors up pays for it. The pile is one
 * Attack and one Magic buff it lays on itself (`stacks` counts the feeds), said in
 * the log each time it grows, and shed at the start of its first unbound turn.
 */
export function beginHeartTurn(unitId: string, sink?: Pick<CombatSink, 'log'>): void {
  const store = useCombatStore.getState();
  const boss = unitById(store.units, unitId);
  if (!boss || boss.currentHp <= 0 || !isHeart(boss)) return;

  // Chained in its opening phase, and again in the tier-5 chain that rises at a quarter health
  const chained = heartChained(boss);
  const fed = isAnchorFeed(boss);
  const held = boss.activeEffects.find((e) => fed(e) && e.type === AuraType.AttackBuff)?.stacks ?? 0;
  const standing = chained ? anchorsOf(boss, store.units).length : 0;
  if (!chained && held === 0) return;
  if (chained && standing === 0) return;

  const stacks = chained ? held + standing : 0;
  const share = BALANCE.HEART_ANCHOR_EMPOWER * stacks;
  const feed: ActiveEffect[] = stacks > 0
    ? [
        { type: AuraType.AttackBuff, magnitude: Math.round(boss.stats.attack * share), duration: -1, sourceUnitId: boss.id, stacks },
        { type: AuraType.MagicBuff, magnitude: Math.round(boss.stats.magic * share), duration: -1, sourceUnitId: boss.id, stacks },
      ]
    : [];
  useCombatStore.setState((s) => ({
    units: s.units.map((u) =>
      u.id !== unitId ? u : { ...u, activeEffects: [...u.activeEffects.filter((e) => !fed(e)), ...feed] }),
  }));
  if (stacks > 0) sink?.log(`  ${heartAnchorFeed(boss.name, standing, `${Math.round(share * 100)}%`)}`, '#ff6a7a');
}
