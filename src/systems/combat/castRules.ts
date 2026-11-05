import type { CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import type { CombatSink } from '@/systems/combat/combatSink';
import type { CastRule } from '@/systems/combat/encounterScript';
import { aethelredCast } from '@/systems/combat/bossActions';
import { geasCast } from '@/systems/combat/eliteWarnings';

/**
 * Every encounter's answer to a paid cast, and the one walk over them.
 *
 * The resolver had these by hand at each place a cast is paid for — the Writ's cost (which also
 * answered a Foreclosure seal) and then the Geas, at the end of an ordinary cast, a Spirit Hunt,
 * Marked Prey's release, and the Geas alone at a warning's announcement — so a new cast path had
 * to remember every curse in the game. It now fires `castPaid` once per paid cast and names no
 * encounter. The order is the order the hand-written calls ran in: Aethelred's seal and Writ,
 * then the Crone's Geas. An announcement now asks the Writ and the seals as well, which answer
 * only a hero, and only enemies announce warnings.
 */
export const CAST_RULES: readonly CastRule[] = [aethelredCast, geasCast];

/** `caster` has paid for `skill`, whose blows landed on `struck`: every rule answers in turn. */
export function castPaid(caster: CombatUnit, skill: HeroSkill, struck: readonly string[], sink: CombatSink): void {
  const fx = {
    log: (text: string, color: string) => sink.log(text, color),
    float: (at: HexCoord, text: string, color: string) => sink.float(at, text, color),
  };
  for (const rule of CAST_RULES) rule.paid(caster, skill, struck, fx);
}
