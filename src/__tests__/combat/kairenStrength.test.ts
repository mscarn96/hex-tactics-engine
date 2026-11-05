import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { phasesFor } from '@/systems/combat/bossPhases';
import { castleEnemyHp, castleStagePower, CASTLE_STAGE_COUNT } from '@/systems/world/castle';
import { summitTierScale } from '@/systems/world/summit';
import { at } from '../support/fixtures';

/**
 * Jadeveil: Kairen at tier 1 is about a quarter stronger than Aethelred at the castle's
 * tier 1 (the private project notes), measured as each is fought: the same party
 * level, each encounter's own power, and every phase's stat multipliers averaged over a
 * fight spent a third in each. Strength is the geometric mean of health and damage
 * (Attack and Magic averaged), so a quarter more of both reads as a quarter stronger.
 */
const LEVEL = 25;

function asFought(id: 'kairen' | 'aethelred', power: number) {
  const [unit] = createEnemyUnits([id], [at(0, -2)], LEVEL, power);
  const phases = phasesFor(id) ?? [{ stats: undefined }];
  const mean = (stat: 'attack' | 'magic') =>
    phases.reduce((sum, p) => sum + unit.stats[stat] * ((p.stats as Record<string, number> | undefined)?.[stat] ?? 1), 0) / phases.length;
  // The castle fields every body at `CASTLE_HP_SCALE` of its scaled health, Aethelred too
  const hp = id === 'aethelred' ? castleEnemyHp(unit.stats.maxHp) : unit.stats.maxHp;
  return { hp, attack: mean('attack'), magic: mean('magic') };
}

it('is about a quarter to three tenths stronger than the Emperor at tier 1', () => {
  const kairen = asFought('kairen', summitTierScale(1));
  const emperor = asFought('aethelred', castleStagePower(1, CASTLE_STAGE_COUNT - 1));
  const hp = kairen.hp / emperor.hp;
  const damage = (kairen.attack / emperor.attack + kairen.magic / emperor.magic) / 2;
  const strength = Math.sqrt(hp * damage);
  expect(strength).toBeGreaterThanOrEqual(1.25);
  expect(strength).toBeLessThanOrEqual(1.3);
});
