import { BagEntry, BagKind, GearEntry, GemEntry, GemId, Item, PlainStackEntry, StackEntry } from '@/models/types';
import { emptyGemStock, GemStock, GEM_IDS, isGemId } from '@/data/items/gems';
import { BAG_KIND_ORDER, isBagKind } from '@/data/items/bagKinds';

/**
 * The bag's entries and the pure rules over them: reading a kind out, adding
 * to or taking from a stack, and checking a saved list. `inventoryStore` holds
 * the list and writes it only through these.
 *
 * A stack with nothing left is removed rather than kept at zero, so the bag
 * never shows an empty tile, and two entries never hold the same stack.
 */

/** The kinds held as a plain count (no gem id to tell them apart). */
export type PlainStackKind = PlainStackEntry['kind'];

/** Which stack an entry is: its kind, and for a gem which gem. */
export type StackKey = { kind: PlainStackKind } | { kind: 'gem'; gem: GemId };

export const isGearEntry = (entry: BagEntry): entry is GearEntry => entry.kind === 'gear';
export const isStackEntry = (entry: BagEntry): entry is StackEntry => entry.kind !== 'gear';

const sameStack = (entry: BagEntry, key: StackKey): boolean =>
  entry.kind === key.kind && (key.kind !== 'gem' || (entry as GemEntry).gem === key.gem);

/** The gear in the bag, in the order it was put in. */
export const bagGear = (bag: readonly BagEntry[]): Item[] =>
  bag.filter(isGearEntry).map((entry) => entry.item);

/** How many of a stack the bag holds; 0 when there is none. */
export function stackCount(bag: readonly BagEntry[], key: StackKey): number {
  const entry = bag.find((e) => sameStack(e, key));
  return entry && isStackEntry(entry) ? entry.count : 0;
}

/** The loose gems, as a full stock (every gem id, zero where none). */
export function bagGemStock(bag: readonly BagEntry[]): GemStock {
  const stock = emptyGemStock();
  for (const entry of bag) if (entry.kind === 'gem') stock[entry.gem] += entry.count;
  return stock;
}

/**
 * The bag with a stack changed by `delta` (negative to take). A stack that
 * reaches zero leaves the bag; a new one is placed after the stacks of its kind
 * so a gem stays beside the other gems. Never below zero: the caller asks
 * `stackCount` first, as every store action does.
 */
export function withStack(bag: readonly BagEntry[], key: StackKey, delta: number): BagEntry[] {
  const index = bag.findIndex((e) => sameStack(e, key));
  if (index >= 0) {
    const entry = bag[index] as StackEntry;
    const count = Math.max(0, entry.count + delta);
    if (count === 0) return bag.filter((_, i) => i !== index);
    return bag.map((e, i) => (i === index ? { ...entry, count } : e));
  }
  if (delta <= 0) return [...bag];
  const fresh: StackEntry = key.kind === 'gem' ? { kind: 'gem', gem: key.gem, count: delta } : { kind: key.kind, count: delta };
  return [...bag, fresh];
}

/** The bag with a stack set to exactly `count` (removed at zero) — for harnesses and tests. */
export const withStackCount = (bag: readonly BagEntry[], key: StackKey, count: number): BagEntry[] =>
  withStack(bag, key, Math.max(0, count) - stackCount(bag, key));

/** The bag with the gear piece of this id replaced by `next(item)`; unchanged when it is not held. */
export function withGear(bag: readonly BagEntry[], itemId: string, next: (item: Item) => Item): BagEntry[] {
  return bag.map((e) => (e.kind === 'gear' && e.item.id === itemId ? { kind: 'gear', item: next(e.item) } : e));
}

/** A new campaign's bag: only its starting rations. */
export function startingBag(rations: number): BagEntry[] {
  return rations > 0 ? [{ kind: 'ration', count: rations }] : [];
}

/**
 * A bag built from its parts — gear, a gem stock and the plain counts — for the
 * scenario creator, harnesses and tests. Zero counts add no entry.
 */
export function bagFrom({ gear = [], gems = {}, rations = 0, townPortal = 0, incense = 0 }: {
  gear?: readonly Item[];
  gems?: Partial<Record<GemId, number>>;
  rations?: number;
  townPortal?: number;
  incense?: number;
}): BagEntry[] {
  let bag: BagEntry[] = gear.map((item) => ({ kind: 'gear', item }));
  for (const gem of GEM_IDS) bag = withStack(bag, { kind: 'gem', gem }, gems[gem] ?? 0);
  bag = withStack(bag, { kind: 'ration' }, rations);
  bag = withStack(bag, { kind: 'townPortal' }, townPortal);
  return withStack(bag, { kind: 'incense' }, incense);
}

/** Gear and stacks in the order the bag screen lists them: gear first, then the stacks by kind. */
export function bagOrder(bag: readonly BagEntry[]): BagEntry[] {
  const rank = (e: BagEntry) => BAG_KIND_ORDER.indexOf(e.kind) * 100 + (e.kind === 'gem' ? GEM_IDS.indexOf(e.gem) : 0);
  return [...bag].sort((a, b) => rank(a) - rank(b));
}

/** A stable key for an entry: the gear's id, or the stack's kind (and gem). */
export const bagEntryKey = (entry: BagEntry): string =>
  entry.kind === 'gear' ? entry.item.id : entry.kind === 'gem' ? `gem:${entry.gem}` : entry.kind;

/**
 * Whether a saved bag is one this build can restore: an array of entries of
 * known kinds, gear holding an item object, every stack a positive whole count,
 * no stack twice. The items themselves are checked by `savedItemsWellFormed`.
 */
export function validBag(value: unknown): value is BagEntry[] {
  if (!Array.isArray(value)) return false;
  const stacks = new Set<string>();
  for (const raw of value) {
    const entry = raw as Partial<BagEntry> | null;
    if (!entry || typeof entry !== 'object' || !isBagKind(entry.kind)) return false;
    if (entry.kind === 'gear') {
      const item = (entry as GearEntry).item;
      if (!item || typeof item !== 'object' || typeof item.id !== 'string') return false;
      continue;
    }
    const stack = entry as StackEntry;
    if (!Number.isSafeInteger(stack.count) || stack.count <= 0) return false;
    if (stack.kind === 'gem' && !isGemId(stack.gem)) return false;
    const key = bagEntryKey(stack);
    if (stacks.has(key)) return false;
    stacks.add(key);
  }
  return true;
}

/** Every stack kind but gems, the ones a stack key names by kind alone. */
export const PLAIN_STACK_KINDS: readonly PlainStackKind[] = ['ration', 'townPortal', 'incense'];

export const isPlainStackKind = (kind: BagKind): kind is PlainStackKind =>
  (PLAIN_STACK_KINDS as readonly BagKind[]).includes(kind);
