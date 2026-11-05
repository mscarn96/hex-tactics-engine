import { BALANCE } from '@/data/balanceConstants';
import { GemId, Item, ItemModifiers, Rarity } from '@/models/types';
import { effectiveModifiers } from '@/systems/progression/itemStats';
import { gemBonus, gemBonusText, gemName } from '@/data/items/gems';
import { modifierLines } from '@/data/display/itemDisplay';
import { formatNumber, t, type MessageKey } from '@/i18n';

/**
 * Where a loose gem goes, said where the gem is seen: the reward, the bag and
 * the Forge's merging bench, each in one short line beside a link to the
 * Handbook's gems page, which holds the rules (`socketRuleText` among them).
 * Common gear (the starter kit included) never has a socket, so the bag's
 * line says when nothing carried can take one. Gems are set in the bag, free;
 * the Forge takes them back out and merges them, for gold. Rules: `docs/quests-progression-items.md`.
 */

/** One empty socket on a piece the party carries, worn or not. */
export interface OpenSocket {
  item: Item;
  socket: number;
}

/** What the party carries that could take a gem. */
export interface SocketSpace {
  /** Pieces with any socket, filled or not. */
  socketed: number;
  /** Every empty socket, in carrying order. */
  open: OpenSocket[];
}

export function socketSpace(items: readonly Item[]): SocketSpace {
  const socketed = items.filter((item) => (item.sockets?.length ?? 0) > 0);
  const open = socketed.flatMap((item) => (item.sockets ?? [])
    .map((gem, socket) => (gem === null ? { item, socket } : null))
    .filter((entry): entry is OpenSocket => entry !== null));
  return { socketed: socketed.length, open };
}

/**
 * Pieces with an empty socket first, so the bag's first offer is one a gem can
 * go into; otherwise carrying order.
 */
export function openSocketsFirst(items: readonly Item[]): Item[] {
  const hasOpen = (item: Item) => (item.sockets ?? []).some((gem) => gem === null);
  return [...items].sort((a, b) => Number(hasOpen(b)) - Number(hasOpen(a)));
}

/** The most sockets a piece of `rarity` can roll, read from the socket weights. */
export function maxSocketsFor(rarity: Rarity): number {
  const weights = BALANCE.GEM_SOCKET_WEIGHTS[rarity];
  return weights.reduce<number>((most, weight, count) => (weight > 0 ? count : most), 0);
}

/** A rarity as it reads before "gear" in the socket rule; Common has its own sentence. */
const RARITY_WORD: Record<Exclude<Rarity, Rarity.Common>, MessageKey> = {
  [Rarity.Rare]: 'economy.socket.rarity.rare',
  [Rarity.Epic]: 'economy.socket.rarity.epic',
  [Rarity.Legendary]: 'economy.socket.rarity.legendary',
  [Rarity.Mythic]: 'economy.socket.rarity.mythic',
};
const COUNT_WORD: Partial<Record<number, MessageKey>> = { 2: 'economy.socket.count.2', 3: 'economy.socket.count.3' };

/** "Rare", "Epic and Legendary", "Rare, Epic and Legendary". */
function rarityList(rarities: Exclude<Rarity, Rarity.Common>[]): string {
  const names = rarities.map((r) => t(RARITY_WORD[r]));
  return names.length <= 1
    ? names.join('')
    : t('economy.list.and', { list: names.slice(0, -1).join(', '), last: names[names.length - 1] });
}

const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Which gear can take a gem, from the weights: "Common gear, the starter kit
 * included, has no sockets. Rare gear can have one; Epic and Legendary up to two."
 */
export function socketRuleText(): string {
  const byMost = new Map<number, Exclude<Rarity, Rarity.Common>[]>();
  for (const rarity of [Rarity.Rare, Rarity.Epic, Rarity.Legendary, Rarity.Mythic] as const) {
    const most = maxSocketsFor(rarity);
    if (most > 0) byMost.set(most, [...(byMost.get(most) ?? []), rarity]);
  }
  const clauses = [...byMost.entries()].map(([most, rarities], i) => {
    const names = rarityList(rarities);
    const word = COUNT_WORD[most];
    const amount = word ? t(word) : formatNumber(most);
    if (i === 0) {
      return upperFirst(most === 1
        ? t('economy.socket.rule.firstOne', { names })
        : t('economy.socket.rule.firstUpTo', { names, amount }));
    }
    return most === 1 ? t('economy.socket.rule.nextOne', { names }) : t('economy.socket.rule.nextUpTo', { names, amount });
  });
  const common = maxSocketsFor(Rarity.Common) === 0 ? t('economy.socket.rule.common') : '';
  return `${common} ${clauses.join('; ')}.`.trim();
}

/**
 * A gem in a reward, in its two parts: what it gives, and that it gives it once
 * set. Where gems are set and which gear has sockets is the Handbook's gems
 * page, linked beside it, rather than a paragraph under every drop (PT-13).
 */
export function gemRewardLine(gem: GemId): { bonus: string; note: string } {
  return { bonus: gemBonusText(gem), note: t('economy.gem.reward.note') };
}

/**
 * The bag's one state line on gems: whether anything carried, worn or not,
 * could take one. The rules are the Handbook's gems page, linked beside it.
 */
export function gemStateText(space: SocketSpace): string {
  if (space.socketed === 0) return t('economy.gem.state.none');
  if (space.open.length === 0) return t('economy.gem.state.filled');
  return t('economy.gem.state.open', { count: new Set(space.open.map((o) => o.item.id)).size });
}

/**
 * The Forge's merging bench, in one line: what it does, and where gems are set
 * instead (the bag). `spiritOpen` once the bench also offers Jadeveil's tier.
 */
export function mergeBenchText(spiritOpen = false): string {
  return t(spiritOpen ? 'economy.gem.mergeBenchSpirit' : 'economy.gem.mergeBench', { count: BALANCE.GEM_CUT_INPUT });
}

/**
 * The piece as it would stand with `gem` set in `socket` — by default its first
 * empty one, which is the socket the bag's Set fills. Null when that
 * socket is not empty (or the piece has none), so a preview is never drawn for
 * a press that would be refused.
 */
export function withGemSet(item: Item, gem: GemId, socket?: number): Item | null {
  const sockets = item.sockets ?? [];
  const at = socket ?? sockets.indexOf(null);
  if (at < 0 || at >= sockets.length || sockets[at] !== null) return null;
  return { ...item, sockets: sockets.map((held, i) => (i === at ? gem : held)) };
}

/** What setting a gem changes on a piece: one stat, before and after. */
export interface GemSetPreview {
  stat: keyof ItemModifiers;
  /** The stat's name as the item card labels it ("Attack", "HP"). */
  label: string;
  before: number;
  after: number;
}

/**
 * The one stat a gem moves on this piece, read through `effectiveModifiers` —
 * the answer the sheet and combat use — so "Attack 12 → 15" is what the hero
 * will actually get. Null when that socket is not open.
 */
export function gemSetPreview(item: Item, gem: GemId, socket?: number): GemSetPreview | null {
  const after = withGemSet(item, gem, socket);
  if (!after) return null;
  const { stat } = gemBonus(gem);
  const label = modifierLines({ [stat]: 1 } as ItemModifiers)[0]?.label ?? stat;
  return {
    stat,
    label,
    before: effectiveModifiers(item)[stat] ?? 0,
    after: effectiveModifiers(after)[stat] ?? 0,
  };
}

/** The focused gem in a sentence: "Cut Ruby: +3 Attack in an empty socket." */
export function gemFocusText(gem: GemId): string {
  return t('economy.gem.focus', { gem: gemName(gem), bonus: gemBonusText(gem) });
}
