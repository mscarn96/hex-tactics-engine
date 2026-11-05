import AsyncStorage from '@/platform/keyValueStore';
import { SimHeroConfig } from '@/systems/sim/simHarness';

/**
 * Saved fight setups for the tuning harness.
 *
 * Tuning is comparative: the same party against the same three fights, one
 * number changed. Rebuilding a four-hero party with paths, twelve nodes and nine
 * slots each between every measurement is most of the work and all of the error,
 * so a setup is something you keep and *modify*.
 *
 * Stored under its own AsyncStorage key, never in `engine_save`:
 *
 * - a harness setup is not game state, and putting it in the save would mean a
 *   `SAVE_VERSION` bump — and a discarded save — every time this shape changes;
 * - `simStore.exit()` restores the stores a fight wrote, so anything the harness
 *   wants to *keep* has to live outside them by construction.
 *
 * Unlike the save, presets **do** migrate leniently: a preset naming a hero
 * template or an item that no longer exists is dropped field by field on load
 * (`buildSimHero` and the item pickers already ignore ids they cannot resolve),
 * because losing a saved setup to a renamed item is a worse outcome than a
 * loadout coming back one ring short.
 */

const PRESET_KEY = 'engine_sim_presets';

export interface SimPreset {
  name: string;
  party: SimHeroConfig[];
  /** Enemy template id → count, exactly as the setup screen holds it. */
  foes: Record<string, number>;
  powerScale: number;
}

export async function loadPresets(): Promise<SimPreset[]> {
  const raw = await AsyncStorage.getItem(PRESET_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SimPreset[]).filter(isPreset) : [];
  } catch {
    return [];
  }
}

/** Writes the preset, replacing any with the same name. Returns the new list. */
export async function savePreset(preset: SimPreset): Promise<SimPreset[]> {
  const name = preset.name.trim() || 'untitled';
  const others = (await loadPresets()).filter((p) => p.name !== name);
  const next = [...others, { ...preset, name }].sort((a, b) => a.name.localeCompare(b.name));
  await AsyncStorage.setItem(PRESET_KEY, JSON.stringify(next));
  return next;
}

export async function deletePreset(name: string): Promise<SimPreset[]> {
  const next = (await loadPresets()).filter((p) => p.name !== name);
  await AsyncStorage.setItem(PRESET_KEY, JSON.stringify(next));
  return next;
}

function isPreset(value: unknown): value is SimPreset {
  const p = value as SimPreset | null;
  return (
    !!p &&
    typeof p.name === 'string' &&
    Array.isArray(p.party) &&
    typeof p.foes === 'object' &&
    p.foes !== null
  );
}
