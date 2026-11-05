import { bigUnitOpacity, COVERING_ACTIVE_OPACITY, COVERING_OPACITY, isHiddenBehind } from '@/systems/combat/unitOcclusion';
import { at, makeFoe, makeUnit } from '../support/fixtures';

const big = makeFoe({ id: 'big', position: at(0, 0) });

describe('a big unit in front of the party', () => {
  it('hides a unit standing behind it and roughly in line, and nobody else', () => {
    expect(isHiddenBehind(big, makeUnit({ position: at(1, -2) }))).toBe(true);
    // well nearer the viewer, or far off to the side, is not covered
    expect(isHiddenBehind(big, makeUnit({ position: at(-1, 4) }))).toBe(false);
    expect(isHiddenBehind(big, makeUnit({ position: at(3, -2) }))).toBe(false);
  });

  it('is slightly see-through while it covers anyone, and more on the covered unit\'s turn', () => {
    const hero = makeUnit({ id: 'h', position: at(1, -2) });
    expect(bigUnitOpacity(big, [big, hero], null)).toBe(COVERING_OPACITY);
    expect(bigUnitOpacity(big, [big, hero], 'h')).toBe(COVERING_ACTIVE_OPACITY);
  });

  it('stays solid with nobody behind it, and ignores enemies, the dead and objectives', () => {
    expect(bigUnitOpacity(big, [big], null)).toBe(1);
    const others = [
      makeFoe({ id: 'e', position: at(1, -2) }),
      makeUnit({ id: 'd', position: at(1, -2), currentHp: 0 }),
    ];
    expect(bigUnitOpacity(big, [big, ...others], null)).toBe(1);
  });
});
