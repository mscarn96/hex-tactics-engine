import { setDice } from '@/systems/combat/dice';

/**
 * Pins the combat dice and returns a spy on them, so a suite can say what the
 * next roll is (`.mockReturnValue(0.99)`, `.mockImplementation(...)`) and read
 * how often it was asked. The replacement for spying on `Math.random`, which
 * pinned every roll in the process and said nothing about which module rolled.
 * `mockRestore()` puts the real dice back; `jest.setup.ts` does too after each
 * test.
 */
export function spyDice(): jest.SpyInstance<number, []> {
  const dice = { roll: () => 0.5 };
  const spy = jest.spyOn(dice, 'roll');
  setDice(() => dice.roll());
  const restore = spy.mockRestore.bind(spy);
  spy.mockRestore = () => {
    restore();
    setDice(null);
  };
  return spy;
}
