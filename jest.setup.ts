import { setDice } from '@/systems/combat/dice';
import { setTempoRandom } from '@/systems/combat/turnTempo';

// No suite gets a bonus turn it did not ask for: a roll of 1 never beats a
// chance below 1. A suite about tempo sets its own dice.
setTempoRandom(() => 1);

// Dice a suite pinned do not leak into the next one. See `__tests__/support/dice`.
afterEach(() => setDice(null));
