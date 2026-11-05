import { LAIR_SPECS } from '@/locations/lairs';
import { objectiveLabel } from '@/systems/quests/objectiveLabel';
import {
  factionsFielding, fieldedByOneFaction, huntGround, huntHint, isHuntGround,
} from '@/systems/quests/questHints';
import { bandsFielding } from '@/systems/world/encounterShapes';
import { QUESTS } from '@/quests/questData';
import { FACTIONS } from '@/data/templates/factions';
import { threatBandName } from '@/data/worlds';
import { Objective, QuestId } from '@/quests/types';
import { EnemyTemplateId, MapTile, POIType, ResourceType, TileType } from '@/models/types';

/**
 * "Kill five wolves" is a search, not a task.
 *
 * The map is 4,900 tiles and a quest naming an enemy said nothing about where
 * that enemy lives. A playtest lost four in-game weeks to the wolf quest, which
 * is what `questHunt` answered on the supply side by weighting the roll — this
 * is the other half, and the reason it is derived rather than written is that a
 * hint and a roster are two statements of the same fact. Only one of them is
 * obeyed by the encounter generator, so the other has to be computed from it or
 * it is a lie waiting for the next retune.
 */

const killObjectives = (): { quest: QuestId; objective: Objective }[] =>
  (Object.keys(QUESTS) as QuestId[]).flatMap((quest) =>
    QUESTS[quest].stages.flatMap((stage) =>
      stage.objectives
        .filter((objective) => objective.kind === 'kill')
        .map((objective) => ({ quest, objective })),
    ),
  );

/**
 * The targets no faction fields, and the ones that need no hint.
 *
 * The rule, rather than the list: **a target at a fixed address is not a
 * search.** A hint answers "where does this thing live", and these do not live
 * anywhere — each stands on exactly one authored hex behind a door that the
 * quest naming it already points the guide arrow at.
 *
 * Aethelred is not on any roster; `wildTemplates` excludes him precisely so the
 * map's boss tiles cannot deal the emperor onto an ordinary lair, and he is at
 * the end of the castle gauntlet. "Look for him in Legion Ground, in the
 * mountains" would be advice about a search that does not exist.
 *
 * The three lair bosses are the same case one tier down. They are named by
 * `LairSpec.boss` and appear nowhere in `FACTIONS`, so no wandering encounter
 * can ever field one — and each lair quest opens with a `reach` at its lair id,
 * which resolves to the door's own `POIType.BossTile`. The arrow is on the
 * address for the whole quest; a sentence about haunted forest would send the
 * player hunting for something that provably is not out there.
 *
 * Named rather than skipped by a `null` check, so a quest that starts naming an
 * enemy nothing fields still fails this — which is the same broken-counter
 * failure `quests.test.ts` guards from the other side.
 */
// Every lair's boss waits behind its door, the Emperor in his castle and Kairen on his summit
const NO_HUNT_NEEDED = ['aethelred', 'kairen', ...LAIR_SPECS.map((s) => s.boss)];

/** Kill objectives that describe an actual search of the map. */
const huntable = () =>
  killObjectives().filter(
    ({ objective }) =>
      objective.kind === 'kill' &&
      !objective.templates.every((t) => NO_HUNT_NEEDED.includes(t)),
  );

describe('hunt hints', () => {
  it('gives every huntable kill objective somewhere to look', () => {
    const silent = huntable()
      .filter(({ objective }) => huntHint(objective) === null)
      .map(({ quest, objective }) => `${quest}: ${objectiveLabel(objective)}`);
    expect(silent).toEqual([]);
  });

  it('says nothing about a target that is at a fixed address', () => {
    const chatty = killObjectives()
      .filter(
        ({ objective }) =>
          objective.kind === 'kill' &&
          objective.templates.every((t) => NO_HUNT_NEEDED.includes(t)) &&
          huntHint(objective) !== null,
      )
      .map(({ quest }) => quest);
    expect(chatty).toEqual([]);
  });

  /**
   * A hint on anything else would be invented. `collect` reads the bag, `talk`
   * and `reach` already name a place through `NpcDef.where` and the guide arrow,
   * and `clearPoi` points at a marker the player can see.
   */
  it('says nothing about objectives that are not a hunt', () => {
    const others: Objective[] = [
      { kind: 'collect', resource: ResourceType.Crystal, count: 8 },
      { kind: 'talk', npc: 'huntsman' },
      { kind: 'reach', location: 'city' },
      { kind: 'clearPoi', poi: POIType.MagicWell, count: 1 },
    ];
    for (const objective of others) expect(huntHint(objective)).toBeNull();
  });

  /**
   * The rule that makes this worth having at all: the hint is a *consequence* of
   * the roster, so retuning a faction's window moves the hint with it. Checked
   * by re-deriving the band range and demanding the sentence name it — if the
   * two ever come apart, the hint is sending the player somewhere the enemy
   * provably is not.
   *
   * **Re-derived through `bandsFielding`, not through `Faction.threatRange`.**
   * This test used to read the range directly, which is why it was fully green
   * while the Goblin Tithe pointed at Home Reach: it was re-deriving the bug.
   * The range says where a faction *goes*; the shape table says which of its
   * members go there, and the second one is what the composer obeys.
   */
  it('names the bands the roster actually fields the target in', () => {
    const offenders: string[] = [];

    for (const { quest, objective } of huntable()) {
      if (objective.kind !== 'kill') continue;
      const hint = huntHint(objective)!;
      const wanted = new Set<string>(objective.templates);
      const bands = factionsFielding(objective.templates)
        .flatMap((f) => bandsFielding(f, wanted));
      const low = Math.min(...bands);
      const high = Math.max(...bands);

      if (!hint.includes(threatBandName('empire', low))) {
        offenders.push(`${quest}: missing low band ${threatBandName('empire', low)} — "${hint}"`);
      }
      if (!hint.includes(threatBandName('empire', high))) {
        offenders.push(`${quest}: missing high band ${threatBandName('empire', high)} — "${hint}"`);
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * The failure this whole derivation exists for, named rather than left to the
   * sweep above.
   *
   * The Goblin Tithe's second stage asks for two Orc Grunts. Greenskins run
   * bands 0–2, so reading `threatRange` reported Home Reach — but band 0 has one
   * shape, `pack`, which is two `chaff`, and Greenskin chaff is the Goblin Whelp
   * alone. There is no arrangement of band 0 that contains an Orc Grunt.
   *
   * Written against the *roster* rather than against the literal string "Home
   * Reach", so renaming the bands (`world.empire.threat.<band>`) or moving the Grunt between roles keeps
   * the test meaningful instead of merely passing.
   */
  it('does not offer a band the quarry cannot be arranged into', () => {
    const greenskins = FACTIONS.find((f) => f.id === 'greenskins')!;
    expect(greenskins.threatRange[0]).toBe(0);
    expect(greenskins.roles.chaff).not.toContain('orc_grunt');

    const grunts: Objective = {
      kind: 'kill', templates: ['orc_grunt'], count: 2,
    };
    const ground = huntGround(grunts)!;

    expect(ground.bands[0]).toBe(1);
    expect(huntHint(grunts)).not.toContain(threatBandName('empire', 0));
    expect(isHuntGround(
      { type: TileType.Plains, zone: 'haunted', threat: 0 },
      ground,
    )).toBe(false);
  });

  /**
   * A role that only ever appears deep in a faction's range takes the whole hint
   * with it.
   *
   * The Brigand Captain is `elite`, and `threatEliteCount` puts the first elite
   * slot at band 2 — so a faction running bands 0–2 delivers its captain in
   * exactly one of them. This is the same fault as the orcs at its extreme, and
   * it is the case that proves the derivation is reading the shape table rather
   * than merely clipping the bottom off a range.
   */
  it('narrows to a single band when only one arrangement fields the target', () => {
    const brigands = FACTIONS.find((f) => f.id === 'brigands')!;
    expect(brigands.threatRange).toEqual([0, 2]);
    expect(brigands.roles.elite).toContain('brigand_captain');

    const ground = huntGround({
      kind: 'kill', templates: ['brigand_captain'], count: 1,
    })!;
    expect(ground.bands).toEqual([2, 2]);
  });

  /**
   * The precondition the single terrain list and single band window rest on.
   *
   * `huntGround` unions terrain across contributors and unions bands across
   * them, which is only honest while one faction answers the whole objective. A
   * forest faction at bands 0–2 and a swamp faction at bands 2–4 would paint the
   * cross-product: forest at band 4, swamp at band 0. No authored objective does
   * that today, and this is what keeps it that way — the day one does, this
   * fails and `HuntGround` grows a region per faction rather than the map
   * quietly lying.
   */
  it('is answered by a single faction, which is what lets the window be one window', () => {
    const spread = killObjectives()
      .filter(({ objective }) => !fieldedByOneFaction(objective))
      .map(({ quest, objective }) => `${quest}: ${objectiveLabel(objective)}`);
    expect(spread).toEqual([]);
  });

  describe('factionsFielding', () => {
    it('finds every faction holding the template, not just the first', () => {
      // `wolf` is Beasts' alone; picking a template two factions share would
      // make this pass without distinguishing "all" from "any"
      const beasts = FACTIONS.find((f) => f.id === 'beasts')!;
      expect(factionsFielding(['wolf'])).toEqual([beasts]);
      expect(factionsFielding(['wolf', 'goblin']).length).toBeGreaterThan(1);
    });

    it('returns nothing for a template the game does not field', () => {
      expect(factionsFielding(['not_a_real_enemy'])).toEqual([]);
    });
  });

  it('names real terrain for a terrain-bound faction', () => {
    const hint = huntHint({ kind: 'kill', templates: ['wolf'], count: 1 })!;
    const beasts = FACTIONS.find((f) => f.id === 'beasts')!;
    expect(beasts.terrain).toContain(TileType.Forest);
    expect(hint).toContain('forest');
  });

  /**
   * The map paints the same country the sentence describes, and the only thing
   * that guarantees it is that both come out of `huntGround`.
   *
   * A highlight derived on its own would be a *third* statement of where an
   * enemy lives — the roster, the words, and the paint — and this module exists
   * because the second one drifts away from the first. Measured as an identity
   * rather than as "both mention forests": an approximate agreement is a slow
   * divergence with no failing test, which is the failure mode already on record
   * for the commuting threat multipliers.
   */
  describe('huntGround', () => {
    it('is what the sentence is phrased from', () => {
      const offenders: string[] = [];

      for (const { quest, objective } of huntable()) {
        if (objective.kind !== 'kill') continue;
        const ground = huntGround(objective);
        if (!ground) {
          offenders.push(`${quest}: no ground for a huntable objective`);
          continue;
        }
        const hint = huntHint(objective)!;

        for (const band of [ground.bands[0], ground.bands[1]]) {
          if (!hint.includes(threatBandName('empire', band))) {
            offenders.push(`${quest}: ground band ${band} missing from "${hint}"`);
          }
        }
        // Every terrain the ground names has to be a terrain some fielding
        // faction actually prefers, or the paint covers hexes the words do not.
        const fielded = new Set(
          factionsFielding(objective.templates).flatMap((f) => f.terrain),
        );
        for (const terrain of ground.terrain) {
          if (!fielded.has(terrain)) offenders.push(`${quest}: ${terrain} is nobody's ground`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it('refuses everything huntHint refuses, and for the same objectives', () => {
      const disagreements = killObjectives()
        .filter(({ objective }) => (huntGround(objective) === null) !== (huntHint(objective) === null))
        .map(({ quest }) => quest);
      expect(disagreements).toEqual([]);

      expect(huntGround({ kind: 'talk', npc: 'huntsman' })).toBeNull();
    });

    /**
     * An empty terrain list means *any* ground, not *no* ground — the map reads
     * it as "do not filter by terrain", so a caller treating it as an empty
     * allow-list would paint nothing at all for a roaming faction.
     */
    it('reports an unconstrained faction as an empty terrain list', () => {
      const roamer = FACTIONS.find((f) => f.terrain.length === 0);
      if (!roamer) return;
      const member = Object.values(roamer.roles).flat()[0];
      const ground = huntGround({ kind: 'kill', templates: [member], count: 1 })!;
      expect(ground.terrain).toEqual([]);
    });

    /**
     * The paint has to obey the same three rules the encounter generator does,
     * and the one it would be easiest to leave out is the one nothing on screen
     * states: **encounters only happen on haunted ground**. A highlight that
     * covered the corridor would send the player hunting along the safe route,
     * which is the exact opposite of how the map works.
     */
    describe('isHuntGround', () => {
      /**
       * The pack as the quest actually names it — pup, wolf and dire wolf.
       *
       * `['wolf']` alone would be the wrong fixture now and it used to be the
       * right one: `wolf` is Beasts' `front`, and band 0 offers only `pack`,
       * which is two `chaff`. So a lone `wolf` opens at band 1, and a fixture
       * standing on band 0 was testing ground the quarry is not on. The pup is
       * the chaff, so the real objective still reaches home ground.
       */
      const wolves = () =>
        huntGround({
          kind: 'kill',
          templates: ['wolf_pup', 'wolf', 'dire_wolf'],
          count: 1,
        })!;

      /**
       * Seated at the shallow end of the quarry's own window rather than at a
       * literal 0, so retuning which band first fields a wolf moves the fixture
       * with it instead of turning every case in here red at once.
       */
      const tile = (over: Partial<Pick<MapTile, 'type' | 'zone' | 'threat'>> = {}) => ({
        type: TileType.Forest,
        zone: 'haunted' as const,
        threat: wolves().bands[0],
        ...over,
      });

      it('accepts ground that matches on all three counts', () => {
        expect(isHuntGround(tile(), wolves())).toBe(true);
      });

      it('refuses anything that is not haunted', () => {
        const offenders = (['road', 'corridor'] as const).filter((zone) =>
          isHuntGround(tile({ zone }), wolves()),
        );
        expect(offenders).toEqual([]);
      });

      it('refuses terrain the quarry does not live on', () => {
        const beasts = FACTIONS.find((f) => f.id === 'beasts')!;
        expect(beasts.terrain).not.toContain(TileType.Desert);
        expect(isHuntGround(tile({ type: TileType.Desert }), wolves())).toBe(false);
      });

      it('refuses ground outside the band window', () => {
        const [, high] = wolves().bands;
        expect(isHuntGround(tile({ threat: high }), wolves())).toBe(true);
        expect(isHuntGround(tile({ threat: high + 1 }), wolves())).toBe(false);
      });

      /** An empty terrain list is "do not filter", not "match nothing". */
      it('takes any terrain when the ground names none', () => {
        const anywhere = { terrain: [], locked: false, frostOnly: false, bands: [0, 4] as [0, 4] };
        const refused = Object.values(TileType).filter(
          (type) => !isHuntGround(tile({ type }), anywhere),
        );
        expect(refused).toEqual([]);
      });

      /**
       * A tile generated without a band reads as band 0, not as unmatchable.
       *
       * Only meaningful against a quarry whose window reaches band 0, which the
       * full wolf pack's does through the pup. Asserted rather than assumed —
       * if the pack ever stops being fielded in the home ring this case is
       * measuring the wrong thing and should say so.
       */
      it('reads a missing threat as the home band', () => {
        expect(wolves().bands[0]).toBe(0);
        expect(isHuntGround({ type: TileType.Forest, zone: 'haunted' }, wolves())).toBe(true);
      });
    });

    /**
     * Synthetic — no authored objective spans two factions, and the test above
     * keeps it that way. Kept because the union is still the arithmetic the
     * function runs, and because it is the shape a region split would have to
     * preserve if one is ever needed.
     */
    it('unions the band window across every faction that can deliver the target', () => {
      const templates: EnemyTemplateId[] = ['wolf', 'goblin'];
      const wanted = new Set<string>(templates);
      const ground = huntGround({ kind: 'kill', templates, count: 1 })!;
      const factions = factionsFielding(templates);
      expect(factions.length).toBeGreaterThan(1);

      const bands = factions.flatMap((f) => bandsFielding(f, wanted));
      expect(ground.bands[0]).toBe(Math.min(...bands));
      expect(ground.bands[1]).toBe(Math.max(...bands));
    });

    /**
     * A faction that holds the template but can never arrange it contributes
     * nothing at all — not its bands, and not its terrain either.
     *
     * Dropping only the bands would be the subtler half of the same bug: the
     * paint would cover a terrain nothing walks on, for a quarry the faction
     * cannot field. Measured against a template whose only role arrives late, so
     * the faction is genuinely excluded from its own low bands.
     */
    it('drops a faction that cannot arrange the target at any band it visits', () => {
      const wanted = new Set(['brigand_captain']);
      const brigands = FACTIONS.find((f) => f.id === 'brigands')!;
      // Sanity: the captain is reachable somewhere, or this proves nothing
      expect(bandsFielding(brigands, wanted).length).toBeGreaterThan(0);

      // A faction that never fields it contributes no bands, so no terrain
      const beasts = FACTIONS.find((f) => f.id === 'beasts')!;
      expect(bandsFielding(beasts, wanted)).toEqual([]);

      const ground = huntGround({
        kind: 'kill', templates: ['brigand_captain'], count: 1,
      })!;
      for (const terrain of beasts.terrain) {
        if (brigands.terrain.includes(terrain)) continue;
        expect(ground.terrain).not.toContain(terrain);
      }
    });
  });
});
