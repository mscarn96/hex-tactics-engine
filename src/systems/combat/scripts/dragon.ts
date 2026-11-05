import { useCombatStore } from '@/stores/combatStore';
import { getSkillTargets } from '@/systems/combat/targeting';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { preparedBy } from '@/systems/combat/preparedAttacks';
import { activeTaunt } from '@/systems/combat/taunt';
import {
  arcValue, chooseDragonMove, clawOnCarrier, DragonMove, DragonOffer, dragonMoveOfSkill, heartCarrier, heartWarning, isDragon,
  isDragonScriptedSkill, riftActive, riftFollowsWing, riftLine, RiftPlan, riftTargets,
} from '@/systems/combat/dragonScript';
import type { CombatUnit, HeroSkill } from '@/models/types';
import type { CombatSink } from '@/systems/combat/combatSink';
import { hexDistance } from '@/utils/hexUtils';
import { HEAT_WHIFF, heatAfterWhiff } from '@/systems/combat/dragonHeat';
import { unitById } from '@/systems/combat/unitLookup';
import { unitName } from '@/data/templates/unitText';
import { t } from '@/i18n';
import { beginDragonTurn, burnHeartCarrier, castDragonMove } from '@/systems/combat/dragonActions';
import { landDragonWarning, strikeWing } from '@/systems/combat/dragonLanding';
import type { AIAction, SkillResult } from '@/systems/combat/aiTypes';
import type { EncounterScript } from '@/systems/combat/encounterScript';
import { skillName } from '@/data/gameText';

/**
 * The Emerald Dragon.
 *
 * The move the board offers him the most, made as well as it allows. There is no
 * fixed rhythm: each signature is on offer only off its cooldown and only when the
 * board gives it something to do, and is valued by what it would do to this party
 * now (`chooseDragonMove`); the Claw is what he does otherwise. The wing and the
 * claw are aimed by the ordinary scoring, restricted to that one skill; the Heart's
 * aim and the Rift's and Skyfire's footprints are the script's. **Taunt changes
 * where his Claw goes and nothing else.** He remembers what he made and when
 * (`bossScript.lastUsed`): it is all that stands in for a cycle.
 */
/**
 * His Cinder Rift as the board offers it: off its cooldown, with no warning of his open (his carried
 * Heart aside) and none of his Rifts burning, the X `riftLine` would rake now.
 */
function riftOffer(enemy: CombatUnit, units: CombatUnit[]): { skill?: HeroSkill; plan: RiftPlan | null } {
  const store = useCombatStore.getState();
  const majorPending = preparedBy(enemy.id, store.preparedAttacks).some((p) => !p.spec.carried);
  const skill = enemy.skills.find((s) => dragonMoveOfSkill(s) === 'rift');
  if (majorPending || !skill || !canUseSkill(enemy, skill) || riftActive(enemy, store.hazards)) return { plan: null };
  return { skill, plan: riftLine(enemy, units) };
}

/** What a Rift on offer is worth: more when it would part the party. */
const riftValue = (plan: RiftPlan): number => (plan.split[0] > 0 && plan.split[1] > 0 ? 2.6 : 1.8);

/**
 * The Rift that follows a Wing Thrust: raised once the shove has settled, over the party as the wing left
 * it, when the rule the chooser valued the wing by says one follows (`riftFollowsWing`). Remembered as his
 * last signature, as a Rift always was.
 */
function raiseRiftAfterWing(caster: CombatUnit, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const live = unitById(store.units, caster.id);
  if (!live || live.currentHp <= 0) return;
  const { skill, plan } = riftOffer(live, store.units);
  const script = live.bossScript;
  const turns = script?.phaseTurns ?? 0;
  const follows = riftFollowsWing({
    majorPending: false,
    turns,
    lastSignature: script?.step ?? 0,
    rift: plan ? { available: true, value: riftValue(plan) } : { available: false, value: 0 },
  });
  if (!follows || !skill || !castDragonMove(live, skill, sink).ok) return;
  store.patchBossScript(live.id, { lastUsed: { ...(script?.lastUsed ?? {}), rift: turns }, step: turns });
}

/** What a Claw that catches the Heart's carrier is worth to him against his signatures: more than a plain swing. */
const HUNT_VALUE = 1.5;

export const dragonScript: EncounterScript = {
  id: 'dragon',

  decide(ctx) {
    const { enemy, foes, allUnits, trace } = ctx;
    if (!isDragon(enemy)) return null;
    const store = useCombatStore.getState();
    const taunter = activeTaunt(enemy, allUnits);
    // His carried Heart runs alongside his other warnings (`PreparedSpec.carried`): it holds none of them back
    const majorPending = preparedBy(enemy.id, store.preparedAttacks).some((p) => !p.spec.carried);
    const skillFor = (move: DragonMove) => enemy.skills.find((s) => dragonMoveOfSkill(s) === move);
    const ready = (move: DragonMove) => {
      const skill = skillFor(move);
      return skill !== undefined && canUseSkill(enemy, skill) ? skill : undefined;
    };
    const aimed = (move: DragonMove, against: typeof foes): SkillResult | null => {
      const skill = ready(move);
      return skill ? ctx.aim([skill], against) : null;
    };

    // While a Rift burns his Claw and Wing Thrust go to the side with fewer heroes (`riftTargets`)
    const reachable = riftTargets(enemy, foes, store.hazards);
    // His Claw hunts whoever carries his Heart, when a wedge of it reaches them; a Taunt still comes first
    const carrierId = heartWarning(enemy, store.preparedAttacks)?.bound?.[0];
    const holder = foes.find((f) => f.id === carrierId);
    const clawSkill = ready('claw');
    const hunt = !taunter && holder && clawSkill ? clawOnCarrier(enemy, clawSkill, holder, allUnits) : null;
    const claw: SkillResult | null = hunt && clawSkill
      ? { skill: clawSkill, targetPos: hunt, value: 1 }
      : aimed('claw', taunter ? [taunter] : reachable);
    // Instant, so it is on offer even while a warning of his is open
    const wing = aimed('wing', reachable);
    const wingSkill = skillFor('wing');
    const wingCaught =
      wing && wingSkill
        ? getSkillTargets(wingSkill, enemy.position, wing.targetPos, allUnits).filter((h) =>
            foes.some((f) => f.position.q === h.q && f.position.r === h.r),
          ).length
        : 0;
    const { skill: riftSkill, plan: rift } = riftOffer(enemy, allUnits);
    // One Heart at a time: none is thrown while one is carried
    const heartSkill = majorPending || heartWarning(enemy, store.preparedAttacks) ? undefined : ready('heart');
    const target = heartSkill ? heartCarrier(allUnits) : null;
    const besideTarget = target
      ? foes.filter((f) => f.id !== target.id && hexDistance(f.position, target.position) <= 1).length
      : 0;
    const skyfireSkill = majorPending ? undefined : ready('skyfire');

    const none: DragonOffer = { available: false, value: 0 };
    const chosen = chooseDragonMove({
      boss: enemy,
      units: allUnits,
      hazards: store.hazards,
      majorPending,
      turns: enemy.bossScript?.phaseTurns ?? 0,
      lastUsed: enemy.bossScript?.lastUsed ?? {},
      lastSignature: enemy.bossScript?.step ?? 0,
      offers: {
        // Hunting the carrier, the Claw is worth more than a plain swing
        claw: claw ? { available: true, value: hunt ? HUNT_VALUE : 1 } : none,
        wing: wing ? { available: true, value: arcValue(1.2, wingCaught) } : none,
        // Not a move of its own: the wing is valued with it (`riftFollowsWing`)
        rift: rift && riftSkill ? { available: true, value: riftValue(rift) } : none,
        // Worth more thrown onto a hero with a friend beside them: the burst catches both
        heart: target ? { available: true, value: besideTarget > 0 ? 2.6 : 1.8 } : none,
        skyfire: skyfireSkill ? { available: true, value: 3 } : none,
      },
    });

    const attempt = (move: DragonMove): AIAction | null => {
      switch (move) {
        case 'claw':
          return claw && skillFor('claw')
            ? { type: 'skill', skill: skillFor('claw'), skillTarget: claw.targetPos }
            : null;
        case 'wing':
          return wing && wingSkill ? { type: 'skill', skill: wingSkill, skillTarget: wing.targetPos } : null;
        // Never chosen on its own: it is raised with a Wing Thrust (`cast`, below)
        case 'rift':
          return null;
        case 'heart':
          return target && heartSkill ? { type: 'skill', skill: heartSkill, skillTarget: target.position } : null;
        case 'skyfire':
          return skyfireSkill ? { type: 'skill', skill: skyfireSkill, skillTarget: enemy.position } : null;
      }
    };

    const action = attempt(chosen) ?? attempt('claw');
    if (action?.skill) {
      trace(`${skillName(action.skill)} (scripted)`, { choseSkillId: action.skill.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [action];
    }

    // Nothing in reach: close the distance — the one thing he does without a skill
    const moveTarget = ctx.approach(taunter ? [taunter] : foes);
    trace(moveTarget ? 'no skill in reach — advances' : 'no skill in reach — holds ground'); // i18n-exempt: AI trace, shown only on the dev sim panel
    return moveTarget
      ? [{ type: 'move', targetPos: moveTarget }, { type: 'endturn' }]
      : [{ type: 'endturn' }];
  },

  cast({ caster, skill, target, sink }) {
    if (!isDragon(caster)) return false;
    const store = useCombatStore.getState();
    // The Dragon remembers what he made and when: it is all that stands in for a cycle
    const move = dragonMoveOfSkill(skill);
    if (move) {
      const script = caster.bossScript;
      const turns = script?.phaseTurns ?? 0;
      store.patchBossScript(caster.id, {
        lastUsed: { ...(script?.lastUsed ?? {}), [move]: turns },
        // The wing is instant, so it does not count as a signature
        ...(move !== 'claw' && move !== 'wing' && { step: turns }),
      });
    }
    // The wing is made on the spot: no warning, two blows; and a Rift raked over the party where it left
    // them, when one follows it (`riftFollowsWing`, the rule the chooser valued the wing by)
    if (move === 'wing') {
      strikeWing(caster, skill, target, sink);
      store.markActed(caster.id);
      raiseRiftAfterWing(caster, sink);
      return true;
    }
    // The Rift's line and Skyfire's arena: footprints the Dragon's script builds
    if (isDragonScriptedSkill(skill)) {
      if (castDragonMove(caster, skill, sink).ok) store.markActed(caster.id);
      return true;
    }
    return false;
  },

  beginTurn: (unit) => beginDragonTurn(unit.id),

  // The Heart's burn on whoever carries it, as each of their turns begins
  turnTick: (unit, sink) => burnHeartCarrier(unit.id, sink),

  // A warning of his that struck nobody stokes his fire: one more step on the gauge
  whiff(attack, caster, sink) {
    if (attack.spec.onWhiff !== HEAT_WHIFF || !isDragon(caster)) return;
    const store = useCombatStore.getState();
    const live = unitById(store.units, caster.id) ?? caster;
    store.patchBossScript(live.id, { heat: heatAfterWhiff(live) });
    sink.log('  ' + t('bossLog.dragon.heatClimbs', { name: unitName(live) }), '#ff8a1e');
  },
  land: (landing, caster, sink) => landDragonWarning(landing, caster, sink, sink),
};
