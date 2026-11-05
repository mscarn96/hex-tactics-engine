import { canEquip } from '@/systems/progression/equipRules';
import { basicAttackWith, weaponAttackId } from '@/systems/combat/basicAttack';
import { WEAPON_ATTACKS } from '@/data/items/weaponAttacks';
import { itemTemplates } from '@/data/items/itemTemplates';
import { itemFromTemplate } from '@/systems/economy/itemFactory';
import { rollRandomItem } from '@/systems/economy/lootGenerator';
import { forgeableMotifs } from '@/systems/economy/forge';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { createRNG } from '@/utils/rng';
import { FormId, Hero, HeroClass, Item, MasteryId, Rarity } from '@/models/types';

/**
 * The five held forms the item epic added: a flanged mace for the Champion, a
 * sickle for the Druid, a lantern focus for the Arcanist, a sabre for the
 * Shadowblade and a throwing axe for the Skirmisher.
 *
 * Each one is a vocabulary change for exactly one class or path, and the rule
 * worth pinning is *who else may not*: a sabre that a Marksman could hold, or a
 * throwing axe on the Shadowblade, would undo the per-path lock the Hunter's
 * weapons were built around.
 */

function hero(heroClass: HeroClass, masteryPath: MasteryId | null = null) {
  return { heroClass, masteryPath } as Pick<Hero, 'heroClass' | 'masteryPath'>;
}

function item(templateId: string): Item {
  const t = itemTemplates.find((x) => x.id === templateId);
  if (!t) throw new Error(`no template ${templateId}`);
  return { ...itemFromTemplate(t), id: `inst_${templateId}` };
}

const PATHS = MASTERY_PATHS.map((p) => ({ id: p.id as MasteryId, heroClass: p.heroClass }));

/** Which paths may hold `form` in the main hand. */
function holders(form: FormId): string[] {
  const it = item(`${form}_iron`);
  return PATHS.filter((p) => canEquip(hero(p.heroClass, p.id), it, 'mainHand', {}).ok).map((p) => p.id).sort();
}

describe('who may hold the new weapons', () => {
  it('gives the flanged mace to the two Champion paths that carry a shield', () => {
    expect(holders('flanged_mace')).toEqual(['bulwark', 'templar']);
    expect(canEquip(hero(HeroClass.Warrior), item('flanged_mace_iron'), 'mainHand', {}).ok).toBe(true);
  });

  it('gives the sickle to every Druid and to nobody else', () => {
    expect(holders('sickle')).toEqual(['lifewarden', 'stoneshaper', 'wildshape']);
    expect(canEquip(hero(HeroClass.Healer), item('sickle_iron'), 'mainHand', {}).ok).toBe(true);
  });

  it('gives each Hunter path only the new weapon meant for it', () => {
    expect(holders('sabre')).toEqual(['shadowblade']);
    expect(holders('throwing_axe')).toEqual(['skirmisher']);
    // The Marksman keeps its two shooters and gains neither
    const marksman = hero(HeroClass.Ranger, 'marksman');
    expect(canEquip(marksman, item('sabre_iron'), 'mainHand', {}).ok).toBe(false);
    expect(canEquip(marksman, item('throwing_axe_iron'), 'mainHand', {}).ok).toBe(false);
  });

  it('keeps the Shadowblade melee-only, and lets it pair a sabre with a dagger', () => {
    const shadowblade = hero(HeroClass.Ranger, 'shadowblade');
    const offenders = itemTemplates
      .filter((t) => t.slot === 'mainHand' && !t.masteryLock)
      .filter((t) => canEquip(shadowblade, { ...itemFromTemplate(t), id: t.id }, 'mainHand', {}).ok)
      .filter((t) => WEAPON_ATTACKS[weaponAttackId(t)].range > 1)
      .map((t) => t.id);
    expect(offenders).toEqual([]);
    expect(canEquip(shadowblade, item('sabre_iron'), 'offHand', { mainHand: item('dagger_iron') }).ok).toBe(true);
  });

  // An Arcanist focus, which the Firefly shares (`monkWeapons.test.ts`)
  // The Monk takes it up with the Firefly path, not before
  // (the private project notes, "Equipment rules")
  it('fits the lantern in an Arcanist’s or a Firefly’s off-hand and no one else’s', () => {
    const lantern = item('lantern_iron');
    for (const c of Object.values(HeroClass)) {
      const ok = c === HeroClass.Mage;
      expect({ c, ok: canEquip(hero(c), lantern, 'offHand', {}).ok }).toEqual({ c, ok });
    }
    expect(canEquip(hero(HeroClass.Monk, 'firefly'), lantern, 'offHand', {}).ok).toBe(true);
    for (const p of PATHS.filter((x) => x.heroClass === HeroClass.Mage)) {
      expect({ p: p.id, ok: canEquip(hero(p.heroClass, p.id), lantern, 'offHand', {}).ok }).toEqual({ p: p.id, ok: true });
    }
  });
});

describe('the Basic Attack each new weapon makes', () => {
  it('strikes physically in melee with the mace, the sickle and the sabre', () => {
    for (const form of ['flanged_mace', 'sickle', 'sabre'] as FormId[]) {
      const profile = WEAPON_ATTACKS[weaponAttackId(item(`${form}_iron`))];
      expect({ form, style: profile.style, range: profile.range, scaling: profile.scaling })
        .toEqual({ form, style: 'melee', range: 1, scaling: 'attack' });
    }
  });

  it('throws the throwing axe at the thrown reach', () => {
    expect(weaponAttackId(item('throwing_axe_iron'))).toBe('thrown');
    expect(basicAttackWith(item('throwing_axe_iron')).range).toBe(WEAPON_ATTACKS.thrown.range);
  });
});

describe('the new forms can be found and made', () => {
  it('appears in ordinary drops', () => {
    const r = createRNG(3);
    const rng = () => r.next();
    const seen = new Set<FormId>();
    for (let i = 0; i < 20000 && seen.size < 5; i++) {
      const it = rollRandomItem(Rarity.Rare, { rng });
      if (it && ['flanged_mace', 'sickle', 'lantern', 'sabre', 'throwing_axe'].includes(it.form)) seen.add(it.form);
    }
    expect([...seen].sort()).toEqual(['flanged_mace', 'lantern', 'sabre', 'sickle', 'throwing_axe']);
  });

  it('is on the forge’s list', () => {
    for (const form of ['flanged_mace', 'sickle', 'lantern', 'sabre', 'throwing_axe'] as FormId[]) {
      expect({ form, motifs: forgeableMotifs(form, 3, []).length > 0 }).toEqual({ form, motifs: true });
    }
  });
});
