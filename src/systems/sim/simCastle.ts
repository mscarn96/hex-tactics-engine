import { EncounterContext } from '@/models/encounter';
import { locationContext } from '@/locations';
import { useEmpireStore } from '@/stores/empireStore';
import { castleEncounterId, clampTier } from '@/systems/world/castle';

/**
 * The tuning harness's castle chain: a real castle run, fielded the way the balance lab's chain is.
 *
 * Nothing here builds a fight. It opens the run on the castle's own encounter id, so every stage is the
 * game's: `planForEncounter` names the stage's roster (`castleStageEnemies`), `encounterPowerScale`
 * prices it by `castleStagePower` (ahead of the harness's own multiplier), `buildEncounter` takes its
 * health down to `CASTLE_HP_SCALE`, and the victory handler carries health and mana by `castleStageCarry`
 * and starts the next stage. Those are the rules the lab's `runCastleChain` reads, so the harness and
 * the lab field the same four fights.
 *
 * Two things differ from a campaign run, both so the chain stays the lab's: no Seal is spent (the
 * empire store is written directly, and `simStore.exit` puts it back), and the heroes take no XP
 * between stages (`applyVictory`), since a level gained after the Gate would rescale the Yard.
 */

export interface SimCastleStart {
  encounterId: string;
  context: EncounterContext;
}

/** Opens a harness castle run at `tier` and returns the first stage to start. Call after `simStore.enter`. */
export function startSimCastle(tier: number): SimCastleStart {
  const t = clampTier(tier);
  useEmpireStore.setState({ castleTier: t, castleStage: 0 });
  return { encounterId: castleEncounterId(t, 0), context: locationContext('castle') };
}
