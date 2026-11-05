import type { CombatUnit } from './types';
import type { EncounterPlan } from '@/systems/world/encounterGenerator';
/** A committed fight restarts from this entry snapshot after loading. */
export interface EncounterEntry {
  id: string;
  plan: EncounterPlan;
  players: CombatUnit[];
  enemies: CombatUnit[];
  /** The level enemies were scaled to: the party's mean, or beyond the Empire the content's fixed level. */
  partyLevel: number;
  powerScale: number;
  resolved: boolean;
}
