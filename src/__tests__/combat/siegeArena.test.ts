import { compositionKeyFor, environmentFor, sceneryFor } from '@/systems/combat/encounterContext';
import { openCountry } from '@/data/display/terrainDisplay';
import { locationContext } from '@/locations';
import { EncounterContext, TileType } from '@/models/types';
import { siegeContext, siegeEncounterId } from '@/systems/world/tribute';
import { refuseCurrentTribute } from '@/systems/world/tributeCollection';
import { useCalendarStore } from '@/stores/calendarStore';
import { useEmpireStore } from '@/stores/empireStore';
import { useGameStore } from '@/stores/gameStore';
import { useLocationStore } from '@/stores/locationStore';

/** The sacking of the city is fought in its streets, under the sky. */
describe('the siege arena', () => {
  const indoors = ['castle', 'lair_warren', 'lair_barrow', 'lair_wyrm'] as const;
  const isInterior = (context: EncounterContext) =>
    sceneryFor(context).propKeys.some((key) => key.startsWith('dungeon_'));

  it('is the city, looked up under its own name', () => {
    const context = siegeContext();
    expect(context.kind).toBe('location');
    expect(compositionKeyFor(context)).toBe('city');
  });

  it('is fought outdoors: not lit or dressed as an interior', () => {
    const context = siegeContext();
    expect(openCountry(context)).not.toBeNull();
    expect(environmentFor(context)).not.toBe('interior');
    expect(isInterior(context)).toBe(false);
    expect(sceneryFor(context).backdrop).toBe(openCountry(context));
  });

  it('is lit at dusk with the town burning, and nothing else is', () => {
    expect(environmentFor(siegeContext())).toBe('siege');
    const others: EncounterContext[] = [
      ...indoors.map((id) => locationContext(id)),
      ...Object.values(TileType).flatMap((terrain) => [false, true].map(
        (danger): EncounterContext => ({ kind: 'world', terrain, danger, threat: 1 }))),
    ];
    for (const context of others) expect(environmentFor(context)).not.toBe('siege');
  });

  it('leaves the castle and every lair under a roof', () => {
    for (const id of indoors) {
      const context = locationContext(id);
      expect(openCountry(context)).toBeNull();
      expect(environmentFor(context)).toBe('interior');
      expect(isInterior(context)).toBe(true);
      expect(sceneryFor(context).backdrop).toBeNull();
      expect(compositionKeyFor(context)).toBe(id);
    }
  });

  it('leaves world fights on their own ground', () => {
    for (const terrain of Object.values(TileType)) {
      for (const danger of [false, true]) {
        const context: EncounterContext = { kind: 'world', terrain, danger, threat: 1 };
        expect(openCountry(context)).toBe(terrain);
        expect(sceneryFor(context).backdrop).toBe(terrain);
        expect(environmentFor(context)).toBe(danger ? 'haunted' : 'daylight');
        expect(isInterior(context)).toBe(false);
        expect(compositionKeyFor(context)).toBe(sceneryFor(context).surfaceKey);
      }
    }
  });

  it('is where refusing the tribute sends the party', () => {
    useCalendarStore.getState().loadClock(14 * 24);
    useEmpireStore.getState().reset();
    useLocationStore.getState().leave();
    const week = useCalendarStore.getState().weekNumber;
    expect(refuseCurrentTribute(week)).toBe(true);
    const game = useGameStore.getState();
    expect(game.currentEncounterId).toBe(siegeEncounterId(week));
    expect(game.currentEncounterContext).toEqual(siegeContext());
    expect(useEmpireStore.getState().lastSettledWeek).toBe(week);
  });
});
