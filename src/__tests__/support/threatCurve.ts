import { shapesFor } from '@/systems/world/encounterGenerator';
import { EnemyRole, Faction, factionCandidates, membersForRole } from '@/data/templates/factions';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { ThreatBand, threatPowerScale } from '@/systems/world/threat';
import { TileType } from '@/models/types';

/**
 * The difficulty curve, computed rather than sampled.
 *
 * Shared measurement code, not a suite — `homeRing.test.ts` wants the shape of
 * the curve across the bands and `threatDepth.test.ts` wants the same arithmetic
 * evaluated at two depths per band. Two copies of a triple sum over factions,
 * shapes and roles is two things that drift, and the drift would be invisible:
 * both suites would keep passing against different definitions of "harder".
 *
 * Every input is available exactly, so nothing here rolls anything.
 * `factionCandidates` expresses its weights as duplicate entries, so counting
 * entries gives the distribution; shape weights are in the table; and a role's
 * contribution is the mean over the members it resolves to. The expectation is a
 * triple sum with **zero variance** — which matters, because the sampled version
 * this replaced had ~2% standard error on the bimodal bands 3 and 4, and a
 * narrow step turned the suite intermittently red rather than red.
 */

const byId = new Map(enemyTemplates.map((t) => [t.id as string, t]));

/**
 * What one body is worth.
 *
 * `maxHp + attack × 5` ignores `magic` entirely, so it undervalues every caster
 * — which makes it conservative in a known direction against any change that
 * adds caster and ranged slots. Fixing that is worth doing in a commit of its
 * own, with the before/after curve recorded; changed here, nobody could tell
 * which edit moved the numbers.
 */
const weightOf = (id: string): number => {
  const s = byId.get(id)!.baseStats;
  return s.maxHp + s.attack * 5;
};

const roleWeight = (faction: Faction, role: EnemyRole): number => {
  const members = membersForRole(faction, role);
  return members.reduce((sum, id) => sum + weightOf(id), 0) / members.length;
};

/**
 * Expected stat weight of the bodies a random encounter fields at this band,
 * before the ground multiplies them.
 *
 * `fromCastle` defaults to 2 rather than to `Infinity` so the leashed factions
 * are in the pool: the curve is meant to describe the hardest honest reading of
 * a band, and excluding the Legion from bands 3–4 would flatter both.
 */
export function bandComposition(
  band: ThreatBand,
  terrain: TileType = TileType.Plains,
  fromCastle: number = 2,
): number {
  const candidates = factionCandidates(band, terrain, fromCastle);
  let total = 0;
  for (const faction of candidates) {
    const shapes = shapesFor(band, faction);
    const shapeTotal = shapes.reduce((n, s) => n + (s.weight ?? 1), 0);
    for (const shape of shapes) {
      const fight = shape.roles.reduce((n, role) => n + roleWeight(faction, role), 0);
      total += fight * ((shape.weight ?? 1) / shapeTotal) / candidates.length;
    }
  }
  return total;
}

/**
 * What a fight on a particular piece of ground actually weighs: who turns up,
 * times what the ground multiplies their stats by.
 *
 * Both halves are needed and neither alone is the difficulty curve. Composition
 * carries the integer steps — the elite arriving, the third body — and it is
 * where the 1→2 cliff lives; `threatPowerScale` carries the continuous part and
 * is the only half depth or the zone can move. A continuity check against the
 * multiplier alone would pass trivially and measure nothing.
 *
 * **`bandComposition` takes no `haunted`, and that is the assertion rather than
 * an omission.** Haunted ground fields the same bodies in the same arrangement
 * as the corridor beside it — it only makes them stronger — so the composer,
 * the shape table and `shapeViolations`' two invariants are untouched by the
 * second axis. If a future change ever gives haunted ground its own roster, this
 * signature is where it has to be admitted, and every seam number below moves.
 */
export function bandDifficulty(band: ThreatBand, depth: number, haunted = false): number {
  return bandComposition(band) * threatPowerScale(band, depth, haunted);
}
