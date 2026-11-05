import { ArenaHazard, CombatUnit, EncounterWave, HexCoord, WaveState } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { arenaHexes } from '@/systems/combat/arenaGeometry';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { hasMessage, t } from '@/i18n';

/**
 * Announced waves, as pure rules over a roster.
 *
 * A wave is reinforcement an encounter *tells the party about*: the fight does
 * not end between waves, victory and rewards wait for the last of them, and
 * each wave happens once. The store holds the list (`combatStore.waves`);
 * this file owns what the list means and `waveResolve` puts the arrival on the
 * board, from `beginTurn` — so a wave always comes in *between* two turns and
 * never inside somebody's action.
 *
 * The three promises it keeps, pinned by `waves.test.ts`:
 *
 * - **Nothing spawns on a unit or on solid ground.** Every arrival hex is free
 *   of any living body, objectives included, and of solid hazards.
 * - **The board never overfills.** A wave brings the living enemies up to its
 *   `maxActive` and no further; the rest arrive in instalments as bodies fall,
 *   so a swarm is bounded by what the arena can read.
 * - **No wave repeats.** Each is `waiting → arriving → done`, once, and an
 *   encounter may carry only `WAVE_MAX_PER_ENCOUNTER` of them.
 */

export function createWaveStates(waves: readonly EncounterWave[]): WaveState[] {
  return waves.map((wave) => ({ wave, status: 'waiting', pending: [...wave.templateIds] }));
}

/** Waves the fight is still waiting on: while any is, the fight is not over. */
export function pendingWaveCount(states: readonly WaveState[]): number {
  return states.filter((w) => w.status !== 'done').length;
}

/** The enemies that count as the opposition: alive, not an objective. */
export const livingEnemies = (units: readonly CombatUnit[]): CombatUnit[] =>
  units.filter((u) => !u.isPlayer && u.currentHp > 0 && !u.objective);

/** Whether a wave's trigger has been met. */
export function waveTriggered(wave: EncounterWave, units: readonly CombatUnit[]): boolean {
  switch (wave.trigger.kind) {
    case 'enemiesFallen':
      return livingEnemies(units).length === 0;
    case 'unitFallen': {
      const { templateId } = wave.trigger;
      return units.some((u) => !u.isPlayer && u.templateId === templateId && u.currentHp <= 0);
    }
  }
}

/**
 * The wave that should be arriving now, if any. Waves go strictly in order: a
 * later wave cannot trigger while an earlier one is waiting or arriving, which
 * is what keeps "after the second batch" from firing off the first's deaths.
 */
export function waveDue(
  states: readonly WaveState[],
  units: readonly CombatUnit[],
): WaveState | undefined {
  const next = states.find((w) => w.status !== 'done');
  if (!next) return undefined;
  if (next.status === 'arriving') return next;
  return waveTriggered(next.wave, units) ? next : undefined;
}

const blocked = (hazards: readonly ArenaHazard[]): Set<string> => {
  const keys = new Set<string>();
  for (const h of hazards) if (h.solid) for (const hex of h.hexes) keys.add(hexKey(hex));
  return keys;
};

/**
 * Free hexes a wave can arrive on, best first: the back of the enemy side
 * (negative `r`, where an encounter opens), clear of the party where the board
 * allows. The distance preference relaxes before the board is ever refused.
 */
export function waveSpawnHexes(
  count: number,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): HexCoord[] {
  if (count <= 0) return [];
  const living = units.filter((u) => u.currentHp > 0);
  const taken = new Set(living.map((u) => hexKey(u.position)));
  const solid = blocked(hazards);
  const heroes = living.filter((u) => u.isPlayer);

  const free = arenaHexes().filter((h) => !taken.has(hexKey(h)) && !solid.has(hexKey(h)));
  const clearance = (h: HexCoord) =>
    heroes.length === 0 ? Infinity : Math.min(...heroes.map((u) => hexDistance(u.position, h)));
  const order = (a: HexCoord, b: HexCoord) => a.r - b.r || Math.abs(a.q) - Math.abs(b.q) || a.q - b.q;

  for (const minClear of [2, 1, 0]) {
    const pool = free.filter((h) => clearance(h) >= minClear).sort(order);
    if (pool.length >= count) return pool.slice(0, count);
  }
  return free.sort(order).slice(0, count);
}

export interface WaveArrival {
  /** Templates taking the field now, paired with `hexes`. */
  templateIds: string[];
  hexes: HexCoord[];
  /** Templates still to come on a later turn. */
  remaining: string[];
}

/**
 * What arrives now: as many as the active-unit limit and the free hexes allow,
 * in authored order. An empty arrival with bodies remaining means the board is
 * full for now — the caller leaves the wave `arriving` and asks again later.
 */
export function planArrival(
  state: WaveState,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): WaveArrival {
  const cap = state.wave.maxActive ?? BALANCE.WAVE_MAX_ACTIVE;
  const slots = Math.max(0, cap - livingEnemies(units).length);
  const want = Math.min(slots, state.pending.length);
  const hexes = waveSpawnHexes(want, units, hazards);
  const n = Math.min(want, hexes.length);
  return {
    templateIds: state.pending.slice(0, n),
    hexes: hexes.slice(0, n),
    remaining: state.pending.slice(n),
  };
}

/**
 * What is wrong with an encounter's waves, as a list of sentences. Empty means
 * they are legal. `known` is the set of template ids that exist.
 */
export function waveViolations(
  waves: readonly EncounterWave[],
  known?: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  if (waves.length > BALANCE.WAVE_MAX_PER_ENCOUNTER) {
    out.push(`${waves.length} waves, at most ${BALANCE.WAVE_MAX_PER_ENCOUNTER}`); // i18n-exempt: authoring check on encounter data
  }
  const seen = new Set<string>();
  for (const wave of waves) {
    if (seen.has(wave.id)) out.push(`${wave.id}: duplicate id`); // i18n-exempt: authoring check on encounter data
    seen.add(wave.id);
    if (wave.templateIds.length === 0) out.push(`${wave.id}: brings nobody`); // i18n-exempt: authoring check on encounter data
    if (wave.templateIds.length > BALANCE.WAVE_MAX_SIZE) {
      out.push(`${wave.id}: ${wave.templateIds.length} bodies, at most ${BALANCE.WAVE_MAX_SIZE}`); // i18n-exempt: authoring check on encounter data
    }
    if (!hasMessage(`factions.wave.${wave.id}.announce`)) out.push(`${wave.id}: no announcement`); // i18n-exempt: authoring check on encounter data
    if (known) {
      for (const id of wave.templateIds) if (!known.has(id)) out.push(`${wave.id}: unknown template ${id}`); // i18n-exempt: authoring check on encounter data
    }
  }
  return out;
}

/**
 * Where the fight is in its waves, for the HUD counter: the enemies the fight
 * opened with are wave 1, and each announced wave is one more. A wave counts as
 * current from the moment it starts arriving. Null for a fight without waves,
 * which shows no counter at all.
 */
export function waveProgress(
  states: readonly WaveState[],
): { current: number; total: number; toCome: number } | null {
  if (states.length === 0) return null;
  const toCome = states.filter((w) => w.status === 'waiting').length;
  return { current: 1 + states.length - toCome, total: 1 + states.length, toCome };
}

/**
 * What the party is told at the start of a fight with waves. "Incoming" rather
 * than "may follow": victory waits for every wave (`pendingWaveCount`), and
 * every trigger is met on the way to a win, so each one *will* come.
 */
export function waveAnnouncement(count: number): string | null {
  if (count <= 0) return null;
  return t('bossLog.waves.incoming', { count });
}
