import { heroesOf, isAlive } from '@/systems/combat/targetLegality';
import { AuraType, ArenaHazard, BossScriptState, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { byHex, occupiedKeys, solidKeys } from '@/systems/combat/eliteKits';
import { dashRoutes } from '@/systems/combat/factionEliteKits';
import { hasEffect, isHiddenFrom, isSealed } from '@/systems/combat/statusEffects';
import { hexesBehind } from '@/systems/combat/facing';
import { arenaHexes, inArena } from '@/systems/combat/arenaGeometry';
import { getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * The Jorōgumo's web, as pure rules over a roster (the private project notes).
 * She was the Yokai's roaming elite and is the Silk Hollow's boss since the shrine campaign
 * (`data/templates/jorogumoWeaver`); the canopy half — her threads, her perch and the drop —
 * is at the end of this file, with the Nue that roams in her place.
 *
 * **The cycle.** Her turns run *web → bite-or-attack → attack*, round and round. On a web
 * turn she wraps heroes in webs: one on her first volley, two on her second, then three
 * and four, and from the fifth every hero she can — always leaving one hero free, so the
 * party is never without somebody to answer. On the turn after a volley, a hero any web
 * still holds is bitten: she dashes (or, hanging, drops) to one of them and lands Widow's Kiss, which is sized
 * to take most non-tanks from full health. If every web was cut she simply attacks.
 *
 * **The web** is an attackable objective with 1 health standing on the hero's hex, like
 * the Glacial Tomb: a hero's blow or any area blow that catches the hex tears it away
 * and frees them. While it stands the hero is held out of the fight (`AuraType.Webbed`):
 * no turn, no harm, statuses held.
 *
 * **The window.** The bite is announced through the shared warning the moment the
 * volley lands, over every webbed hero's hex, and every free hero owes it a turn: it
 * lands on her next turn only once each of them has had theirs, so no web is ever cast
 * and bitten in the same round. A Stun or a Freeze on her breaks it. A web left after a
 * bite still holds its hero, and her next volley warns of it again.
 *
 * `yokaiActions` puts this on the board and `scripts/yokai` turns the cycle. Nothing here
 * imports the store.
 */

export const JOROGUMO_TEMPLATE = 'jorogumo';
export const WEB_KIND = 'jorogumoWeb';

/** Where her turns stand in the cycle. */
export type JorogumoSlot = 'web' | 'bite' | 'attack';
const SLOTS: JorogumoSlot[] = ['web', 'bite', 'attack'];

export const isJorogumo = (unit: CombatUnit): boolean => unit.templateId === JOROGUMO_TEMPLATE && !unit.objective;

/** Whether a web holds this hero. */
export const isWebbed = (unit: CombatUnit): boolean => hasEffect(unit, AuraType.Webbed);

export const isWeb = (unit: CombatUnit): boolean => unit.objective?.kind === WEB_KIND;

/** The webs she has standing. */
export const websOf = (spider: CombatUnit, units: CombatUnit[]): CombatUnit[] =>
  units.filter((u) => isAlive(u) && isWeb(u) && u.objective?.ownerId === spider.id);

/** The hero a web holds. */
export const webHero = (web: CombatUnit, units: CombatUnit[]): CombatUnit | undefined =>
  web.objective?.linkedUnitId ? units.find((u) => u.id === web.objective!.linkedUnitId) : undefined;

/** Heroes free to act and to be webbed: alive, and held by nothing. */
export const freeHeroes = (units: CombatUnit[]): CombatUnit[] => heroesOf(units).filter((h) => !isSealed(h));

// ── the cycle ────────────────────────────────────────────────────────────────

/** What her script remembers: how many volleys she has cast, and on which of her turns the last. */
export interface JorogumoMemory {
  /** Her regular turns begun. */
  turns: number;
  /** This turn's place in the cycle. */
  slot: JorogumoSlot;
  volleys: number;
  /** The turn (`turns`) the last volley was cast on, or -1. */
  lastVolley: number;
}

export function jorogumoMemory(spider: CombatUnit): JorogumoMemory {
  const s = spider.bossScript as BossScriptState | undefined;
  return {
    turns: s?.phaseTurns ?? 0,
    slot: SLOTS[s?.step ?? 0] ?? 'web',
    volleys: s?.lastUsed?.volleys ?? 0,
    lastVolley: s?.lastUsed?.lastVolley ?? -1,
  };
}

/**
 * The slot her next regular turn takes, from the one before it. A web turn whose volley
 * could not be cast (nobody in reach, a warning still standing) does not use the slot
 * up: she tries again on the next turn.
 */
export function nextSlot(memory: JorogumoMemory): JorogumoSlot {
  if (memory.turns === 0) return 'web';
  switch (memory.slot) {
    case 'web':
      return memory.lastVolley === memory.turns ? 'bite' : 'web';
    case 'bite':
      return 'attack';
    case 'attack':
      return 'web';
  }
}

export const slotIndex = (slot: JorogumoSlot): number => SLOTS.indexOf(slot);

/**
 * How many new webs a volley spins: the volley's number for the first four (one, two,
 * three, four), every hero she can after that — and never so many that no free hero is
 * left to answer the bite.
 */
export function volleySize(volley: number, free: number): number {
  const wanted = volley <= BALANCE.JOROGUMO_ESCALATING_VOLLEYS ? volley : Infinity;
  return Math.max(0, Math.min(wanted, free - 1));
}

/**
 * Who a volley webs: free heroes within her reach, the hardest hitters first (then the
 * sturdiest, then by id, so the choice replays).
 */
export function webTargets(spider: CombatUnit, units: CombatUnit[], volley: number): CombatUnit[] {
  const free = freeHeroes(units);
  const count = volleySize(volley, free.length);
  if (count === 0) return [];
  return free
    .filter((h) => hexDistance(spider.position, h.position) <= webReach(spider))
    .sort(
      (a, b) =>
        Math.max(b.stats.attack, b.stats.magic) - Math.max(a.stats.attack, a.stats.magic) ||
        b.stats.maxHp - a.stats.maxHp ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, count);
}

/**
 * Whether a volley is worth her web turn: it webs somebody new, or there are webs still
 * standing from before whose bite it can announce again.
 */
export const canVolley = (spider: CombatUnit, units: CombatUnit[]): boolean =>
  webTargets(spider, units, jorogumoMemory(spider).volleys + 1).length > 0 || websOf(spider, units).length > 0;

// ── the bite ─────────────────────────────────────────────────────────────────

/**
 * Who the bite takes among the heroes the warning's webs still hold: the one it is most
 * likely to kill (least health left), then the nearest, then by id.
 */
export function biteVictim(spider: CombatUnit, webIds: readonly string[], units: CombatUnit[]): CombatUnit | null {
  const held = units
    .filter((w) => webIds.includes(w.id) && isAlive(w) && isWeb(w))
    .map((w) => webHero(w, units))
    .filter((h): h is CombatUnit => !!h && isAlive(h) && isWebbed(h));
  return (
    held.sort(
      (a, b) =>
        a.currentHp - b.currentHp ||
        hexDistance(spider.position, a.position) - hexDistance(spider.position, b.position) ||
        (a.id < b.id ? -1 : 1),
    )[0] ?? null
  );
}

/**
 * Where she lands to bite: the free hex beside the victim she can reach soonest, its
 * route included. `null` when she is already beside them or no hex beside them is open,
 * and she bites from where she stands, along the silk.
 */
export function biteDash(
  spider: CombatUnit,
  victim: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): { to: HexCoord; path: HexCoord[] } | null {
  if (hexDistance(spider.position, victim.position) <= 1) return null;
  const blocked = new Set([...occupiedKeys(units, spider.id), ...solidKeys(hazards)]);
  const routes = dashRoutes(spider.position, 99, blocked);
  let best: { to: HexCoord; path: HexCoord[] } | null = null;
  for (const hex of getNeighbors(victim.position).sort(byHex)) {
    const path = routes.get(hexKey(hex));
    if (path && (!best || path.length < best.path.length)) best = { to: hex, path };
  }
  return best;
}

// ── Jadeveil: Silk Hollow / Yokai — the Nue ──────────────────────────────────

/**
 * The Nue, the Yokai's roaming elite since the shrine campaign: a chimera in a black
 * thundercloud. Its rules are read at its own turn start (`yokaiActions.beginNueTurn`):
 *
 * - **Thundercloud.** Every hero beside it is Shocked.
 * - **Serpent Tail.** The hero standing in the hex directly behind it — opposite the way
 *   it faces — is struck by the snake. Its two rear-side hexes are safe: the snake strikes
 *   straight back, which is what a player can read off the model.
 *
 * Black Thunder, its cooldown, strikes everyone beside it and then the cloud closes over
 * it (`cloakNue`): Stealth until its next turn.
 */
export const NUE_TEMPLATE = 'nue';

export const isNue = (unit: CombatUnit): boolean => unit.templateId === NUE_TEMPLATE && !unit.objective;

/** The heroes its cloud Shocks: free heroes beside it. */
export const heroesBeside = (nue: CombatUnit, units: CombatUnit[]): CombatUnit[] =>
  freeHeroes(units)
    .filter((h) => hexDistance(nue.position, h.position) === 1)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

/** The hero its tail strikes: the free hero on the hex directly behind it, if any. */
export function tailVictim(nue: CombatUnit, units: CombatUnit[]): CombatUnit | null {
  const back = hexesBehind(nue)[0];
  if (!back) return null;
  return freeHeroes(units).find((h) => hexKey(h.position) === hexKey(back)) ?? null;
}

// ── Jadeveil: Silk Hollow / Yokai — the canopy weaver ────────────────────────

/**
 * The Jorōgumo as the Silk Hollow's boss. While any of her three threads stands she hangs
 * above the arena (`AuraType.Suspended`) over her perch on the back row: she takes her
 * turns, but nothing can aim at her, harm her or afflict her. From up there her web
 * reaches every hero, and a bite drops her beside the webbed hero she bites; she climbs
 * back to her perch before the next turn begins (`yokaiActions.climbBack`). The last
 * thread cut drags her down into her second phase, on the board (`onLast: 'release'`).
 */
export const THREAD_KIND = 'jorogumoThread';

export const isThread = (unit: CombatUnit): boolean => unit.objective?.kind === THREAD_KIND;

/** The threads she still hangs from. */
export const threadsOf = (spider: CombatUnit, units: readonly CombatUnit[]): CombatUnit[] =>
  units.filter((u) => isAlive(u) && isThread(u) && u.objective?.ownerId === spider.id);

/** Whether she is up on her threads. */
export const isHanging = (unit: CombatUnit): boolean => hasEffect(unit, AuraType.Suspended);

/** The hex she hangs over: the back row, at the middle. */
export const weaverPerch = (): HexCoord => ({
  q: BALANCE.JOROGUMO_WEAVER.PERCH_Q,
  r: BALANCE.JOROGUMO_WEAVER.PERCH_R,
});

/**
 * Three distinct free hexes for her threads, on the ring around her perch: as far from
 * one another as the board allows, then by coordinate, so they spread across the arena
 * and each is a walk of its own.
 */
export function threadSpots(perch: HexCoord, taken: readonly HexCoord[] = []): HexCoord[] {
  const blocked = new Set(taken.map(hexKey));
  blocked.add(hexKey(perch));
  const ring = arenaHexes()
    .filter((h) => hexDistance(perch, h) === BALANCE.JOROGUMO_WEAVER.THREAD_RING && !blocked.has(hexKey(h)))
    .map((h) => ({ q: h.q, r: h.r }))
    .sort((a, b) => a.q - b.q || a.r - b.r);
  const picked: HexCoord[] = [];
  while (picked.length < 3 && picked.length < ring.length) {
    let best: HexCoord | null = null;
    let bestGap = -1;
    for (const hex of ring) {
      if (picked.some((p) => hexKey(p) === hexKey(hex))) continue;
      const gap = picked.length === 0 ? 0 : Math.min(...picked.map((p) => hexDistance(p, hex)));
      if (gap > bestGap) {
        best = hex;
        bestGap = gap;
      }
    }
    if (!best) break;
    picked.push(best);
  }
  return picked;
}

/**
 * Whom Canopy Venom seeks while any of her threads stands: the hero standing farthest from every
 * standing Silk Thread (the shortest walk to any of them), then the one with less health left,
 * then the lower id, among the heroes it can reach. Standing by the threads is the safe place
 * (boss feel pass, the private project notes). Null with no thread standing, when she aims
 * as any attack does, or with nobody it can reach.
 */
export function venomTarget(spider: CombatUnit, units: CombatUnit[], skill: HeroSkill): CombatUnit | null {
  const threads = threadsOf(spider, units);
  if (threads.length === 0) return null;
  const gap = (hero: CombatUnit) => Math.min(...threads.map((t) => hexDistance(t.position, hero.position)));
  return (
    freeHeroes(units)
      .filter((h) => !isHiddenFrom(h, skill) && hexDistance(spider.position, h.position) <= skill.range)
      .sort((a, b) => gap(b) - gap(a) || a.currentHp - b.currentHp || (a.id < b.id ? -1 : 1))[0] ?? null
  );
}

/** How far her web reaches: anywhere from the canopy, `JOROGUMO_WEB_RANGE` on the ground. */
export const webReach = (spider: CombatUnit): number =>
  isHanging(spider) ? Infinity : BALANCE.JOROGUMO_WEB_RANGE;

/**
 * Where she drops to bite from the canopy: the free hex beside the victim nearest her
 * perch (then by coordinate). She comes down from above, so nothing between is in her way.
 */
export function dropHex(
  spider: CombatUnit,
  victim: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): HexCoord | null {
  const blocked = new Set([...occupiedKeys(units, spider.id), ...solidKeys(hazards)]);
  return (
    getNeighbors(victim.position)
      .filter((h) => inArena(h) && !blocked.has(hexKey(h)))
      .sort((a, b) => hexDistance(weaverPerch(), a) - hexDistance(weaverPerch(), b) || byHex(a, b))[0] ?? null
  );
}
