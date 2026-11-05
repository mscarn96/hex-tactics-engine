import { HexCoord, PreparedReaction } from '@/models/types';
import { AimBoard, aimStep, castsOnPress, IDLE_AIM, targetHexSides } from '@/systems/combat/aimSteps';
import { carapaceBastion, carapaceLeap, shellWall, vengefulShell } from '@/data/skills/masterySkills';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { skillBlockedReason, skillUsability } from '@/systems/combat/cooldowns';
import { createReaction } from '@/systems/combat/reactions';
import { skillTargetKind } from '@/systems/combat/targetKind';
import { t } from '@/i18n';
import { hexKey } from '@/utils/hexUtils';
import { at, makeFoe, makeUnit } from '../support/fixtures';

/**
 * PT-06, "Carapace Leap often doesn't work — I can't click on the target": the
 * aiming half of it. A Reaction pressed with its slot taken is refused at the
 * press with the reason; the ward it lights is green and never an objective; and
 * the Beetle's two self-centred rings are cast with no enemy near.
 */

const keys = (hexes: readonly HexCoord[]) => hexes.map(hexKey).sort();

const beetle = (over = {}) =>
  makeUnit({ id: 'beetle', position: at(0, 0), skills: [carapaceLeap, shellWall, carapaceBastion, vengefulShell], ...over });
const ally = makeUnit({ id: 'ally', position: at(2, 0) });

const board = (current = beetle(), units = [current, ally], reactions: PreparedReaction[] = []): AimBoard => ({
  current, units, hazards: [], highlights: [], skill: null, reactions,
});

describe('Carapace Leap with a Reaction already standing', () => {
  const held = () => [createReaction(beetle(), vengefulShell)];

  it('is blocked up front, with the reason the resolver would give', () => {
    const me = beetle();
    expect(skillBlockedReason(carapaceLeap, me, [me, ally], held())).toBe(t('combatLog.refuse.reactionHeld'));
    expect(skillUsability(me, carapaceLeap, [me, ally], held())).toMatchObject({ ok: false, guard: 'reaction' });
    // Free again with the slot open, and a non-Reaction skill is never held to it
    expect(skillBlockedReason(carapaceLeap, me, [me, ally], [])).toBeNull();
    expect(skillBlockedReason(shellWall, me, [me, ally], held())).toBeNull();
  });

  it('refuses at the press with a toast, lighting nothing', () => {
    const { effects } = aimStep(IDLE_AIM, { type: 'press', skill: carapaceLeap }, board(beetle(), [beetle(), ally], held()));
    expect(effects).toEqual([{ kind: 'toast', text: t('combatLog.refuse.reactionHeld') }]);
  });

  it('a Beetle with Second Watch may stand a second one', () => {
    const watcher = beetle({ passives: ['secondWatch'] });
    expect(skillBlockedReason(carapaceLeap, watcher, [watcher, ally], held())).toBeNull();
    const { effects } = aimStep(IDLE_AIM, { type: 'press', skill: carapaceLeap }, board(watcher, [watcher, ally], held()));
    expect(effects).toContainEqual({ kind: 'highlight', hexes: [ally.position] });
  });
});

describe('Carapace Leap\'s wards', () => {
  it('lights allies only, never an objective, and in the support colour', () => {
    const me = beetle();
    const rampart = makeUnit({ id: 'rock', position: at(1, 0), objective: { kind: 'rampart', ownerId: 'beetle' } });
    const foe = makeFoe({ id: 'foe', position: at(0, 2) });
    const lit = getValidSkillTargetHexes(carapaceLeap, me, [me, ally, rampart, foe]);
    expect(keys(lit)).toEqual(keys([ally.position]));
    expect(skillTargetKind(carapaceLeap)).toBe('support');
    expect(targetHexSides(carapaceLeap, me, lit, [me, ally])).toEqual({ attack: [], support: [ally.position] });
    // Vengeful Shell answers with a blow, so it is still read as one
    expect(skillTargetKind(vengefulShell)).toBe('attack');
  });
});

describe('the Beetle\'s self-centred rings', () => {
  it('Shell Wall and Carapace Bastion cast on press with no enemy near', () => {
    const me = beetle();
    const far = makeFoe({ id: 'far', position: at(6, 0) });
    for (const skill of [shellWall, carapaceBastion]) {
      for (const units of [[me, ally], [me, ally, far], [me]]) {
        const targets = getValidSkillTargetHexes(skill, me, units);
        expect(targets).toEqual([me.position]);
        expect(castsOnPress(skill, me, targets)).toBe(true);
      }
    }
    const { effects } = aimStep(IDLE_AIM, { type: 'press', skill: shellWall }, board(me, [me, ally, far]));
    expect(effects).toContainEqual({ kind: 'cast', skill: shellWall, at: me.position, pressed: true });
  });
});
