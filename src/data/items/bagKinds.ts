import { BagKind } from '@/models/types';
type IconId = string;
const RATION_COLOR = '#d9a05b';
import { BALANCE } from '@/data/balanceConstants';
import { t, type MessageKey } from '@/i18n';

/**
 * Every kind of thing the bag holds, declared once.
 *
 * The bag is one list of entries (`BagEntry`), and this table is what a kind
 * *is* to the rest of the game: its mark (its words are `items.bagKind.<kind>.*`), whether it stacks and how
 * high, and what can be done with it. The bag screen picks the side panel from
 * `panel` and the Handbook's bag page lists the kinds from here, so a new kind
 * — an expansion's tonic, say — is one row here, its entry shape in
 * `models/items.ts` and its action's handler, not a new screen or counter.
 *
 * Pure data: the Node suites and the Handbook read it.
 */

/** What a player can do with an entry, as the bag's panel offers it. */
export type BagAction =
  /** Put the piece on a hero (the bag's wear rows). */
  | 'wear'
  /** Set the gem in an empty socket of a carried piece, free. */
  | 'setInSocket'
  /** Feed one hero (`feedHero`). */
  | 'eat'
  /** Open the way home (`consumeCarriedTownPortal`). */
  | 'use'
  /** Light it, or renew the week that burns (`lightWard`). */
  | 'light';

/** Which side panel the bag shows for a picked entry of the kind. */
export type BagPanelId = 'wear' | 'socket' | 'feed' | 'portal' | 'incense';

export interface BagKindDef {
  kind: BagKind;
  /**
   * The kind's mark. Gear and gems draw their own picture (the piece's model,
   * the stone's colour), so theirs is only what a list of kinds shows.
   */
  icon: IconId;
  /** The mark's tint, where the mark is a tinted one; the meta ink otherwise. */
  tint?: string;
  /** Whether it is held as a count rather than as separate pieces. */
  stackable: boolean;
  /**
   * The most one entry may hold, for a party of this size; `null` for no cap.
   * The store refuses past it where it sells the kind (`buyWard`,
   * `buyTownPortal`); the Tavern asks it before packing a ration.
   */
  cap: (partySize: number) => number | null;
  /** What the kind's panel offers, in order. */
  actions: readonly BagAction[];
  panel: BagPanelId;
}

export const BAG_KINDS: Record<BagKind, BagKindDef> = {
  gear: {
    kind: 'gear', icon: 'slot_mainhand',
    stackable: false, cap: () => null,
    actions: ['wear'], panel: 'wear',
  },
  gem: {
    kind: 'gem', icon: 'gem_ruby',
    stackable: true, cap: () => null,
    actions: ['setInSocket'], panel: 'socket',
  },
  ration: {
    kind: 'ration', icon: 'tavern_ration', tint: RATION_COLOR,
    stackable: true, cap: (partySize) => Math.max(0, partySize) * BALANCE.RATIONS_PER_HERO,
    actions: ['eat'], panel: 'feed',
  },
  townPortal: {
    kind: 'townPortal', icon: 'tavern_portal',
    stackable: true, cap: () => 1,
    actions: ['use'], panel: 'portal',
  },
  incense: {
    kind: 'incense', icon: 'tavern_incense',
    stackable: true, cap: () => BALANCE.WARD_CARRY,
    actions: ['light'], panel: 'incense',
  },
};

/** The grid's order: gear first, then the stacks. */
export const BAG_KIND_ORDER: readonly BagKind[] = ['gear', 'gem', 'ration', 'townPortal', 'incense'];

export const isBagKind = (value: unknown): value is BagKind =>
  typeof value === 'string' && value in BAG_KINDS;

/** One of a kind, as a label: "Trail ration" (`items.bagKind.<kind>.name`). */
export function bagKindName(kind: BagKind): string {
  return t(`items.bagKind.${kind}.name` as MessageKey);
}

/** Several of a kind: "Trail rations". */
export function bagKindPlural(kind: BagKind): string {
  return t(`items.bagKind.${kind}.plural` as MessageKey);
}

/** One line on what a kind is for — the bag's panels and the Handbook's bag page. */
export function bagKindBlurb(kind: BagKind): string {
  return t(`items.bagKind.${kind}.blurb` as MessageKey);
}

/** The most an entry of `kind` may hold for a party of `partySize`; `null` when uncapped. */
export const bagKindCap = (kind: BagKind, partySize: number): number | null => BAG_KINDS[kind].cap(partySize);
