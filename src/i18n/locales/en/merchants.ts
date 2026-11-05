/**
 * `merchants` — the travelling merchants: their three kinds (`<kind>.title`,
 * `<kind>.line`), the meeting toast and the trade panel's lines. Read through
 * `data/merchants.ts` and `components/worldmap/MerchantCounter.tsx`.
 */
export const merchants = {
  'armourer.title': 'Travelling armourer',
  'armourer.line': 'Epic weapons and armor, hauled from forge to forge.',
  'curio.title': 'Curio dealer',
  'curio.line': 'Gear from other lands and other hands.',
  'provisioner.title': 'Provisioner',
  'provisioner.line': 'Incense and trail rations for the road.',

  'subtitle': 'Leaves in {left}',

  'tab.buy': 'Buy',
  'tab.sell': 'Sell',
  'empty': 'Nothing on the cart this week.',
  'bought': 'Bought {item}',
  'sellNote': 'Merchants buy loot at {percent}% of what the city Shop pays.',
  'ward.title': 'Warding incense',
  'ward.line': 'A stick for the road, cheaper than in the city.',
  'ward.toast': 'Warding incense packed.',
  'bundle.title': 'Ration bundle',
  'bundle.line': '{count} trail rations, packed together.',
  'bundle.toast': 'Rations packed.',
  'bundle.full': 'The pack cannot carry that many rations.',
} as const;
