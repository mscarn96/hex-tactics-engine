import { GemId, Item, ResourceType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { forgeCost, ResourceCost } from '@/systems/economy/forge';
import { rollCrystal } from '@/systems/progression/upgrades';
import { salvageInk } from '@/systems/economy/jadeveilRewards';

/**
 * Breaking an unwanted item down for parts.
 *
 * Deliberately the *opposite* trade from selling: a sale pays gold, a salvage
 * pays the raw materials the forge actually gates on. Gold accumulates from
 * every fight, but Iron and Crystal only come from map nodes — so the choice is
 * a real one rather than "salvage is sell at a worse rate".
 *
 * The yield is a fraction of what forging the same item would have cost, which
 * keeps salvage from ever being a way to farm materials: breaking down a
 * crafted item always loses.
 */

/** Materials returned for breaking `item` down. Never includes gold. */
export function salvageYield(item: Pick<Item, 'form' | 'motif'>): ResourceCost {
  const cost = forgeCost(item.form, item.motif);
  const out: ResourceCost = {};

  for (const [resource, amount] of Object.entries(cost) as [ResourceType, number][]) {
    if (resource === ResourceType.Gold) continue;
    const yielded = Math.floor(amount * BALANCE.SALVAGE_RATE);
    // A salvage that returns nothing reads as a bug, so the floor is one unit
    if (yielded > 0) out[resource] = yielded;
    else out[resource] = 1;
  }

  return out;
}

/** Whether breaking this down returns anything at all. */
export function isSalvageable(item: Pick<Item, 'form' | 'motif'>): boolean {
  return Object.keys(salvageYield(item)).length > 0;
}

/**
 * What breaking an item down actually produces, Crystals included.
 *
 * A legendary yields the same materials as anything else plus a roll for an
 * Obsidian Crystal — which is the whole reason an off-path legendary is worth
 * having rather than being a slot you cannot use. A piece of Jadeveil's own gear
 * also gives back Spirit Ink (`jadeveilRewards.salvageInk`), and every gem set in
 * the piece comes back whole (`setGems`).
 */
export function salvageOutcome(
  item: Pick<Item, 'form' | 'motif' | 'rarity' | 'itemLevel' | 'world' | 'sockets'>,
): { resources: ResourceCost; crystals: number; ink: number; gems: GemId[] } {
  return {
    gems: setGems(item),
    resources: salvageYield(item),
    crystals: rollCrystal(item) ? 1 : 0,
    // The range's own gear gives back some of the Ink it is forged with
    ink: salvageInk(item),
  };
}

/**
 * The gems set in a piece, which salvage hands back to the bag whole (playtest
 * 2026-10-23b): the anvil breaks the metal, not the stones. Taking one out at
 * the Forge still costs gold because the piece survives that.
 */
export function setGems(item: Pick<Item, 'sockets'>): GemId[] {
  return (item.sockets ?? []).filter((gem): gem is GemId => gem !== null);
}
