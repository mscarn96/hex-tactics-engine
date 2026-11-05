import {
  canForge, forgeCost, forgeTemplate, forgeableMotifs, maxForgeRarity,
} from '@/systems/economy/forge';
import { FORMS, FORM_IDS } from '@/data/items/itemForms';
import { MOTIFS, MOTIF_RARITY } from '@/data/items/motifs';
import { Rarity, ResourceType } from '@/models/types';

const MAX_LEVEL = 3;

describe('forge level gating', () => {
  /**
   * The ceiling opens at the *bottom* of the scale, not the top.
   *
   * It used to read `>= 3 → Epic`, `>= 2 → Rare`, so levels 0 and 1 crafted the
   * identical tier and the forge's first upgrade cost 60 gold, 10 wood, 20 stone
   * and 10 iron for nothing a player could do. Every rung moves it now, and the
   * top rung buys the legendary bench instead — see `MASTERY_SET_FORGE_LEVEL`.
   */
  it('raises the rarity ceiling with each upgrade', () => {
    expect(maxForgeRarity(0)).toBe(Rarity.Common);
    expect(maxForgeRarity(1)).toBe(Rarity.Rare);
    expect(maxForgeRarity(2)).toBe(Rarity.Epic);
  });

  it('never reaches Legendary, however upgraded', () => {
    expect(maxForgeRarity(3)).toBe(Rarity.Epic);
    expect(maxForgeRarity(99)).toBe(Rarity.Epic);
  });

  it('refuses a motif above the level ceiling', () => {
    expect(canForge('long_sword', 'plain', 0)).toBe(true);
    expect(canForge('long_sword', 'steel', 0)).toBe(false);
    expect(canForge('long_sword', 'steel', 1)).toBe(true);
    expect(canForge('long_sword', 'fire', 1)).toBe(false);
    expect(canForge('long_sword', 'fire', 2)).toBe(true);
  });

  it('refuses a motif the form was never generated in', () => {
    // Plate armour is deliberately not made in shadow
    expect(FORMS.plate_chest.motifs).not.toContain('shadow');
    expect(canForge('plate_chest', 'shadow', MAX_LEVEL)).toBe(false);
  });

  it('offers only craftable motifs, and every one resolves to a real item', () => {
    for (const form of FORM_IDS) {
      for (const motif of forgeableMotifs(form, MAX_LEVEL)) {
        expect({ form, motif, found: !!forgeTemplate(form, motif) })
          .toEqual({ form, motif, found: true });
      }
    }
  });

  it('offers something at every level, so a level-1 forge is not useless', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const total = FORM_IDS.reduce((n, f) => n + forgeableMotifs(f, level).length, 0);
      expect({ level, hasOptions: total > 0 }).toEqual({ level, hasOptions: true });
    }
  });
});

describe('forge cost', () => {
  it('always charges gold plus one material', () => {
    for (const form of FORM_IDS) {
      for (const motif of FORMS[form].motifs) {
        const cost = forgeCost(form, motif);
        expect({ form, motif, entries: Object.keys(cost).length >= 2 })
          .toEqual({ form, motif, entries: true });
        expect(cost[ResourceType.Gold]).toBeGreaterThan(0);
      }
    }
  });

  it('scales with rarity, so a better item genuinely costs more', () => {
    const plain = forgeCost('long_sword', 'plain')[ResourceType.Gold]!;
    const steel = forgeCost('long_sword', 'steel')[ResourceType.Gold]!;
    const fire = forgeCost('long_sword', 'fire')[ResourceType.Gold]!;
    expect(steel).toBeGreaterThan(plain);
    expect(fire).toBeGreaterThan(steel);
  });

  it('scales with slot, so a cuirass costs more than a ring', () => {
    expect(forgeCost('plate_chest', 'iron')[ResourceType.Gold]!)
      .toBeGreaterThan(forgeCost('band', 'iron')[ResourceType.Gold]!);
  });

  // The crystal sink is what gives magic wells and rare nodes a purpose
  it('charges crystal for every elemental motif and for no other', () => {
    for (const form of FORM_IDS) {
      for (const motif of FORMS[form].motifs) {
        if (!MOTIFS[motif].elemental) continue;
        expect({ form, motif, crystal: (forgeCost(form, motif)[ResourceType.Crystal] ?? 0) > 0 })
          .toEqual({ form, motif, crystal: true });
      }
    }
    // A non-elemental metal form should need no crystal at all
    expect(forgeCost('long_sword', 'steel')[ResourceType.Crystal]).toBeUndefined();
  });

  it('costs more to forge than the item sells for, so crafting is not a money loop', () => {
    for (const form of FORM_IDS) {
      for (const motif of FORMS[form].motifs) {
        const template = forgeTemplate(form, motif)!;
        const gold = forgeCost(form, motif)[ResourceType.Gold]!;
        expect({ id: template.id, profitable: template.sellPrice >= gold })
          .toEqual({ id: template.id, profitable: false });
      }
    }
  });

  it('picks a material that suits the form', () => {
    expect(forgeCost('bow', 'plain')[ResourceType.Wood]).toBeGreaterThan(0);
    expect(forgeCost('long_sword', 'plain')[ResourceType.Iron]).toBeGreaterThan(0);
    expect(forgeCost('plate_chest', 'plain')[ResourceType.Stone]).toBeGreaterThan(0);
  });
});

describe('crafted items', () => {
  it('produces exactly the rarity the motif implies', () => {
    for (const form of FORM_IDS) {
      for (const motif of forgeableMotifs(form, MAX_LEVEL)) {
        const template = forgeTemplate(form, motif)!;
        expect({ id: template.id, rarity: template.rarity })
          .toEqual({ id: template.id, rarity: MOTIF_RARITY[motif] });
      }
    }
  });
});
