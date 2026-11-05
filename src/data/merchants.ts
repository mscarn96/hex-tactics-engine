import { entryText } from '@/i18n/dataText';

/**
 * Travelling merchants: three kinds, each selling a narrow part of one shared
 * pool (`systems/economy/merchantStock.ts`), each drawn as a figure with its own
 * pack animal or cart (`voxel/models/merchants.ts`). Names and lines live in the
 * `merchants` catalog, keyed by kind. Design: the private project notes,
 * section 3.
 */
export const MERCHANT_KINDS = ['armourer', 'curio', 'provisioner'] as const;
export type MerchantKind = (typeof MERCHANT_KINDS)[number];

export const merchantTitle = (kind: MerchantKind): string => entryText('merchants', kind, 'title');
export const merchantLine = (kind: MerchantKind): string => entryText('merchants', kind, 'line');
