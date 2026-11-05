import { TileType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { useEmpireStore } from '@/stores/empireStore';
import { useGameStore } from '@/stores/gameStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { usePartyStore } from '@/stores/partyStore';
import { useSimStore } from '@/stores/simStore';
import { CombatReward } from '@/systems/combat/combatRewards';
import { buildEncounter, encounterTerms } from '@/systems/combat/encounterSetup';
import { applyVictory } from '@/systems/combat/encounterResolution';
import { createEnemyUnits, generateEnemyPositions } from '@/systems/combat/unitFactory';
import { defaultSpec } from '@/systems/sim/balance/encounters';
import { runBalanceFight } from '@/systems/sim/balance/fight';
import { decodeFightCode, encodeCastleSetupCode, encodeFightCode } from '@/systems/sim/balance/fightCode';
import { rollParty } from '@/systems/sim/balance/partyRoll';
import { partyRecord } from '@/systems/sim/balance/record';
import { fightSeed, partyRng } from '@/systems/sim/balance/rng';
import { buildSimHero } from '@/systems/sim/simHarness';
import { startSimCastle } from '@/systems/sim/simCastle';
import {
  CASTLE_STAGE_COUNT,
  CASTLE_STAGES, castleStageName,
  castleEncounterId,
  castleEnemyHp,
  castleRunFromId,
  castleStageCarry,
  castleStageEnemies,
  castleStagePower,
} from '@/systems/world/castle';

/**
 * The castle chain between the balance lab and the tuning harness (PT-04). What is pinned: a lab castle
 * fight has a code carrying its party and Seal tier, and the harness's launch of that code is a real castle
 * run whose every stage fields what the lab's `runCastleChain` fields — the same roster, the same stage
 * power (not the harness's own multiplier), the same `CASTLE_HP_SCALE` health — and carries the party
 * between stages by the same rule, without the XP that would rescale the next stage.
 */

const TIER = 2;

const lab = () => {
  const spec = { ...defaultSpec('castle'), tier: TIER };
  const seed = fightSeed(5, 0, 1);
  const party = rollParty(spec, {}, partyRng(seed));
  return { spec, party, record: runBalanceFight(spec, party, seed) };
};

const termsFor = (encounterId: string) => encounterTerms(encounterId, {
  tile: { type: TileType.Plains, threat: 1 },
  partyPosition: { q: 0, r: 0 },
  cityCoord: { q: 0, r: 0 },
  castleCoord: null,
  onDangerGround: false,
});

afterEach(() => {
  useSimStore.getState().exit();
  useSimStore.setState({ battleLog: [], battleTurns: 0 });
  useEmpireStore.getState().reset();
  useCombatStore.getState().reset();
});

describe('a castle fight code', () => {
  it('returns the lab party and its Seal tier as they went in', () => {
    const { party, record } = lab();
    const decoded = decodeFightCode(encodeFightCode(record, TIER));
    if (!decoded.ok) throw new Error(decoded.error);
    expect(decoded.setup.enc).toBe('castle');
    if (decoded.setup.enc !== 'castle') return;
    expect(decoded.setup.tier).toBe(TIER);
    expect(decoded.setup.seed).toBe(record.seed);
    expect(partyRecord({ heroes: decoded.setup.heroes, budget: party.budget, levelSum: party.levelSum }).h).toEqual(partyRecord(party).h);
  });

  it('is the same setup when the harness copies it back', () => {
    const decoded = decodeFightCode(encodeFightCode(lab().record, TIER));
    if (!decoded.ok || decoded.setup.enc !== 'castle') throw new Error('no castle setup');
    const again = decodeFightCode(encodeCastleSetupCode(decoded.setup.tier, decoded.setup.heroes)!);
    if (!again.ok) throw new Error(again.error);
    const { seed: _seed, ...withoutSeed } = decoded.setup;
    expect(again.setup).toEqual(withoutSeed);
  });
});

describe('the harness castle launch', () => {
  /** The harness's start, as `SimSetupScreen.startFight` does it, from a pasted lab code. */
  const launch = () => {
    const { spec, party, record } = lab();
    const decoded = decodeFightCode(encodeFightCode(record, spec.tier));
    if (!decoded.ok || decoded.setup.enc !== 'castle') throw new Error('no castle setup');
    useSimStore.getState().enter();
    // A power the harness chips might hold: a castle stage must not read it
    useSimStore.getState().setPowerScale(3);
    const mint = useInventoryStore.getState().addItem;
    const heroes = decoded.setup.heroes.map((cfg, i) => buildSimHero(cfg, mint, `castle_${i}`)!);
    usePartyStore.setState({ heroes });
    const start = startSimCastle(decoded.setup.tier);
    return { party, heroes, start };
  };

  it('opens a real castle run at the code\'s tier, on the castle\'s ground', () => {
    const { start } = launch();
    expect(start.encounterId).toBe(castleEncounterId(TIER, 0));
    expect(castleRunFromId(start.encounterId)).toEqual({ tier: TIER, stage: 0 });
    expect(useEmpireStore.getState().castleTier).toBe(TIER);
    expect(start.context).toBeTruthy();
  });

  it.each(Array.from({ length: CASTLE_STAGE_COUNT }, (_, i) => i))('fields stage %i as the lab chain does', (stage) => {
    const { party, heroes } = launch();
    const encounterId = castleEncounterId(TIER, stage);
    const sim = useSimStore.getState();
    const built = buildEncounter({
      encounterId,
      terms: termsFor(encounterId),
      heroes,
      castleRun: castleRunFromId(encounterId),
      sim: { active: sim.active, powerScale: sim.powerScale },
      entry: null,
    });

    // The lab's `runCastleChain`, stage by stage
    const level = party.heroes.reduce((s, h) => s + h.level, 0) / party.heroes.length;
    const ids = castleStageEnemies(TIER, stage);
    const labEnemies = createEnemyUnits(ids, generateEnemyPositions(ids.length), level, castleStagePower(TIER, stage))
      .map((u) => ({ ...u, stats: { ...u.stats, maxHp: castleEnemyHp(u.stats.maxHp) } }));

    expect(built.plan.enemies).toEqual(ids);
    expect(built.partyLevel).toBe(level);
    expect(built.powerScale).toBe(castleStagePower(TIER, stage));
    // Aethelred's own fight takes his health down the same way (`runEmperor` with `castleHp`)
    expect(built.enemies.map((u) => [u.templateId, u.stats])).toEqual(labEnemies.map((u) => [u.templateId, u.stats]));
    expect(built.players.map((u) => u.heroId)).toEqual(heroes.map((h) => h.id));
  });

  it('carries the party into the next stage by the lab\'s rule, and with no XP', () => {
    const { heroes } = launch();
    const encounterId = castleEncounterId(TIER, 0);
    useGameStore.setState({ currentEncounterId: encounterId, encounterEntry: null });
    const built = buildEncounter({
      encounterId,
      terms: termsFor(encounterId),
      heroes,
      castleRun: castleRunFromId(encounterId),
      sim: { active: true, powerScale: 3 },
      entry: null,
    });
    const units = built.players.map((u) => ({ ...u, currentHp: Math.round(u.stats.maxHp / 3), currentMana: 0 }));
    useCombatStore.getState().initCombat(units, built.enemies, 0);
    const levels = heroes.map((h) => [h.level, h.xp]);
    const reward: CombatReward = {
      kind: 'combat', xpPerHero: 1_000_000, gold: 0, items: [], gems: [], resources: [],
      nextStage: { name: castleStageName(CASTLE_STAGES[1]), blurb: '', healed: 0 },
    };

    const outcome = applyVictory(reward, { units, encounterId, castleRun: castleRunFromId(encounterId), guardsChest: false });

    expect(outcome?.levelUps).toEqual([]);
    const after = usePartyStore.getState().heroes;
    expect(after.map((h) => [h.level, h.xp])).toEqual(levels);
    for (const unit of units) {
      const carry = castleStageCarry(unit);
      const hero = after.find((h) => h.id === unit.heroId)!;
      expect([hero.currentHp, hero.currentMana]).toEqual([carry.hp, carry.mana]);
    }
    // The harness's log marks the stage, as the lab's chain transcript does
    expect(useSimStore.getState().battleLog).toContain(`=== ${castleStageName(CASTLE_STAGES[1])} ===`);
  });
});
