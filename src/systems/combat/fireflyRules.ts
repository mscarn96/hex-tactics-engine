import { ActiveEffect, ArenaHazard, AuraType, CombatUnit, HeroSkill, HexCoord, PassiveId, PassiveRank } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { combatMaxHp } from '@/systems/combat/forms';
import { afterglowEffects, hasPassive, passiveRank } from '@/systems/combat/passives';
import { spilledLightShare } from '@/systems/combat/passiveFormulas';
import { inArena } from '@/systems/combat/arenaGeometry';
import { roll } from '@/systems/combat/dice';
import { getHexesInRange, hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * The Firefly's rules (the private project notes, "### Firefly"): the support that
 * heals by hurting. Pure — the store-touching halves are `combatEvents.applyMote`,
 * `combatEvents.applyLightbond` and the store's `payMeditation` — so the resolver,
 * the inspector and the tests read one answer.
 */

const F = () => BALANCE.FIREFLY;

/** Living, wounded, on the caster's side and not an objective. */
const hurtAlly = (caster: CombatUnit, u: CombatUnit) =>
  u.currentHp > 0 && !u.objective && u.isPlayer === caster.isPlayer && u.currentHp < combatMaxHp(u);

/**
 * Glowmote's mote as this caster throws it: Brighter Motes raises the share (by
 * its rung) and the reach. Undefined for a skill that carries no mote.
 */
export function moteSpec(caster: CombatUnit, skill: HeroSkill): { share: number; reach: number } | undefined {
  if (!skill.mote) return undefined;
  if (!hasPassive(caster, 'brighterMotes')) return skill.mote;
  return {
    share: Math.round(F().BRIGHTER_MOTE_SHARE * passiveRank(caster, 'brighterMotes').scale * 1000) / 1000,
    reach: F().BRIGHTER_MOTE_REACH,
  };
}

/**
 * Who the mote flies to: the living ally within `reach` hexes of the caster with
 * the **lowest health fraction**, the caster left out — and the caster itself only
 * when nobody else in reach is hurt. Ties go to the nearer, then the id, so the
 * same board always picks the same unit. Undefined when nobody, the caster
 * included, is hurt.
 */
export function moteRecipient(
  caster: CombatUnit,
  units: readonly CombatUnit[],
  reach: number,
): CombatUnit | undefined {
  return moteRecipients(caster, units, reach, 1)[0];
}

/**
 * `moteRecipient` for a mote that heals `count` allies (Twin Motes: two). The
 * most hurt others in reach come first, by the same order; the caster fills a
 * place only when fewer than `count` others are hurt, and only if it is hurt
 * itself. Each recipient takes the whole mote.
 */
export function moteRecipients(
  caster: CombatUnit,
  units: readonly CombatUnit[],
  reach: number,
  count: number,
): CombatUnit[] {
  const self = units.find((u) => u.id === caster.id) ?? caster;
  const others = units
    .filter((u) => u.id !== self.id && hurtAlly(self, u) && hexDistance(u.position, self.position) <= reach)
    .sort((a, b) =>
      a.currentHp / combatMaxHp(a) - b.currentHp / combatMaxHp(b)
      || hexDistance(a.position, self.position) - hexDistance(b.position, self.position)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, count);
  return others.length < count && hurtAlly(self, self) ? [...others, self] : others;
}

/** How many allies one of this caster's motes heals: two with Twin Motes, else one. */
export const moteCount = (caster: CombatUnit): number =>
  hasPassive(caster, 'twinMotes') ? F().TWIN_MOTES : 1;

/**
 * The skills Far Light reaches one hex further. The plan names them: the two that
 * aim at an ally and the bolt whose mote it is. Lantern Glide's blink, the
 * Swarm's aim and the Beacon's plant keep their reach.
 */
export const FAR_LIGHT_SKILLS: readonly string[] = ['glowmote', 'lightbond', 'purifying_light'];

/**
 * A skill as a Firefly holding Far Light casts it: `FAR_LIGHT_RANGE` more hexes
 * on the three it names, nothing on the rest. Baked once when the unit is built
 * (`unitFactory.playerUnitFor`), beside the mastery modifiers and Blood Rush.
 */
export function withFarLight(
  skill: HeroSkill,
  ranks: Partial<Record<PassiveId, PassiveRank>> | undefined,
): HeroSkill {
  if (!ranks?.farLight || !FAR_LIGHT_SKILLS.includes(skill.id) || skill.range <= 0) return skill;
  return { ...skill, range: skill.range + F().FAR_LIGHT_RANGE };
}

/** What the mote heals for a cast that dealt `damageDealt`: never below 1 once anything landed. */
export function moteHeal(share: number, damageDealt: number): number {
  return damageDealt > 0 ? Math.max(1, Math.round(damageDealt * share)) : 0;
}

/**
 * Spilled Light: what the unused part of a mote deals to the enemy the bolt struck,
 * or nothing without the node. `amount` is the mote and `landed` what each recipient
 * took of it: the larger gap counts, one mote's worth and never the sum, and with no
 * recipient at all the whole mote does.
 */
export function spilledLightDamage(caster: CombatUnit, amount: number, landed: readonly number[]): number {
  if (!hasPassive(caster, 'spilledLight')) return 0;
  const spilled = landed.length === 0 ? amount : Math.max(...landed.map((l) => amount - l));
  return spilled > 0 ? Math.round(spilled * spilledLightShare(passiveRank(caster, 'spilledLight'))) : 0;
}

/**
 * The ally a Firefly has bonded with Lightbond, and the share of each of its
 * blows that ally heals: the living unit carrying a Lightbond aura laid by this
 * caster. One bond per Firefly, so the first found is the only one.
 */
export function lightbondOf(
  caster: CombatUnit,
  units: readonly CombatUnit[],
): { unit: CombatUnit; percent: number } | undefined {
  for (const u of units) {
    if (u.currentHp <= 0 || u.id === caster.id) continue;
    const bond = u.activeEffects.find((e) => e.type === AuraType.Lightbond && e.sourceUnitId === caster.id);
    if (bond) return { unit: u, percent: bond.magnitude };
  }
  return undefined;
}

/** What one blow of `damage` heals the bonded ally for. */
export function lightbondHeal(percent: number, damage: number): number {
  return damage > 0 && percent > 0 ? Math.max(1, Math.round((damage * percent) / 100)) : 0;
}

/** One ally's share of a Lantern Breath, and what lands on them with it. */
export interface LanternBreathShare {
  unitId: string;
  heal: number;
  /** Afterglow's buffs when the Firefly holds it and the ally is hurt; otherwise none. */
  effects: ActiveEffect[];
}

/**
 * Lantern Breath: Meditate's next-turn heal (`heal`, the Monk's own) also reaches
 * every living ally adjacent to the Firefly at `LANTERN_BREATH_SHARE` of its worth,
 * scaled by the node's rung. Empty for a Monk without the node.
 */
export function lanternBreathShares(
  monk: CombatUnit,
  units: readonly CombatUnit[],
  heal: number,
): LanternBreathShare[] {
  if (!hasPassive(monk, 'lanternBreath') || heal <= 0) return [];
  const each = Math.max(1, Math.round(heal * F().LANTERN_BREATH_SHARE * passiveRank(monk, 'lanternBreath').scale));
  return units
    .filter((u) => u.id !== monk.id && u.currentHp > 0 && !u.objective && u.isPlayer === monk.isPlayer
      && hexDistance(u.position, monk.position) === 1)
    .map((u) => ({
      unitId: u.id,
      heal: each,
      effects: hasPassive(monk, 'afterglow') && u.currentHp < combatMaxHp(u)
        ? afterglowEffects(monk.id, passiveRank(monk, 'afterglow'))
        : [],
    }));
}

// ─── The capstones ────────────────────────────────────────────────────────────

/**
 * Where Firefly Motes land: `count` distinct free arena hexes within
 * `MOTES_RADIUS` of the caster, drawn at random from the dice
 * (`systems/combat/dice`). Free means no living unit, no solid ground and no
 * mote already there. Fewer — possibly none — when the ground is crowded.
 */
export function moteHexes(
  caster: CombatUnit,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
  count: number,
): HexCoord[] {
  const taken = new Set<string>([
    ...units.filter((u) => u.currentHp > 0).map((u) => hexKey(u.position)),
    ...hazards.filter((h) => h.solid || h.mote).flatMap((h) => h.hexes.map(hexKey)),
  ]);
  const free = getHexesInRange(caster.position, F().MOTES_RADIUS)
    .filter((h) => inArena(h) && !taken.has(hexKey(h)))
    // A fixed order before the draw, so the same dice always lay the same motes
    .sort((a, b) => a.q - b.q || a.r - b.r);
  const picked: HexCoord[] = [];
  while (picked.length < count && free.length > 0) {
    const i = Math.min(free.length - 1, Math.floor(roll() * free.length));
    picked.push(free.splice(i, 1)[0]);
  }
  return picked;
}

/** A mote's hazard id: one per hex, so putting one out never touches another. */
export const moteId = (ownerId: string, hex: HexCoord) => `mote:${ownerId}:${hex.q},${hex.r}`;

/** The mote waiting on `hex`, if any. */
export function moteAt(hazards: readonly ArenaHazard[], hex: HexCoord): ArenaHazard | undefined {
  return hazards.find((h) => h.mote && h.hexes.some((x) => x.q === hex.q && x.r === hex.r));
}

/**
 * What a mote gives an ally of its owner who arrives on it: Attack and Critical
 * Chance for `MOTE_BUFF_DURATION`, both from the owner. The heal rides on the
 * hazard (`ArenaHazard.mote.heal`).
 */
export function moteBuffs(ownerId: string): ActiveEffect[] {
  return [
    { type: AuraType.AttackBuff, magnitude: F().MOTE_ATTACK, duration: F().MOTE_BUFF_DURATION, sourceUnitId: ownerId },
    { type: AuraType.CritBuff, magnitude: F().MOTE_CRIT, duration: F().MOTE_BUFF_DURATION, sourceUnitId: ownerId },
  ];
}

/** Whether a unit is a living Lantern Beacon. */
export const isLanternBeacon = (u: CombatUnit) => u.templateId === 'lantern_beacon' && u.currentHp > 0;

/**
 * Who a Beacon's pulse heals: every living ally of its side within
 * `BEACON_RADIUS` of it, the Beacon itself left out (it would otherwise mend its
 * own clock) and objectives with it.
 */
export function beaconPulseTargets(beacon: CombatUnit, units: readonly CombatUnit[]): CombatUnit[] {
  return units.filter((u) => u.id !== beacon.id && u.currentHp > 0 && !u.objective
    && u.isPlayer === beacon.isPlayer && hexDistance(u.position, beacon.position) <= F().BEACON_RADIUS);
}

/**
 * The Beacon's light as it should stand now: allies of a living Beacon within
 * its reach wear `BeaconLight`, its enemies within reach wear `BeaconLit` and
 * lose any Stealth; everyone else wears neither. Returns `units` itself when
 * nothing changes, else a new array with only the changed units replaced. Pure:
 * `combatStore.syncBeacons` writes it after every move, arrival and death.
 */
export function syncBeaconLight(units: readonly CombatUnit[]): readonly CombatUnit[] {
  const beacons = units.filter(isLanternBeacon);
  let changed = false;
  const next = units.map((u) => {
    const held = u.activeEffects.filter((e) => e.type === AuraType.BeaconLight || e.type === AuraType.BeaconLit);
    const lit = u.currentHp > 0 && !u.objective && u.templateId !== 'lantern_beacon';
    const near = (side: boolean) => lit
      ? beacons.find((b) => b.isPlayer === side && hexDistance(b.position, u.position) <= F().BEACON_RADIUS)
      : undefined;
    const friend = near(u.isPlayer);
    const foe = near(!u.isPlayer);
    const want: ActiveEffect[] = [
      ...(friend ? [{ type: AuraType.BeaconLight, magnitude: F().BEACON_CRIT, duration: -1, sourceUnitId: friend.id }] : []),
      ...(foe ? [{ type: AuraType.BeaconLit, magnitude: F().BEACON_EXPOSED, duration: -1, sourceUnitId: foe.id }] : []),
    ];
    const stealthed = !!foe && u.activeEffects.some((e) => e.type === AuraType.Stealth);
    const same = !stealthed && held.length === want.length
      && want.every((w) => held.some((h) => h.type === w.type && h.sourceUnitId === w.sourceUnitId));
    if (same) return u;
    changed = true;
    return {
      ...u,
      activeEffects: [
        ...u.activeEffects.filter((e) => e.type !== AuraType.BeaconLight && e.type !== AuraType.BeaconLit
          && !(foe && e.type === AuraType.Stealth)),
        ...want,
      ],
    };
  });
  return changed ? next : units;
}
