import * as fs from 'fs';
import * as path from 'path';
import { BALANCE } from '@/data/balanceConstants';
import { t } from '@/i18n';
import { STARTER_KIT, itemTemplates } from '@/data/items/itemTemplates';
import { Item, Rarity } from '@/models/types';
import { issuedItem, mintItem } from '@/systems/economy/itemFactory';
import {
  gemFocusText, gemRewardLine, gemSetPreview, gemStateText, maxSocketsFor, mergeBenchText, openSocketsFirst,
  socketRuleText, socketSpace, withGemSet,
} from '@/systems/economy/gemGuide';
import { effectiveModifiers } from '@/systems/progression/itemStats';

/**
 * Where a loose gem goes, as the reward, the bag and the Forge's merging bench
 * say it. The rules pinned: the starter kit never has a socket, so the bag says
 * when nothing carried can take a gem; gems are set and taken out in the bag,
 * and the Forge only merges; the reward, the bag and the bench each keep one
 * short line and send the rules to the Handbook's gems page.
 */

const template = (rarity: Rarity) => itemTemplates.find((item) => item.rarity === rarity)!;
const withSockets = (rarity: Rarity, sockets: Item['sockets'], id?: string): Item => ({
  ...mintItem(template(rarity), () => 0.5), sockets, ...(id ? { id } : {}),
});
const ROOT = path.resolve(__dirname, '../../..');
const source = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('a gem with nowhere to go', () => {
  const kit = Object.values(STARTER_KIT).flat().map((id) => issuedItem(id, 1)!);

  it('no starter kit piece has a socket, so the kit alone gives a gem nowhere to go', () => {
    expect(kit.length).toBeGreaterThan(0);
    for (const item of kit) expect(item.sockets).toEqual([]);
    expect(socketSpace(kit)).toEqual({ socketed: 0, open: [] });
  });

  it('the bag says nothing carried takes one, in one line', () => {
    expect(gemStateText(socketSpace(kit))).toBe('No sockets on carried gear.');
  });

  it('names which gear can have sockets, read from the socket weights', () => {
    const rule = socketRuleText();
    expect(maxSocketsFor(Rarity.Common)).toBe(0);
    expect(rule).toMatch(/Common gear, the starter kit included, has no sockets/);
    for (const rarity of [Rarity.Rare, Rarity.Epic, Rarity.Legendary]) {
      const most = maxSocketsFor(rarity);
      expect(BALANCE.GEM_SOCKET_WEIGHTS[rarity][most]).toBeGreaterThan(0);
      expect(BALANCE.GEM_SOCKET_WEIGHTS[rarity].slice(most + 1).every((w) => w === 0)).toBe(true);
      const name = rarity[0].toUpperCase() + rarity.slice(1);
      expect(rule).toContain(name);
    }
  });
});

describe('a gem with a socket to fill', () => {
  it('counts the pieces, not the sockets, when several are open', () => {
    const two = withSockets(Rarity.Epic, [null, null]);
    const one = withSockets(Rarity.Rare, [null]);
    expect(socketSpace([two, one]).open).toHaveLength(3);
    expect(gemStateText(socketSpace([two, one]))).toBe('2 pieces you carry have an empty socket.');
  });

  it('the bag offers an open socket first, and its one state line counts the pieces', () => {
    const full = withSockets(Rarity.Epic, ['ruby_cut', 'jade_cut'], 'full-helm');
    const half = withSockets(Rarity.Epic, ['ruby_cut', null], 'half-plate');
    expect(openSocketsFirst([full, half]).map((i) => i.id)).toEqual(['half-plate', 'full-helm']);
    expect(gemStateText(socketSpace([full, half]))).toBe('1 piece you carry has an empty socket.');
    expect(gemStateText(socketSpace([half, withSockets(Rarity.Rare, [null])]))).toBe('2 pieces you carry have an empty socket.');
  });

  it('with every socket filled, says so', () => {
    const full = withSockets(Rarity.Rare, ['amber_cut']);
    expect(gemStateText(socketSpace([full]))).toBe('Every socket you carry is filled.');
  });

  it('the gem bench says what it makes, that gems are set free from the bag, and come back out only here', () => {
    expect(mergeBenchText()).toBe(`${BALANCE.GEM_CUT_INPUT} cut gems of a kind make one brilliant. Gems are set, free, from the bag; they come back out only here.`);
    // Once Jadeveil is open the bench also merges brilliants into Spirit gems
    expect(mergeBenchText(true)).toContain('brilliant into Spirit');
  });
});

describe('what the focused gem will give', () => {
  it('previews the stat a gem moves in the first empty socket, through the effective modifiers', () => {
    const half = withSockets(Rarity.Epic, ['ruby_cut', null]);
    const before = effectiveModifiers(half).attack ?? 0;
    const preview = gemSetPreview(half, 'ruby_brilliant')!;
    expect(preview).toEqual({
      stat: 'attack', label: 'Attack', before, after: before + BALANCE.GEM_BONUS.brilliant.ruby,
    });
    expect(withGemSet(half, 'ruby_brilliant')!.sockets).toEqual(['ruby_cut', 'ruby_brilliant']);
  });

  it('names HP by the card’s word and counts from zero for a stat the piece lacks', () => {
    const piece = { ...withSockets(Rarity.Rare, [null]), modifiers: { attack: 4 } };
    const preview = gemSetPreview(piece, 'jade_cut')!;
    expect(preview.label).toBe('HP');
    expect(preview.after - preview.before).toBe(BALANCE.GEM_BONUS.cut.jade);
  });

  it('draws no preview for a press that would be refused', () => {
    expect(gemSetPreview(withSockets(Rarity.Rare, ['amber_cut']), 'ruby_cut')).toBeNull();
    expect(gemSetPreview(withSockets(Rarity.Rare, []), 'ruby_cut')).toBeNull();
    expect(withGemSet(withSockets(Rarity.Epic, ['ruby_cut', null]), 'jade_cut', 0)).toBeNull();
  });
});
