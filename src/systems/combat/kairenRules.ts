import {
  AfflictionType,
  ArenaHazard,
  AuraType,
  CombatUnit,
  HexCoord,
  KairenMemory,
  KairenScriptState,
  PreparedAttack,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { arenaHexes, inArena } from '@/systems/combat/arenaGeometry';
import { heroesOf } from '@/systems/combat/targetLegality';
import { ForcedMove, traceForcedMove } from '@/systems/combat/forcedMovement';
import { getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';

/**
 * Jadeveil: Kairen, the Cloud-Crowned Dragon — the rules of his fight, as pure
 * functions over a roster (the private project notes).
 *
 * Every footprint he warns is built here, and the landing reads the same functions,
 * so what the board shows is what lands: the dive's line and where he comes down,
 * the wind's direction and each body's landing, the downwind rows, the storm's marks,
 * the orb's ring and where its shards fall. `kairenActions` puts them on the board;
 * `scripts/kairen` decides and lands. Nothing here imports the store, so the HUD, the
 * Node suites and the harness ask the same questions the fight does.
 */

export const KAIREN_TEMPLATE_ID = 'kairen';
export const SHARD_KIND = 'jade_shard';
export const BROOD_TEMPLATE_ID = 'brood_wyrmling';

const K = BALANCE.KAIREN;
const keyOf = hexKey;

export const isKairen = (unit: CombatUnit): boolean => !unit.isPlayer && unit.templateId === KAIREN_TEMPLATE_ID;

export const kairenOf = (units: readonly CombatUnit[]): CombatUnit | undefined =>
  units.find((u) => u.currentHp > 0 && isKairen(u));

/** The Storm Seal tier he is fought at: 1, the story fight, unless the encounter said more. */
export const tierOf = (boss: CombatUnit | undefined): number =>
  Math.min(K.MAX_TIER, Math.max(1, Math.round(boss?.challengeTier ?? 1)));

export const initialKairenMemory = (): KairenMemory => ({
  turns: 0,
  lastUsed: {},
  boardPhase: -1,
  brood: [],
  broodTurn: -99,
  gales: 0,
  taintSeen: {},
});

export const initialKairenScript = (): KairenScriptState => ({ step: 0, phaseTurns: 0, unharmedRounds: 0, kairen: initialKairenMemory() });

export const kairenMemory = (unit: CombatUnit): KairenMemory =>
  unit.bossScript && 'kairen' in unit.bossScript ? unit.bossScript.kairen : initialKairenMemory();

// ── Jade Taint ───────────────────────────────────────────────────────────────

/** A unit's Jade Taint, in stacks (0–3). */
export const taintOf = (unit: CombatUnit): number =>
  Math.max(0, Math.min(K.TAINT_CAP, Math.round(unit.activeEffects.find((e) => e.type === AfflictionType.JadeTaint)?.magnitude ?? 0)));

/** Verdant Judgement's multiplier of his Magic on a hero carrying `stacks` Taint. */
export const verdantMultiplier = (stacks: number): number =>
  K.VERDANT_BASE + K.VERDANT_PER_STACK * Math.max(0, Math.min(K.TAINT_CAP, stacks));

// ── The board ────────────────────────────────────────────────────────────────

/** Solid ground on the board: nothing of his lies there, but a hazard that does stays out of his footprints. */
const solidKeys = (hazards: readonly ArenaHazard[]): Set<string> => {
  const keys = new Set<string>();
  for (const z of hazards) if (z.solid) for (const x of z.hexes) keys.add(keyOf(x));
  return keys;
};

// ── Gale and Downdraft ───────────────────────────────────────────────────────

/** The wind of his `n`th Gale (from 0): east, then west, and so on. */
export const windFor = (n: number): HexCoord => (n % 2 === 0 ? { q: 1, r: 0 } : { q: -1, r: 0 });

/** Which way the wind blows, in the words a line puts after a verb ("turns east" / "skręca na wschód"). */
export const windName = (wind: HexCoord): string => t(wind.q > 0 ? 'bossLog.kairen.wind.east' : 'bossLog.kairen.wind.west');

/** How far the Gale pushes at a tier: two hexes from tier 3. */
export const galeDistance = (tier: number): number => (tier >= 3 ? K.GALE_PUSH_TIER3 : K.GALE_PUSH);

/**
 * The Downdraft's rows: every hex off solid ground whose next `DOWNDRAFT_ROWS` steps
 * downwind leave the board — the last two hexes of every line the wind blows along.
 */
export function downdraftHexes(wind: HexCoord, hazards: readonly ArenaHazard[]): HexCoord[] {
  const solid = solidKeys(hazards);
  return arenaHexes()
    .filter((x) => !solid.has(keyOf(x)))
    .filter((x) => {
      for (let i = 1; i <= K.DOWNDRAFT_ROWS; i++) {
        if (!inArena({ q: x.q + wind.q * i, r: x.r + wind.r * i })) return true;
      }
      return false;
    })
    .map((x) => ({ q: x.q, r: x.r }));
}

/** Who the wind moves: every living body but him and what cannot be moved (objectives). */
export function windBodies(casterId: string, units: readonly CombatUnit[]): CombatUnit[] {
  return units.filter((u) => u.currentHp > 0 && u.id !== casterId && !u.objective);
}

/**
 * Where the wind puts every body, in the order it resolves: furthest downwind first
 * (so the front of a line clears the way), ties by hex. Each is traced by the shared
 * `traceForcedMove` from one step upwind of it, so it moves exactly along the wind and
 * the cliff edge, another body or an objective stops it. The preview arrows and the
 * landing are both this.
 */
export function windMoves(
  wind: HexCoord,
  distance: number,
  casterId: string,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
): ForcedMove[] {
  const along = (x: HexCoord) => x.q * wind.q + x.r * wind.r + (x.q * wind.r + x.r * wind.q) / 2;
  const bodies = windBodies(casterId, units).sort(
    (a, b) => along(b.position) - along(a.position) || a.position.q - b.position.q || a.position.r - b.position.r,
  );
  let occupancy = [...units];
  const moves: ForcedMove[] = [];
  for (const body of bodies) {
    const origin = { q: body.position.q - wind.q, r: body.position.r - wind.r };
    const move = traceForcedMove(origin, body, distance, occupancy, [...hazards]);
    moves.push(move);
    if (move.moved) occupancy = occupancy.map((u) => (u.id === body.id ? { ...u, position: move.to } : u));
  }
  return moves;
}

/** Heroes the Downdraft would strike if the Gale landed now: the ones the wind leaves on its rows. */
export function downdraftVictims(attack: PreparedAttack, units: readonly CombatUnit[], hazards: readonly ArenaHazard[]): string[] {
  if (!attack.wind) return [];
  const rows = new Set((attack.landing ?? []).map(keyOf));
  const moves = windMoves(attack.wind, attack.windDistance ?? K.GALE_PUSH, attack.casterId, units, hazards);
  return heroesOf(units)
    .filter((hero) => {
      const at = moves.find((m) => m.unitId === hero.id)?.to ?? hero.position;
      return rows.has(keyOf(at));
    })
    .map((u) => u.id);
}

/**
 * The heroes a body keeps off the Downdraft: alone on the board the wind would carry each onto its
 * rows, and a body that holds where it stands — Kairen, a Jade Shard, or a line packed against the
 * cliff edge — stops them short of it. The Gale's shelter, named on the banner and drawn on the
 * board (`PreparedPreview.windSheltered`); read from the same `windMoves` the landing runs, so the
 * heroes named are exactly the ones the landing leaves off the rows that would have been on them.
 * No rule of its own: the wind always stopped at a body.
 */
export function galeSheltered(
  attack: PreparedAttack,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
  moves: readonly ForcedMove[] = attack.wind
    ? windMoves(attack.wind, attack.windDistance ?? K.GALE_PUSH, attack.casterId, units, hazards)
    : [],
): string[] {
  const wind = attack.wind;
  if (!wind) return [];
  const rows = new Set((attack.landing ?? []).map(keyOf));
  const distance = attack.windDistance ?? K.GALE_PUSH;
  return heroesOf(units)
    .filter((hero) => {
      if (rows.has(keyOf(moves.find((m) => m.unitId === hero.id)?.to ?? hero.position))) return false;
      const alone = windMoves(wind, distance, attack.casterId, [hero], hazards)[0];
      return !!alone && rows.has(keyOf(alone.to));
    })
    .map((u) => u.id);
}

// ── Cloud Dive ───────────────────────────────────────────────────────────────

/** The three axes a full line runs along. */
const AXES: readonly HexCoord[] = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: -1 }];

/** Every full line across the board, each from one edge to the other, in axis order. */
export function fullLines(): HexCoord[][] {
  const lines: HexCoord[][] = [];
  for (const axis of AXES) {
    const seen = new Set<string>();
    for (const start of arenaHexes()) {
      // Walk back to the edge, then out to the other
      let at = start;
      while (inArena({ q: at.q - axis.q, r: at.r - axis.r })) at = { q: at.q - axis.q, r: at.r - axis.r };
      if (seen.has(keyOf(at))) continue;
      seen.add(keyOf(at));
      const line: HexCoord[] = [];
      for (let x = at; inArena(x); x = { q: x.q + axis.q, r: x.r + axis.r }) line.push({ q: x.q, r: x.r });
      lines.push(line);
    }
  }
  return lines;
}

export interface DivePlan {
  /** The warned hexes, solid ground and his own hex left out, in order from the near end to the far. */
  hexes: HexCoord[];
  /** The far end he means to land on. */
  end: HexCoord;
  caught: number;
}

/**
 * The dive's line: the full line across the board that crosses the most heroes (then
 * the longest, then the first by axis and position), ordered so its far end is the end
 * away from him. Solid hexes and his own hex are left out of the warning — nobody stands
 * on either — and the far end is the last open hex of the line.
 */
export function divePlan(boss: CombatUnit, units: readonly CombatUnit[], hazards: readonly ArenaHazard[]): DivePlan | null {
  const solid = solidKeys(hazards);
  const heroes = heroesOf(units);
  let best: DivePlan | null = null;
  for (const raw of fullLines()) {
    const open = raw.filter((x) => !solid.has(keyOf(x)) && keyOf(x) !== keyOf(boss.position));
    if (open.length < 2) continue;
    const ordered = hexDistance(boss.position, open[0]) <= hexDistance(boss.position, open[open.length - 1])
      ? open
      : [...open].reverse();
    const keys = new Set(ordered.map(keyOf));
    const caught = heroes.filter((u) => keys.has(keyOf(u.position))).length;
    if (caught === 0) continue;
    if (!best || caught > best.caught || (caught === best.caught && ordered.length > best.hexes.length)) {
      best = { hexes: ordered, end: ordered[ordered.length - 1], caught };
    }
  }
  return best;
}

/**
 * Where he comes down: the far end of the line, or — if a body stands there now — the
 * nearest free hex back along the line toward him. His own hex if the line is full.
 */
export function diveLanding(attack: PreparedAttack, boss: CombatUnit, units: readonly CombatUnit[]): HexCoord {
  const taken = new Set(units.filter((u) => u.currentHp > 0 && u.id !== boss.id).map((u) => keyOf(u.position)));
  for (let i = attack.hexes.length - 1; i >= 0; i--) {
    const x = attack.hexes[i];
    if (!taken.has(keyOf(x))) return { q: x.q, r: x.r };
  }
  return boss.position;
}

// ── Thunderhead ──────────────────────────────────────────────────────────────

/**
 * The storm's marks for a round: `count` hexes, never on solid ground, his own hex, another
 * mark, or a body that is not a hero. The first lies beside him on the free hex nearest
 * the party, so a hero can draw a bolt there and leave him Exposed; the rest go one step
 * from each hero in turn, the most tainted first, nearest that hero (then by coordinate),
 * then one step further out. `avoid` keeps a second set apart from the first.
 */
export function stormMarks(
  boss: CombatUnit,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
  count: number,
  avoid: readonly HexCoord[] = [],
): HexCoord[] {
  const solid = solidKeys(hazards);
  const heroes = heroesOf(units).sort((a, b) => taintOf(b) - taintOf(a) || (a.id < b.id ? -1 : 1));
  const bodies = new Set(units.filter((u) => u.currentHp > 0 && !(u.isPlayer && !u.objective && !u.summonedBy)).map((u) => keyOf(u.position)));
  const blocked = new Set([...solid, ...bodies, ...avoid.map(keyOf), keyOf(boss.position)]);
  const marks: HexCoord[] = [];
  const take = (x: HexCoord) => {
    marks.push({ q: x.q, r: x.r });
    blocked.add(keyOf(x));
  };
  const ok = (x: HexCoord) => inArena(x) && !blocked.has(keyOf(x));
  const centre = heroes.length
    ? { q: heroes.reduce((n, u) => n + u.position.q, 0) / heroes.length, r: heroes.reduce((n, u) => n + u.position.r, 0) / heroes.length }
    : boss.position;
  const towardParty = (a: HexCoord, b: HexCoord) =>
    Math.hypot(a.q - centre.q, a.r - centre.r) - Math.hypot(b.q - centre.q, b.r - centre.r) || a.q - b.q || a.r - b.r;
  const rod = getNeighbors(boss.position).filter(ok).sort(towardParty)[0];
  if (rod && marks.length < count) take(rod);
  for (const ring of [1, 2]) {
    for (const hero of heroes) {
      if (marks.length >= count) break;
      const pick = arenaHexes()
        .filter((x) => hexDistance(hero.position, x) === ring && ok(x))
        .sort((a, b) => a.q - b.q || a.r - b.r)[0];
      if (pick) take(pick);
    }
  }
  return marks;
}

// ── Orb Nova and the Jade Shards ─────────────────────────────────────────────

/** The orb's ring: every hex two to three from him, off solid ground. */
export function novaRing(boss: CombatUnit, hazards: readonly ArenaHazard[]): HexCoord[] {
  const solid = solidKeys(hazards);
  return arenaHexes()
    .filter((x) => {
      const d = hexDistance(boss.position, x);
      return d >= K.NOVA_INNER && d <= K.NOVA_OUTER && !solid.has(keyOf(x));
    })
    .map((x) => ({ q: x.q, r: x.r }));
}

/**
 * Where the shards fall when a Nova lands: free hexes of its ring, each nearest the most
 * tainted hero not yet given one (then by coordinate) and at least three hexes from the
 * other, so a shard is always within a hero's reach and two are never one answer.
 */
export function shardSpots(
  attack: PreparedAttack,
  units: readonly CombatUnit[],
  count: number,
): HexCoord[] {
  const taken = new Set(units.filter((u) => u.currentHp > 0).map((u) => keyOf(u.position)));
  const heroes = heroesOf(units).sort((a, b) => taintOf(b) - taintOf(a) || (a.id < b.id ? -1 : 1));
  const spots: HexCoord[] = [];
  const free = attack.hexes.filter((x) => !taken.has(keyOf(x)));
  for (let i = 0; spots.length < count && i < Math.max(heroes.length, count); i++) {
    const hero = heroes[i % Math.max(1, heroes.length)];
    const pick = free
      .filter((x) => !spots.some((s) => keyOf(s) === keyOf(x) || hexDistance(s, x) < 3))
      .sort((a, b) =>
        (hero ? hexDistance(hero.position, a) - hexDistance(hero.position, b) : 0) || a.q - b.q || a.r - b.r)[0];
    if (!pick) break;
    spots.push({ q: pick.q, r: pick.r });
  }
  return spots;
}

/** The heroes a broken shard cleanses: every hero standing beside it. */
export function shardCleanses(shard: HexCoord, units: readonly CombatUnit[]): CombatUnit[] {
  return heroesOf(units).filter((u) => hexDistance(u.position, shard) === 1);
}

export const shardsOf = (boss: CombatUnit, units: readonly CombatUnit[]): CombatUnit[] =>
  units.filter((u) => u.currentHp > 0 && u.objective?.ownerId === boss.id && u.objective.kind === SHARD_KIND);

// ── Orb Bolt ─────────────────────────────────────────────────────────────────

/** Who the bolt seeks: among heroes in reach, the one carrying the least Taint, then the nearest, then by id. */
export function orbBoltTarget(boss: CombatUnit, candidates: readonly CombatUnit[], range: number): CombatUnit | undefined {
  return orbBoltTargets(boss, candidates, range, 1)[0];
}

/** The first `count` heroes the bolt seeks, in `orbBoltTarget`'s order. */
export function orbBoltTargets(boss: CombatUnit, candidates: readonly CombatUnit[], range: number, count: number): CombatUnit[] {
  return [...candidates]
    .filter((u) => u.currentHp > 0 && hexDistance(boss.position, u.position) <= range)
    .sort((a, b) =>
      taintOf(a) - taintOf(b) ||
      hexDistance(boss.position, a.position) - hexDistance(boss.position, b.position) ||
      (a.id < b.id ? -1 : 1))
    .slice(0, Math.max(0, count));
}

/** How many heroes one Orb Bolt strikes at a tier: two from tier 2, one in the story fight. */
export const orbBoltCount = (tier: number): number => (tier >= 2 ? K.ORB_BOLT_TARGETS_TIER2 : 1);

// ── The brood ────────────────────────────────────────────────────────────────

/** How many wyrmlings a Brood releases at a tier: six, and one more per tier above the first. */
export const broodCount = (tier: number): number => K.BROOD_COUNT + (Math.max(1, tier) - 1);

/** His last brood's wyrmlings still alive. */
export function broodAlive(memory: KairenMemory, units: readonly CombatUnit[]): CombatUnit[] {
  const ids = new Set(memory.brood);
  return units.filter((u) => u.currentHp > 0 && ids.has(u.id));
}

/**
 * Whether he may call a brood now: never while any wyrmling of the last one lives,
 * and not sooner than `BROOD_GAP` of his turns after it.
 */
export function canBrood(memory: KairenMemory, units: readonly CombatUnit[]): boolean {
  return broodAlive(memory, units).length === 0 && memory.turns - memory.broodTurn >= K.BROOD_GAP;
}

/**
 * Free hexes for a brood, spread round the arena: off solid ground, never beside a hero (a
 * wyrmling arrives, it does not arrive biting), kept three apart where the board allows
 * and then closer, taken round the arena's rim before its middle — so the brood drops
 * all over the summit rather than in one clump.
 */
export function broodSpots(boss: CombatUnit, units: readonly CombatUnit[], hazards: readonly ArenaHazard[], count: number): HexCoord[] {
  const solid = solidKeys(hazards);
  const taken = new Set(units.filter((u) => u.currentHp > 0).map((u) => keyOf(u.position)));
  const centre = { q: 0, r: 0 };
  const angle = (x: HexCoord) => Math.atan2(x.r * 1.5, Math.sqrt(3) * (x.q + x.r / 2));
  const free = arenaHexes()
    .filter((x) => !solid.has(keyOf(x)) && !taken.has(keyOf(x)) && keyOf(x) !== keyOf(boss.position))
    .filter((x) => !heroesOf(units).some((hero) => hexDistance(hero.position, x) <= 1))
    .sort((a, b) => hexDistance(centre, b) - hexDistance(centre, a) || angle(a) - angle(b) || a.q - b.q || a.r - b.r);
  const spots: HexCoord[] = [];
  for (const spread of [3, 2, 1]) {
    for (const x of free) {
      if (spots.length >= count) break;
      if (spots.some((s) => keyOf(s) === keyOf(x) || hexDistance(s, x) < spread)) continue;
      spots.push({ q: x.q, r: x.r });
    }
  }
  return spots;
}

// ── Choosing ─────────────────────────────────────────────────────────────────

export type KairenMove = 'gale' | 'dive' | 'verdant' | 'nova' | 'brood' | 'attack';
/** The warned moves he raises one at a time. The storm's marks ride beside them. */
export const MAJOR_WARNINGS: ReadonlySet<NonNullable<PreparedAttack['scripted']>> = new Set([
  'kairen_dive', 'kairen_gale', 'kairen_nova', 'kairen_verdant',
]);

export interface KairenMoveContext {
  phase: number;
  tier: number;
  /** Turns he has begun in this phase, this one included. */
  phaseTurns: number;
  memory: KairenMemory;
  /** One of his warned moves is already open. */
  majorOpen: boolean;
  /** He may call a brood now (`canBrood`). */
  broodReady: boolean;
}

const gapOk = (memory: KairenMemory, move: string, gap: number): boolean =>
  memory.lastUsed[move] === undefined || memory.turns - memory.lastUsed[move] >= gap;

/**
 * His next move, by rule rather than a rotation: each warned move is on offer from its
 * first turn of the phase and its gap after the last, the phase's own first, and never
 * while another of his is open — two warnings never combine into a pattern with no
 * answer. Then a brood, if the last is dead and its gap has run; else the attack the
 * board gives him (the lash beside him, or the orb's bolt).
 */
export function chooseKairenMove(ctx: KairenMoveContext): KairenMove {
  const { phase, tier, phaseTurns: n, memory, majorOpen } = ctx;
  if (!majorOpen) {
    const offers: { move: KairenMove; first: number; gap: number }[] =
      phase === 0
        ? [
            { move: 'gale', first: K.GALE_FIRST, gap: K.GALE_GAP },
            { move: 'dive', first: K.DIVE_FIRST, gap: K.DIVE_GAP },
          ]
        : phase === 1
          ? [
              { move: 'verdant', first: K.VERDANT_FIRST, gap: K.VERDANT_GAP },
              { move: 'dive', first: K.DIVE_FIRST, gap: K.DIVE_GAP },
            ]
          : [
              { move: 'nova', first: K.NOVA_FIRST, gap: K.NOVA_GAP },
              { move: 'dive', first: K.DIVE_FIRST, gap: K.DIVE_GAP_TEMPEST },
              // Tier 5's twist: the Gale returns in the Jade Tempest
              ...(tier >= 5 ? [{ move: 'gale' as const, first: K.GALE_FIRST, gap: K.GALE_GAP }] : []),
            ];
    for (const offer of offers) {
      if (n >= offer.first && gapOk(memory, offer.move, offer.gap)) return offer.move;
    }
  }
  if (phase >= 1 && ctx.broodReady) return 'brood';
  return 'attack';
}

// ── What the party reads ─────────────────────────────────────────────────────

const WEATHER_KEYS = [
  'bossSkills.phase.kairen_gale.name',
  'bossSkills.phase.kairen_thunderhead.name',
  'bossSkills.phase.kairen_tempest.name',
] as const;

/** Whether his phase, by index, brings a weather of its own. */
export const hasWeather = (phase: number): boolean => WEATHER_KEYS[phase] !== undefined;

/** The weather his phase brings, by phase index: the phase's own name. Undefined past the last. */
export const weatherName = (phase: number): string | undefined => {
  const key = WEATHER_KEYS[phase];
  return key ? t(key) : undefined;
};

/*
 * The answers his banner names (`bossLog.kairen.answer.*`). Kept short: every Kairen
 * line has to fit the folded banner at a landscape phone (932×430) with its waiting
 * list, so a warning says what lands and the one thing to do about it, and the skill
 * card says the rest.
 */

/** What a Kairen warning adds to its banner line: what lands, on whom, and the answer. */
export function kairenTail(
  attack: PreparedAttack,
  units: readonly CombatUnit[],
  landings: readonly ForcedMove[] = [],
  /** The heroes a body keeps off the Downdraft (`PreparedPreview.windSheltered`). */
  sheltered: readonly string[] = [],
): string {
  switch (attack.scripted) {
    case 'kairen_dive':
      return t('bossLog.kairen.tail.dive', { answer: t('bossLog.kairen.answer.dive') });
    case 'kairen_gale': {
      const wind = attack.wind ?? windFor(0);
      const n = attack.windDistance ?? K.GALE_PUSH;
      // Who the wind leaves on the downwind rows: the preview's own landings, as the arrows draw them
      const rows = new Set((attack.landing ?? []).map(keyOf));
      const caught = heroesOf(units)
        .filter((hero) => rows.has(keyOf(landings.find((m) => m.unitId === hero.id)?.to ?? hero.position)))
        .map((u) => unitName(u));
      const params = { distance: n, direction: windName(wind), answer: t('bossLog.kairen.answer.gale') };
      // And who a body holds off the rows: the Gale's shelter, said where the party reads the wind
      const held = heroesOf(units).filter((hero) => sheltered.includes(hero.id)).map((u) => unitName(u));
      return (caught.length
        ? t('bossLog.kairen.tail.galeCaught', { ...params, names: caught.join(', ') })
        : t('bossLog.kairen.tail.gale', params))
        + (held.length ? t('bossLog.kairen.tail.galeSheltered', { names: held.join(', ') }) : '');
    }
    case 'kairen_storm':
      return t('bossLog.kairen.tail.storm', { answer: t('bossLog.kairen.answer.storm') });
    case 'kairen_verdant': {
      const lines = heroesOf(units).map((u) => `${unitName(u)} ${taintOf(u)}`);
      const boss = units.find((u) => u.id === attack.casterId);
      const answer = t((boss?.bossPhase ?? 0) >= 2 ? 'bossLog.kairen.answer.verdantShards' : 'bossLog.kairen.answer.verdantStorm');
      return t('bossLog.kairen.tail.verdant', { lines: lines.join(', '), answer });
    }
    case 'kairen_nova':
      return t('bossLog.kairen.tail.nova', { answer: t('bossLog.kairen.answer.nova') });
    default:
      return '';
  }
}

/** The weather his phase brings, for the arena's air (`atmosphere`): none when he is not on the board. */
export function kairenWeather(units: readonly CombatUnit[]): 'gale' | 'thunderhead' | 'jadeTempest' | null {
  const boss = kairenOf(units);
  if (!boss) return null;
  const phase = boss.bossPhase ?? 0;
  return phase === 0 ? 'gale' : phase === 1 ? 'thunderhead' : 'jadeTempest';
}

/** Whether he is up in the clouds. */
export const isAloft = (unit: CombatUnit): boolean => unit.activeEffects.some((e) => e.type === AuraType.Aloft);
