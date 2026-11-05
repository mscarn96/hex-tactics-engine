import type { CombatUnit, HeroSkill, HexCoord, PreparedAttack } from '@/models/types';
import type { AIAction } from '@/systems/combat/aiTypes';
import type { CombatSink } from '@/systems/combat/combatSink';
import type { DecideContext, EncounterScript, Landing } from '@/systems/combat/encounterScript';
import type { PreparedPreview } from '@/systems/combat/preparedAttacks';
import { useCombatStore } from '@/stores/combatStore';
import { bossOf, turnBegun } from '@/systems/combat/bossRegistry';
import { unitById } from '@/systems/combat/unitLookup';
import { aethelredScript } from '@/systems/combat/scripts/aethelred';
import { trollScript } from '@/systems/combat/scripts/troll';
import { dragonScript } from '@/systems/combat/scripts/dragon';
import { heartScript } from '@/systems/combat/scripts/heart';
import { elitesScript } from '@/systems/combat/scripts/elites';
import { factionElitesScript } from '@/systems/combat/scripts/factionElites';
import { fallenOrderScript } from '@/systems/combat/scripts/fallenOrder';
import { yokaiScript } from '@/systems/combat/scripts/yokai';
// Jadeveil: Silent Hall / Fallen Order
import { lastLessonScript } from '@/systems/combat/scripts/lastLesson';
// Jadeveil: Kairen, the summit's boss
import { kairenScript } from '@/systems/combat/scripts/kairen';

/**
 * Every boss and elite script, and the one walk over them per hook point.
 *
 * **A new encounter is one file** in `scripts/` and one line here. The order is
 * the order the hand-written ladders ran in, and it is the order of the hooks
 * that chain (`beforeLanding`: the Troll's leap, then the Burrowmother's burrow,
 * then the Colossus's tomb). A boss's pure half — who it is, where it starts, what it
 * writes when a hero is healed, what its panel shows — is its entry in `bossRegistry`,
 * which the store can import because it imports nothing that imports the store; the
 * entry names its script here by id (`Boss.script`).
 */
export const SCRIPTS: readonly EncounterScript[] = [
  aethelredScript,
  trollScript,
  dragonScript,
  heartScript,
  elitesScript,
  factionElitesScript,
  fallenOrderScript,
  yokaiScript,
  // Jadeveil: Silent Hall / Fallen Order
  lastLessonScript,
  // Jadeveil: Kairen
  kairenScript,
];

/**
 * A registry over a list of scripts. The app's is built from `SCRIPTS` below; the
 * suite builds its own from recording scripts to pin the order the hooks run in.
 */
export function createScriptRegistry(scripts: readonly EncounterScript[]) {
  return {
    /** The first script that has an opinion on how this unit acts. */
    decide(ctx: DecideContext): AIAction[] | null {
      for (const script of scripts) {
        const actions = script.decide?.(ctx);
        if (actions) return actions;
      }
      return null;
    },
    /** Whether a script took this skill (`true`), or it is an ordinary one for the resolver. */
    cast(caster: CombatUnit, skill: HeroSkill, target: HexCoord, bossStep: number | undefined, sink: CombatSink): boolean {
      return scripts.some((script) => script.cast?.({ caster, skill, target, bossStep, sink }) === true);
    },
    betweenTurns(sink: CombatSink): void {
      for (const script of scripts) script.betweenTurns?.(sink);
    },
    /**
     * A unit's regular turn is beginning: every script's own turn start, then — for a boss — the
     * counting every boss does alike (`bossRegistry.turnBegun`), once, after its script has read
     * the counters as they stood.
     */
    beginTurn(unit: CombatUnit, sink: CombatSink): void {
      const boss = unit.currentHp > 0 ? bossOf(unit) : undefined;
      for (const script of scripts) script.beginTurn?.(unit, sink);
      if (!boss) return;
      const store = useCombatStore.getState();
      const now = unitById(store.units, unit.id);
      if (now) store.patchBossScript(now.id, turnBegun(now));
    },
    /** A unit's regular turn is beginning, before it is known whether it may act: every script's `turnTick`. */
    turnTick(unit: CombatUnit, sink: CombatSink): void {
      for (const script of scripts) script.turnTick?.(unit, sink);
    },
    /** Whether a script landed this warning whole. */
    land(landing: Landing, caster: CombatUnit, sink: CombatSink): boolean {
      return scripts.some((script) => script.land?.(landing, caster, sink) === true);
    },
    /** Where the ordinary strike is made from, after every script has had its say in turn. */
    striker(attack: PreparedAttack, caster: CombatUnit, sink: CombatSink): CombatUnit {
      return scripts.reduce((striker, script) => script.beforeLanding?.(attack, striker, sink) ?? striker, caster);
    },
    afterLanding(attack: PreparedAttack, caster: CombatUnit, sink: CombatSink, held?: PreparedPreview): void {
      for (const script of scripts) script.afterLanding?.(attack, caster, sink, held);
    },
    /** A landing struck nobody: the script named by the warning's `onWhiff` answers it. */
    whiff(attack: PreparedAttack, caster: CombatUnit, sink: CombatSink): void {
      for (const script of scripts) script.whiff?.(attack, caster, sink);
    },
    afterCast(caster: CombatUnit, skill: HeroSkill, kind: 'prepare' | 'strike', sink: CombatSink): void {
      for (const script of scripts) script.afterCast?.(caster, skill, kind, sink);
    },
  };
}

const registry = createScriptRegistry(SCRIPTS);

export const scriptDecide = registry.decide;
export const scriptCast = registry.cast;
export const scriptsBetweenTurns = registry.betweenTurns;
export const scriptsBeginTurn = registry.beginTurn;
export const scriptsTurnTick = registry.turnTick;
export const scriptLand = registry.land;
export const scriptStriker = registry.striker;
export const scriptsAfterLanding = registry.afterLanding;
export const scriptsAfterCast = registry.afterCast;
export const scriptsWhiff = registry.whiff;
