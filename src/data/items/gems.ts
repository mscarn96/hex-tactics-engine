import { BALANCE } from '@/data/balanceConstants';
import { GemId, GemKind, GemTier, ItemModifiers, Rarity } from '@/models/types';
import { t, type MessageKey } from '@/i18n';
import { modifierLabel } from '@/data/items/itemText';
import { worldBand } from '@/data/levelCap';
import type { WorldId } from '@/data/worlds';

export const GEM_KINDS: GemKind[] = ['ruby', 'sapphire', 'jade', 'amber'];
/**
 * Cut and Brilliant are the core game's, and each expansion brings a tier of its
 * own (designer, 2026-10-22): Jadeveil's Spirit now, and later Archipelago's
 * `abyssal`, Astral Reach's `astral` and Violet City's `regal` with their worlds
 * (the private project notes, *Equipment across worlds*). Every tier
 * above Cut is merged from two of another. Which one, and an expansion tier's
 * power, follow the order the campaign took its worlds in, not this list.
 */
export const GEM_TIERS: GemTier[] = ['cut', 'brilliant', 'spirit'];
export const GEM_IDS: GemId[] = GEM_TIERS.flatMap((tier) =>
  GEM_KINDS.map((kind) => `${kind}_${tier}` as GemId));
export type GemStock = Record<GemId, number>;

export function emptyGemStock(): GemStock {
  return Object.fromEntries(GEM_IDS.map((id) => [id, 0])) as GemStock;
}

export function validGemStock(value: unknown): value is GemStock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const stock = value as Record<string, unknown>;
  return Object.keys(stock).length === GEM_IDS.length
    && GEM_IDS.every((id) => Number.isSafeInteger(stock[id]) && (stock[id] as number) >= 0);
}

export const GEM_STAT: Record<GemKind, keyof ItemModifiers> = {
  ruby: 'attack', sapphire: 'magic', jade: 'maxHpPercent', amber: 'speed',
};

export function isGemId(value: unknown): value is GemId {
  return typeof value === 'string' && GEM_IDS.includes(value as GemId);
}

export function gemKind(id: GemId): GemKind {
  return id.split('_')[0] as GemKind;
}

export function gemTier(id: GemId): GemTier {
  return id.split('_')[1] as GemTier;
}

/**
 * The world a tier belongs to: `null` for the core game's, which every campaign
 * has. An expansion's tier merges up at the Forge only once its world has a band,
 * and drops only in that world (`gemRewards.ts`).
 */
export const GEM_TIER_WORLD: Record<GemTier, WorldId | null> = {
  cut: null, brilliant: null, spirit: 'jadeveil',
};

/** The tiers the Forge merges into, lowest first: every tier but Cut. */
export const GEM_MERGE_TIERS: GemTier[] = GEM_TIERS.slice(1);

/**
 * A tier's **grade**: the level band its world took, read from the ledger through
 * `levelCap.worldBand`, as `itemLevel.ts` reads the cap. A world's band never
 * changes and gems never leave their campaign, so every gem of a tier in a
 * campaign has one grade and nothing is stored per gem. Grade 1 until the world
 * has a band; the core tiers have no band and are always grade 1.
 */
export function gemGrade(tier: GemTier): number {
  const world = GEM_TIER_WORLD[tier];
  return (world && worldBand(world)) || 1;
}

/**
 * The tier two of which merge into `tier`, under a statement of who holds which
 * band: an expansion's tier merges from the tier of the world one band below its
 * own, and if that world has no tier yet, from the highest tier below that exists.
 * Below every expansion's, that is Brilliant. Pure, and over any table of tiers, so
 * the suite can run a stub tier beside Spirit in either order.
 */
export function gemMergeSourceIn(
  tier: string,
  bandOf: (world: WorldId) => number | null,
  tierWorld: Readonly<Record<string, WorldId | null>> = GEM_TIER_WORLD,
): string | null {
  if (tier === 'cut') return null;
  const world = tierWorld[tier];
  if (!world) return 'cut';
  const band = bandOf(world) ?? 1;
  let source = 'brilliant';
  let sourceBand = 0;
  for (const [other, otherWorld] of Object.entries(tierWorld)) {
    const otherBand = otherWorld && bandOf(otherWorld);
    if (otherBand && otherBand < band && otherBand > sourceBand) {
      source = other;
      sourceBand = otherBand;
    }
  }
  return source;
}

/** `gemMergeSourceIn` for the running campaign; `null` for Cut, which only drops or is bought. */
export function gemMergeSource(tier: GemTier): GemTier | null {
  return gemMergeSourceIn(tier, worldBand) as GemTier | null;
}

/** The Forge's gold for merging into `tier`: an expansion's tier by its grade. */
export function gemMergeGold(tier: GemTier): number {
  return GEM_TIER_WORLD[tier] ? BALANCE.GEM_WORLD_TIER_GOLD[gemGrade(tier) - 1] : BALANCE.GEM_CUT_GOLD;
}

/** Whether `tier` is offered in a campaign where `hasBand` says which worlds have taken one. */
export function gemTierOpen(tier: GemTier, hasBand: (world: WorldId) => boolean): boolean {
  const world = GEM_TIER_WORLD[tier];
  return world === null || hasBand(world);
}

/** The tier that is a world's own, which only drops there; `null` for the Empire. */
export function worldGemTier(world: WorldId): GemTier | null {
  return GEM_TIERS.find((tier) => GEM_TIER_WORLD[tier] === world) ?? null;
}

export function gemBonus(id: GemId): { stat: keyof ItemModifiers; value: number } {
  const kind = gemKind(id);
  const tier = gemTier(id);
  const row = tier === 'spirit' ? BALANCE.GEM_BONUS.spirit[gemGrade(tier) - 1] : BALANCE.GEM_BONUS[tier];
  return { stat: GEM_STAT[kind], value: row[kind] };
}

export function rollSocketCapacity(rarity: Rarity, rng: () => number): number {
  if (rarity === Rarity.Common) return 0;
  const [zero, one] = BALANCE.GEM_SOCKET_WEIGHTS[rarity];
  const value = rng();
  return value < zero ? 0 : value < zero + one ? 1 : 2;
}

export function validSockets(value: unknown, rarity: Rarity): value is (GemId | null)[] {
  return rarity in BALANCE.GEM_SOCKET_WEIGHTS
    && Array.isArray(value)
    && value.length < BALANCE.GEM_SOCKET_WEIGHTS[rarity].length
    && BALANCE.GEM_SOCKET_WEIGHTS[rarity][value.length] > 0
    && value.every((entry) => entry === null || isGemId(entry));
}

/** A gem's name: "Cut Ruby" / "Szlifowany rubin", "Spirit Ruby" / "Duchowy rubin" (`items.gem.<id>.name`). */
export function gemName(id: GemId): string {
  return t(`items.gem.${id}.name` as MessageKey);
}

/** What a gem adds, as an item's stat line says it: "+5 Attack", "+4% HP". */
export function gemBonusText(id: GemId): string {
  const { stat, value } = gemBonus(id);
  return t('items.line.stat', { value: `+${value}${stat === 'maxHpPercent' ? '%' : ''}`, stat: modifierLabel(stat) });
}
