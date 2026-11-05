import { bagFrom } from '@/data/items/bag';
import { useCityStore } from '@/stores/cityStore';
import { useInventoryStore, selectGear } from '@/stores/inventoryStore';
import { Item, Rarity, ResourceType } from '@/models/types';

/**
 * The shelf a defeat cannot reach.
 *
 * Losing strips the bag of everything unequipped and takes gold with it, and
 * that stake stays — what it should not do is make finding a legendary four
 * days from home a reason to turn around. The stash is where that legendary
 * waits, and the only property that matters is the one this file pins: a wipe
 * of `inventoryStore` leaves it alone.
 */

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    name: id,
    description: '',
    rarity: Rarity.Legendary,
    modifiers: { attack: 5 },
    sellPrice: 100,
    ...over,
  } as Item);

beforeEach(() => {
  useCityStore.getState().reset();
  useInventoryStore.getState().reset();
});

const stashNow = () => useCityStore.getState().stash;
const bagNow = () => selectGear(useInventoryStore.getState());

describe('the city stash', () => {
  it('starts empty and takes what it is given', () => {
    expect(stashNow()).toEqual([]);
    useCityStore.getState().deposit(item('a'));
    expect(stashNow().map((i) => i.id)).toEqual(['a']);
  });

  /**
   * The deposit is two writes — onto the shelf, out of the bag — and a double
   * tap lands the first one twice. Two entries sharing an id would then
   * withdraw as two items the game thinks are the same object.
   */
  it('refuses the same instance twice', () => {
    const legendary = item('a');
    useCityStore.getState().deposit(legendary);
    useCityStore.getState().deposit(legendary);
    expect(stashNow()).toHaveLength(1);
  });

  it('hands an item back and forgets it', () => {
    useCityStore.getState().deposit(item('a'));
    expect(useCityStore.getState().withdraw('a')?.id).toBe('a');
    expect(stashNow()).toEqual([]);
  });

  it('returns nothing for something it never held', () => {
    expect(useCityStore.getState().withdraw('ghost')).toBeUndefined();
    expect(stashNow()).toEqual([]);
  });

  /**
   * The whole point, stated as a test.
   *
   * A defeat clears `inventoryStore` — items and treasury both. The stash lives
   * on `cityStore` precisely so that wipe cannot reach it by construction
   * rather than by anybody remembering to skip it.
   */
  it('survives the wipe that empties the bag', () => {
    useInventoryStore.getState().addItem(item('carried'));
    useCityStore.getState().deposit(item('shelved'));

    useInventoryStore.setState({ bag: bagFrom({ gear: [] }) });
    useInventoryStore.getState().clearResources();

    expect(bagNow()).toEqual([]);
    expect(useInventoryStore.getState().resources[ResourceType.Gold]).toBe(0);
    expect(stashNow().map((i) => i.id)).toEqual(['shelved']);
  });

  it('goes with a new game, though', () => {
    useCityStore.getState().deposit(item('a'));
    useCityStore.getState().reset();
    expect(stashNow()).toEqual([]);
  });
});
