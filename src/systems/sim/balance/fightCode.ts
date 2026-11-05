import { HeroClass } from '@/models/types';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { SimHeroConfig } from '@/systems/sim/simHarness';
import { hollowPowerScale } from '@/systems/sim/dragonMeasure';
import { glacierPowerScale } from '@/systems/sim/heartMeasure';
import { warrenPowerScale } from '@/systems/sim/trollMeasure';
import { clampTier } from '@/systems/world/castle';
import { jorogumoPowerScale, lastLessonPowerScale } from '@/systems/sim/jadeveilLairMeasure';
import { kairenPowerScale } from '@/systems/sim/kairenMeasure';
import { DEFAULT_ENCOUNTERS, EncounterId } from './encounters';
import { FightRecord, heroConfigFromRecord, partyRecord, PartyRecord } from './record';
import { RolledHero } from './partyRoll';

/**
 * A fight as a line of text, to carry between the balance lab and the game's tuning harness.
 *
 * A lab fight is a boss, a party and a seed; the harness takes a boss, a party and a power scale. The
 * code is the party (the compact `PartyRecord` the lab stores) and the boss, so pasting it into the
 * harness's setup screen fields the same heroes in the same gear and builds against the same boss at the
 * same scale. What it cannot carry is the dice: the harness plays with the game's own randomness, and the
 * lab's replay is the seeded one.
 *
 * The castle chain has a code too: the party and the Seal tier. The harness plays it as a real castle run
 * (`simCastle.ts`), the four stages back to back with health and mana carried between them, each stage at
 * `castleStagePower` and `CASTLE_HP_SCALE`, which is what the lab's chain fields.
 *
 * Both sides fight at the run settings' defaults (medium difficulty): the lab never sets them, and the
 * harness resets them on entry (`simStore.enter`). The seed and the party policy travel along as a
 * reference, so a played fight can be matched to the lab's record.
 */

export const FIGHT_CODE_PREFIX = 'DTFIGHT1.';

export type CodedEncounter = Exclude<EncounterId, 'castle' | 'pvp'>;

/** The harness's boss template for each coded encounter, and the scale the lab fields it at. */
export const CODED_BOSSES: Record<CodedEncounter, { boss: string; power: (band?: number) => number }> = {
  troll: { boss: 'troll_chieftain', power: warrenPowerScale },
  dragon: { boss: 'dragon', power: hollowPowerScale },
  heart: { boss: 'heart_of_winter', power: glacierPowerScale },
  jorogumo: { boss: 'jorogumo', power: jorogumoPowerScale },
  last_lesson: { boss: 'last_lesson', power: lastLessonPowerScale },
  kairen: { boss: 'kairen', power: kairenPowerScale },
};

interface Payload {
  enc: EncounterId;
  /** The power scale at the time, so a code says what it was made at even if balance moves. Boss fights. */
  ps?: number;
  /** The Seal tier the chain is fought at. Castle only. */
  tier?: number;
  /** The lab's seed and whether its party dodged warnings: a reference, the harness cannot use either. */
  seed?: number;
  dg?: 0 | 1;
  party: PartyRecord;
}

export interface BossFightSetup {
  enc: CodedEncounter;
  boss: string;
  powerScale: number;
  heroes: RolledHero[];
  seed?: number;
}

export interface CastleFightSetup {
  enc: 'castle';
  tier: number;
  heroes: RolledHero[];
  seed?: number;
}

export type FightSetup = BossFightSetup | CastleFightSetup;

// ─── Base64 (URL-safe), by hand: neither Node's Buffer nor the browser's btoa is in both runtimes ───

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(text: string): string {
  // The payload is JSON of ids and numbers; anything outside ASCII is escaped so one char is one byte
  const bytes = text.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i);
    const b = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : NaN;
    const c = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : NaN;
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((Number.isNaN(b) ? 0 : b) >> 4)];
    if (!Number.isNaN(b)) out += ALPHABET[((b & 15) << 2) | ((Number.isNaN(c) ? 0 : c) >> 6)];
    if (!Number.isNaN(c)) out += ALPHABET[c & 63];
  }
  return out;
}

function fromBase64Url(text: string): string {
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const ch of text) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('not a fight code');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 255);
    }
  }
  return out;
}

// ─── Encode and decode ────────────────────────────────────────────────────────

const encode = (payload: Payload) => FIGHT_CODE_PREFIX + toBase64Url(JSON.stringify(payload));

/**
 * The code of a lab fight. A castle record does not say its tier and a Jadeveil boss's does not say its band (the
 * run's setup does), so the caller passes them; absent, the default spec's. Kairen's code, like the Heart's, replays tier 1.
 */
export function encodeFightCode(record: FightRecord, castleTier?: number, band?: number): string {
  const ref = { seed: record.seed, dg: record.dg };
  // The harness takes a boss or the castle; a PvP fight is replayed in the lab
  if (record.enc === 'pvp') throw new Error('a PvP fight has no harness code');
  if (record.enc === 'castle') {
    return encode({ enc: 'castle', tier: clampTier(castleTier ?? DEFAULT_ENCOUNTERS.castle.tier ?? 1), ...ref, party: record.party });
  }
  const entry = CODED_BOSSES[record.enc];
  return encode({ enc: record.enc, ps: Math.round(entry.power(band) * 10000) / 10000, ...ref, party: record.party });
}

/**
 * The code of a setup as the harness has it (a boss and its heroes). Null when the boss is not one the
 * lab fights, so the setup has no lab counterpart to name.
 */
export function encodeSetupCode(boss: string | null, heroes: readonly SimHeroConfig[], powerScale: number): string | null {
  const enc = (Object.keys(CODED_BOSSES) as CodedEncounter[]).find((e) => CODED_BOSSES[e].boss === boss);
  if (!enc || heroes.length === 0) return null;
  return encode({ enc, ps: Math.round(powerScale * 10000) / 10000, party: harnessParty(heroes) });
}

/** A harness party as the lab stores one. The item budget is the lab's statistics only, so it is zero. */
function harnessParty(heroes: readonly SimHeroConfig[]): PartyRecord {
  const rolled: RolledHero[] = heroes.map((h) => ({
    ...h,
    heroClass: heroTemplates.find((t) => t.id === h.templateId)!.heroClass as HeroClass,
    masteryPath: h.masteryPath ?? null,
    capstone: (h as Partial<RolledHero>).capstone ?? null,
  }));
  return partyRecord({ heroes: rolled, budget: { legendary: 0, epic: 0, rare: 0 }, levelSum: heroes.reduce((s, h) => s + h.level, 0) });
}

/** The harness's castle chain as a code: its party and its Seal tier. Null without heroes. */
export function encodeCastleSetupCode(tier: number, heroes: readonly SimHeroConfig[]): string | null {
  if (heroes.length === 0) return null;
  return encode({ enc: 'castle', tier: clampTier(tier), party: harnessParty(heroes) });
}

export type Decoded = { ok: true; setup: FightSetup } | { ok: false; error: string };

export function decodeFightCode(text: string): Decoded {
  const code = text.trim().replace(/\s+/g, '');
  if (!code.startsWith(FIGHT_CODE_PREFIX)) return { ok: false, error: `A fight code starts with ${FIGHT_CODE_PREFIX}` };
  try {
    const payload = JSON.parse(fromBase64Url(code.slice(FIGHT_CODE_PREFIX.length))) as Partial<Payload>;
    const seed = typeof payload.seed === 'number' ? { seed: payload.seed } : {};
    if (payload.enc === 'castle' && payload.party?.h?.length) {
      const tier = typeof payload.tier === 'number' ? clampTier(payload.tier) : DEFAULT_ENCOUNTERS.castle.tier ?? 1;
      return { ok: true, setup: { enc: 'castle', tier, heroes: payload.party.h.map(heroConfigFromRecord), ...seed } };
    }
    if (!payload.enc || !(payload.enc in CODED_BOSSES) || !payload.party?.h?.length) return { ok: false, error: 'The code holds no fight.' };
    const enc = payload.enc as CodedEncounter;
    return {
      ok: true,
      setup: {
        enc,
        boss: CODED_BOSSES[enc].boss,
        powerScale: typeof payload.ps === 'number' && payload.ps > 0 ? payload.ps : CODED_BOSSES[enc].power(),
        heroes: payload.party.h.map(heroConfigFromRecord),
        ...seed,
      },
    };
  } catch {
    return { ok: false, error: 'The code is damaged or cut short.' };
  }
}
