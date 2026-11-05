import { HERO_NAMES, HERO_NAME_MAX_LENGTH, cleanHeroName, randomHeroName } from '@/data/heroNames';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { heroLabel } from '@/data/display/heroDisplay';
import { HeroClass } from '@/models/types';
import { templateName } from '@/data/templates/unitText';

/**
 * Heroes are named (playtest 2026-10-14): a proposal from the class's own list,
 * rerolled or typed over, at the first choice and at the tavern.
 */
describe('hero names', () => {
  it('has a list for every class, unique, each short enough for the active-unit card', () => {
    for (const t of heroTemplates) {
      const names = HERO_NAMES[t.id];
      expect(names.length).toBeGreaterThanOrEqual(12);
      expect(new Set(names).size).toBe(names.length);
      expect(names.filter((n) => n.length > HERO_NAME_MAX_LENGTH)).toEqual([]);
      // A hero is never proposed under their class's name
      expect(names).not.toContain(templateName(t.id));
    }
  });

  it('never proposes a name already in the party, nor the one being rerolled away from', () => {
    const taken = HERO_NAMES.warrior.slice(0, 10);
    for (let i = 0; i < 50; i++) {
      const name = randomHeroName('warrior', taken, 'Osric', () => i / 50);
      expect(taken).not.toContain(name);
      expect(name).not.toBe('Osric');
    }
  });

  it('still proposes something when the party holds every name', () => {
    expect(HERO_NAMES.mage).toContain(randomHeroName('mage', [...HERO_NAMES.mage]));
  });

  it('cleans what is typed: trimmed, spaces collapsed, cut to the limit', () => {
    expect(cleanHeroName('  Ser   Bartholomew  ')).toBe('Ser Bartholo');
    expect(cleanHeroName('   ')).toBe('');
    expect(cleanHeroName('Rowena').length).toBeLessThanOrEqual(HERO_NAME_MAX_LENGTH);
  });
});

describe('a hero on one line', () => {
  const base = { heroClass: HeroClass.Warrior, templateId: 'warrior' as const, masteryPath: null };
  it('pairs a name with the class, then the path', () => {
    expect(heroLabel({ ...base, name: 'Rowena' })).toBe('Rowena · Champion');
    expect(heroLabel({ ...base, name: 'Rowena', masteryPath: 'bulwark' })).toBe('Rowena · Bulwark');
  });
  it('says the class once for a hero who was never named', () => {
    expect(heroLabel({ ...base, name: 'Champion' })).toBe('Champion');
  });
});
