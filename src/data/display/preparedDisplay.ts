import { skillName } from '@/data/gameText';
import { mirePull } from '@/systems/combat/displayNumbers';
import type { ArenaHazard, CombatUnit, PreparedAttack } from '@/models/types';
import { AuraType } from '@/models/types';
import { carrierOf, PreparedPreview, windowsLeft } from '@/systems/combat/preparedAttacks';
import { answerOf, boundWholeness } from '@/systems/combat/warnedAnswers';
import { ventsThatSpawn } from '@/systems/combat/factionEliteKits';
import { kairenTail } from '@/systems/combat/kairenRules';
import { rubbleLanding } from '@/systems/combat/trollScript';
import { unitName } from '@/data/templates/unitText';
import { skillTargetRule } from '@/data/templates/bossText';
import { hasMessage, formatPercent } from '@/i18n';
import { hexes, listText, passiveLabel, skillText as tx, statusLabel } from '@/data/display/skillWords';

/**
 * How a pending warning reads on the HUD.
 *
 * One line per warning: what is coming, from whom, and what it is still
 * waiting for. Pure and React-free so the wording is testable and the banner
 * and the log cannot say two different things about the same attack.
 */

export interface WarningLine {
  id: string;
  /** The headline: "Boss: Imperial Cleave". */
  title: string;
  /** What it is waiting on, or that it lands next. */
  detail: string;
  /** True once nothing is owed — it lands on its caster's next turn. */
  imminent: boolean;
}

/** A unit's display name by id, if it is on the board. */
const nameOf = (id: string | undefined, units: CombatUnit[]): string | undefined => {
  const unit = units.find((u) => u.id === id);
  return unit && unitName(unit);
};

const names = (ids: string[], units: CombatUnit[]): string =>
  ids
    .map((id) => nameOf(id, units))
    .filter((n): n is string => !!n)
    .join(', ');

/**
 * What the elites' warnings add to the plain line, said where the party reads it: what
 * the marsh will do and how to answer it, who the cracked ground follows, what the seed
 * needs to grow. These are drawn from the board as it stands (who is webbed, how whole the
 * tomb is); a catalog move's own words are `moveNotes`.
 */
function eliteTail(
  attack: PreparedAttack,
  bound: string[],
  caster: CombatUnit | undefined,
  units: CombatUnit[],
): string {
  const who = caster ? unitName(caster) : tx('warning.theCaster');
  const hero = bound[1] ?? tx('warning.theHero');
  if (attack.scripted === 'tomb') {
    const tomb = units.find((u) => u.id === (attack.bound ?? [])[0]);
    return tomb
      ? tx('warning.tombHp', { hero, hp: `${tomb.currentHp}/${tomb.stats.maxHp}` })
      : tx('warning.tomb', { hero });
  }
  if (attack.scripted === 'web') {
    const held = (attack.bound ?? [])
      .map((id) => units.find((u) => u.id === id && u.currentHp > 0)?.objective?.linkedUnitId)
      .map((id) => nameOf(id, units))
      .filter((n): n is string => !!n);
    const webbed = held.length > 0 ? held.join(' & ') : tx('warning.theWebbed');
    // Jadeveil: Silk Hollow / Yokai — up on her threads she drops rather than dashes, and nothing reaches her
    const hanging = !!caster?.activeEffects.some((e) => e.type === AuraType.Suspended);
    return tx(`warning.web${held.length > 1 ? '.many' : ''}${hanging ? '.hanging' : ''}`, { who: webbed });
  }
  if (attack.scripted === 'undertow') {
    return tx('warning.undertow', { hexes: hexes(mirePull()), who });
  }
  if (attack.scripted === 'fracture') {
    return tx('warning.fracture', { marked: bound.length > 0 ? bound.join(' & ') : tx('warning.theMarked'), who });
  }
  if (attack.scripted === 'briar') {
    return tx('warning.briar', { hero });
  }
  return '';
}

/**
 * The move's own words (`warning.move.<id>`): what it does and how it is answered, in the order the
 * party weighs it, for a move whose answers are more than the rules' notes say. Then what its answers
 * add as the board stands: the ground a script spared at the cast (`shelter`, `.sheltered`), and the
 * share a graded warning lands at, read off what it is bound to (`cancel.graded`, `.grade`).
 */
function moveNotes(attack: PreparedAttack, caster: CombatUnit | undefined, units: CombatUnit[]): string[] {
  const own = `warning.move.${attack.skill.id}`;
  if (!hasMessage(`skillText.${own}`)) return [];
  const notes = [tx(own, { who: caster ? unitName(caster) : tx('warning.theCaster') })];
  if ((attack.sheltered ?? []).length > 0 && answerOf(attack, 'shelter', (a) => !!a.besideObjective)) {
    notes.push(tx(`${own}.sheltered`));
  }
  const graded = answerOf(attack, 'cancel', (a) => !!a.graded && !!a.objective);
  if (graded) notes.push(tx(`${own}.grade`, { share: formatPercent(boundWholeness(attack.id, graded.objective!, units)) }));
  return notes;
}

/**
 * What a warning's authored rules add to its plate (`PreparedSpec.split`, `blockedBy`, `shelter`,
 * `onWhiff`), read off the preview so the plate names the very bodies and shares the landing uses.
 */
function ruleNotes(attack: PreparedAttack, preview: PreparedPreview | undefined, units: CombatUnit[]): string[] {
  const spec = attack.spec;
  const notes: string[] = [];
  if (spec.split) {
    const n = preview?.splitBy ?? 1;
    notes.push(n > 1 ? tx('warning.split', { count: n, share: formatPercent(1 / n) }) : tx('warning.splitAlone'));
  }
  if (spec.blockedBy) {
    const blocker = nameOf(preview?.blockerId, units);
    notes.push(blocker
      ? tx('warning.blocker', { name: blocker, share: formatPercent(spec.blockedBy.share) })
      : tx('warning.blockable', {
        share: formatPercent(spec.blockedBy.share),
        holds: listText([statusLabel(AuraType.Barrier), passiveLabel('lastStand'), passiveLabel('immovable')]),
      }));
  }
  if (spec.heldBy) {
    // Each hero holding their own hex behind a shield is named: the board draws their point apart
    const holders = names(preview?.plan.holders ?? [], units);
    notes.push(holders
      ? tx('warning.held', { names: holders, share: formatPercent(spec.heldBy.share) })
      : tx('warning.holdable', {
        share: formatPercent(spec.heldBy.share),
        holds: listText([statusLabel(AuraType.Barrier), passiveLabel('lastStand'), passiveLabel('immovable')]),
      }));
  }
  const sheltered = preview?.sheltered.length ?? 0;
  if (sheltered > 0) {
    // The heroes who stand on spared ground are named; ground sheltered by a hazard (the Rift under Skyfire)
    // is drawn on the board and explained by the move's own line, so it is never counted in hexes
    const covered = new Set(preview!.sheltered.map((h) => `${h.q},${h.r}`));
    const under = units.filter((u) => u.currentHp > 0 && !u.objective && u.isPlayer
      && covered.has(`${u.position.q},${u.position.r}`)).map(unitName);
    if (under.length > 0) notes.push(tx('warning.shelteredBy', { names: under.join(', ') }));
    else if (!spec.shelter?.onHazard) notes.push(tx('warning.sheltered', { count: sheltered }));
  }
  // The stated target rule, in the words the briefing uses; a carried warning names whom it rides on instead
  const rule = skillTargetRule(attack.skill);
  if (rule && !spec.carried) notes.push(tx('warning.rule', { rule }));
  // A move outlasted on purpose says in its own line what a landing on nobody does
  if (spec.onWhiff && !answerOf(attack, 'outlast')) {
    const key = `skillText.whiff.${spec.onWhiff}`;
    notes.push(tx('warning.whiff', { what: hasMessage(key) ? tx(`whiff.${spec.onWhiff}`) : tx('warning.whiffUnnamed') }));
  }
  return notes;
}

export function warningLines(
  attacks: PreparedAttack[],
  previews: PreparedPreview[],
  units: CombatUnit[],
  /** The arena's standing ground: the Troll's Prey says when its mark holds rubble he will break. */
  hazards: readonly ArenaHazard[] = [],
): WarningLine[] {
  const undermines = attacks.filter((attack) => attack.scripted === 'undermine');
  const lines = attacks.filter((attack) => attack.scripted !== 'undermine').map((attack) => {
    const preview = previews.find((p) => p.attackId === attack.id);
    const caster = units.find((u) => u.id === attack.casterId);
    const owed = preview?.responsesOwed ?? [];
    const pushed = (preview?.landings ?? []).filter((m) => m.moved).length;
    // What a scripted warning adds to the plain footprint, said where the party
    // reads it: the orb's charge and what a chain or a claim is tied to
    const bonus = attack.bonusHexes?.length ?? 0;
    const bound = (attack.bound ?? [])
      .map((id) => nameOf(id, units))
      .filter((n): n is string => !!n);
    const onRift = (preview?.hazardIds ?? []).length;
    // Each note is its own " · …" entry: a list of what the plate adds, in order
    const notes: string[] = [];
    // Kairen's Gale says its wind, who it leaves on the Downdraft and who a body holds off it in its own
    // tail (`kairenTail`), which is what keeps the line inside the folded panel: the generic push count
    // and the Smash's "no throw" would repeat it in other words
    const wind = !!attack.wind;
    if (pushed > 0 && !wind) notes.push(tx(attack.scripted === 'undertow' ? 'warning.drags' : 'warning.pushes', { n: pushed }));
    if (onRift > 0) notes.push(tx('warning.onRift'));
    // Who a push will not move, because the wall or rubble stands at their back
    const braced = wind ? '' : names(preview?.braced ?? [], units);
    if (braced) notes.push(tx('warning.braced', { names: braced }));
    // The Troll's Prey baited onto his rubble: he will come down on it, break it and be Exposed
    if (attack.scripted === 'prey' && caster && rubbleLanding(attack.aim, attack.hexes, caster, hazards)) {
      notes.push(tx('warning.preyRubble'));
    }
    notes.push(...moveNotes(attack, caster, units));
    if (bonus > 0) notes.push(tx('warning.orb', { count: bonus }));
    notes.push(...ruleNotes(attack, preview, units));
    if (attack.scripted === 'chains' && bound.length > 0) notes.push(tx('warning.chains', { names: bound.join(' & ') }));
    if (attack.scripted === 'claim' && bound.length > 0) notes.push(tx('warning.claim', { names: bound.join(', ') }));
    if (attack.scripted === 'realm') notes.push(tx('warning.realm'));
    if (answerOf(attack, 'toll')) notes.push(tx('warning.sealed'));
    if (answerOf(attack, 'hold')) notes.push(tx('warning.hold'));
    const tail = notes.join('') +
      eliteTail(attack, bound, caster, units) +
      // Jadeveil: Kairen's warnings name their answer
      kairenTail(attack, units, preview?.landings, preview?.windSheltered);
    // A carried warning (the Furnace Heart) names who holds it and the rounds left, not the whole
    // party it waits on for five rounds
    const carrier = carrierOf(attack);
    const rounds = carrier ? windowsLeft(attack, units) : 0;
    return {
      id: attack.id,
      title: tx('warning.title', { caster: caster ? unitName(caster) : tx('warning.enemy'), skill: skillName(attack.skill) }),
      detail:
        carrier
          ? rounds > 0
            ? tx('warning.carried', { name: nameOf(carrier, units) ?? '', count: rounds, tail })
            : tx('warning.carriedDue', { name: nameOf(carrier, units) ?? '', caster: caster ? unitName(caster) : tx('warning.theCaster'), tail })
          : owed.length > 0
            ? tx('warning.waitingOn', { names: names(owed, units), tail })
            : caster
              ? tx('warning.landsOn', { name: unitName(caster), tail })
              : tx('warning.landsNext', { tail }),
      imminent: owed.length === 0,
    };
  });
  if (undermines.length > 0) {
    const owed = [...new Set(undermines.flatMap((attack) =>
      previews.find((preview) => preview.attackId === attack.id)?.responsesOwed ?? []))];
    const ready = undermines.filter((attack) =>
      (previews.find((preview) => preview.attackId === attack.id)?.responsesOwed.length ?? 0) === 0).length;
    const vents = undermines.flatMap((attack) => attack.vents ?? []);
    const opening = undermines.reduce((sum, attack) => {
      const caster = units.find((u) => u.id === attack.casterId);
      return sum + (caster ? ventsThatSpawn(caster, attack.vents ?? [], units).length : 0);
    }, 0);
    const name = skillName(undermines[0].skill);
    lines.unshift({
      id: 'undermine',
      title: undermines.length > 1 ? tx('warning.undermineMany', { name, n: undermines.length }) : name,
      detail: (ready > 0 ? tx('warning.undermineReady', { n: ready }) : '')
        + (owed.length > 0 ? tx('warning.undermineWaiting', { names: names(owed, units) }) : '')
        + tx('warning.undermineRules', { open: opening, total: vents.length }),
      imminent: ready > 0,
    });
  }
  return lines;
}
