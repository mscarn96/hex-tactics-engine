import type { HexCoord } from '@/models/types';
/** Survives an ambush scene handoff, never a campaign load or defeat. */
let destination: HexCoord | null = null;
let resume = false;
export function rememberTravelDestination(at: HexCoord): void { destination = { ...at }; resume = false; }
export function resumeTravelAfterVictory(): void { destination = null; resume = false; }
export function cancelTravelIntent(): void { destination = null; resume = false; }
export function takeTravelResume(): HexCoord | null {
  if (!resume) return null;
  const at = destination; destination = null; resume = false; return at;
}
