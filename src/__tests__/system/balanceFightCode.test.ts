import { simBossTemplates } from '@/systems/sim/simHarness';
import { useSimStore } from '@/stores/simStore';
import { defaultSpec } from '@/systems/sim/balance/encounters';
import { runBalanceFight } from '@/systems/sim/balance/fight';
import { CODED_BOSSES, decodeFightCode, encodeFightCode, encodeSetupCode, FIGHT_CODE_PREFIX } from '@/systems/sim/balance/fightCode';
import { rollParty } from '@/systems/sim/balance/partyRoll';
import { fightSeed, partyRng } from '@/systems/sim/balance/rng';
import { partyRecord } from '@/systems/sim/balance/record';

/**
 * The fight code that carries a lab fight into the game's tuning harness. What is pinned: the party comes
 * out of a code exactly as it went in (gear, item levels, builds), the boss and its scale are the lab's,
 * a damaged code says so instead of fielding something else, and the harness's battle log is written
 * only while the harness owns the session.
 */

const lab = (id: 'troll' | 'dragon' | 'heart') => {
  const spec = defaultSpec(id);
  const seed = fightSeed(11, 0, 2);
  const party = rollParty(spec, {}, partyRng(seed));
  return { party, record: runBalanceFight(spec, party, seed) };
};

describe('a fight code', () => {
  it.each(['troll', 'dragon', 'heart'] as const)('returns the %s party as it went in', (id) => {
    const { party, record } = lab(id);
    const decoded = decodeFightCode(encodeFightCode(record));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.setup.enc).toBe(id);
    if (decoded.setup.enc === 'castle') return;
    expect(decoded.setup.boss).toBe(CODED_BOSSES[id].boss);
    expect(decoded.setup.powerScale).toBeCloseTo(CODED_BOSSES[id].power(), 3);
    expect(partyRecord({ heroes: decoded.setup.heroes, budget: party.budget, levelSum: party.levelSum }).h).toEqual(partyRecord(party).h);
  });

  it('names a boss the harness has', () => {
    const bosses = simBossTemplates().map((t) => t.id);
    for (const { boss } of Object.values(CODED_BOSSES)) expect(bosses).toContain(boss);
  });

  it('fields the same heroes from the harness side as from the lab', () => {
    // The lab's code also carries the item budget it rolled, which only its statistics read
    const { record } = lab('dragon');
    const decoded = decodeFightCode(encodeFightCode(record));
    if (!decoded.ok) throw new Error(decoded.error);
    if (decoded.setup.enc === 'castle') throw new Error('not a boss fight');
    const again = decodeFightCode(encodeSetupCode('dragon', decoded.setup.heroes, decoded.setup.powerScale)!);
    if (!again.ok) throw new Error(again.error);
    // The lab's seed is a reference the harness has no use for, so its own code leaves it out
    const { seed: _seed, ...withoutSeed } = decoded.setup;
    expect(again.setup).toEqual(withoutSeed);
  });

  it('has none for a boss the lab does not fight (the castle chain is simCastleChain.test)', () => {
    expect(encodeSetupCode('aethelred', lab('troll').party.heroes, 1)).toBeNull();
  });

  it('survives being wrapped across lines and padded with spaces', () => {
    const code = encodeFightCode(lab('heart').record);
    const wrapped = `  ${code.slice(0, 40)}\n${code.slice(40)}  \n`;
    expect(decodeFightCode(wrapped).ok).toBe(true);
  });

  it('says so when it is wrong, cut short or not one', () => {
    const code = encodeFightCode(lab('troll').record);
    expect(decodeFightCode('hello').ok).toBe(false);
    expect(decodeFightCode(code.slice(0, code.length - 30)).ok).toBe(false);
    expect(decodeFightCode(`${FIGHT_CODE_PREFIX}!!!`).ok).toBe(false);
  });
});

describe('the harness battle log', () => {
  afterEach(() => useSimStore.setState({ active: false, battleLog: [], battleTurns: 0 }));

  it('is not written outside the harness', () => {
    const sim = useSimStore.getState();
    sim.startBattleLog(['header']);
    sim.logBattleLine('a blow');
    sim.logBattleTurn('Hunter', true);
    expect(useSimStore.getState().battleLog).toEqual(['header']);
  });

  it('writes the lab transcript shape while the harness owns the session', () => {
    useSimStore.setState({ active: true });
    const sim = useSimStore.getState();
    sim.startBattleLog(['header']);
    sim.logBattleTurn('Hunter', true);
    sim.logBattleLine('Hunter: Vanish');
    sim.logBattleTurn('Emerald Dragon', false);
    expect(useSimStore.getState().battleLog).toEqual(['header', '#1 Hunter (party)', '  Hunter: Vanish', '#2 Emerald Dragon (enemy)']);
  });

  it('is kept when the harness is left, so the setup screen can hand it over', () => {
    useSimStore.setState({ active: true });
    useSimStore.getState().startBattleLog(['header']);
    useSimStore.getState().logBattleLine('x');
    useSimStore.getState().exit();
    expect(useSimStore.getState().battleLog.length).toBe(2);
  });
});
