import { DODGE_COLOR, dodgeText } from '@/data/display/statusDisplay';
import { slash } from '@/data/skills/skillData';
import { CombatUnit, HexCoord } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { requireUnit } from '@/systems/combat/unitLookup';
import { CombatSink } from '@/systems/combat/combatSink';
import { executeAIActions } from '@/systems/combat/enemyAI';
import { resolveSkillUse } from '@/systems/combat/skillResolution';
import { makeStats, makeUnit } from '../support/fixtures';

/**
 * A dodged blow said two different things depending on who threw it.
 *
 * The player's resolver floated the word. The AI's had no text channel at all —
 * only a damage callback — so it reported a dodge as **zero damage**, and the
 * arena rendered that as `-0` over the hero who had just avoided the hit. A
 * number saying a blow landed for nothing is the opposite of what happened, and
 * it appeared in exactly the half of the fight a player is watching most
 * closely, because it is happening to them.
 *
 * Both sides cast through one resolver and one sink now, with a fixed `rng`
 * forcing the dodge, so the rule is asserted on what each side actually floats.
 */

const at = (q: number, r: number): HexCoord => ({ q, r });

type Float = { at: HexCoord; text: string; color: string };

function recorder() {
  const floats: Float[] = [];
  const logs: string[] = [];
  const sink: CombatSink = {
    log: (text) => logs.push(text),
    float: (hex, text, color) => floats.push({ at: hex, text, color }),
    vfx: () => {},
    status: () => {},
  };
  return { sink, floats, logs };
}

/** `casterIsPlayer` picks which side swings; the target always dodges (100%). */
function setup(casterIsPlayer: boolean) {
  useCombatStore.getState().reset();
  const caster = makeUnit({ id: 'caster', isPlayer: casterIsPlayer, position: at(0, 0), skills: [slash] });
  const target = makeUnit({
    id: 'target', isPlayer: !casterIsPlayer, position: at(0, 1),
    stats: makeStats({ maxHp: 200, dodgeChance: 100 }),
  });
  useCombatStore.getState().initCombat(casterIsPlayer ? [caster] : [target], casterIsPlayer ? [target] : [caster]);
  return {
    caster: requireUnit(useCombatStore.getState().units, 'caster'),
    target: requireUnit(useCombatStore.getState().units, 'target'),
  };
}

const dodged = () => 0; // under any dodge chance

function swing(casterIsPlayer: boolean) {
  const { caster, target } = setup(casterIsPlayer);
  const rec = recorder();
  let result: { ok: boolean; endsTurn: boolean } | undefined;
  if (casterIsPlayer) {
    result = resolveSkillUse(caster, slash, target.position, rec.sink, { rng: dodged });
  } else {
    executeAIActions(caster, [{ type: 'skill', skill: slash, skillTarget: target.position }], rec.sink, { rng: dodged });
  }
  const live = (id: string): CombatUnit => requireUnit(useCombatStore.getState().units, id);
  return { ...rec, result, caster: live('caster'), target: live('target') };
}

describe('what a dodge reports', () => {
  it.each([[true], [false]])('floats the word, never an amount (caster is player: %s)', (casterIsPlayer) => {
    const { floats, target } = swing(casterIsPlayer);
    expect(floats).toEqual([{ at: target.position, text: dodgeText(), color: DODGE_COLOR }]);
    expect(target.currentHp).toBe(200);
  });

  it('names the same words on both execution paths', () => {
    const player = swing(true);
    const enemy = swing(false);
    expect(enemy.floats.map((f) => f.text)).toEqual(player.floats.map((f) => f.text));
    expect(enemy.logs).toEqual(player.logs);
  });

  /** Both sides keep the constant in one place: DODGED, and not the red a real hit is drawn in. */
  it('holds the constant in one place', () => {
    expect(dodgeText()).toBe('DODGED');
    expect(DODGE_COLOR).not.toBe('#ff4444');
  });

  /**
   * And the turn is still spent. A dodge counts as the skill having landed
   * somewhere — refunding it would let a player re-roll a miss for free.
   */
  it('still counts the cast as having happened, so the turn is not refunded', () => {
    expect(swing(true).result).toMatchObject({ ok: true, endsTurn: true });
    expect(swing(false).caster.hasActed).toBe(true);
  });
});
