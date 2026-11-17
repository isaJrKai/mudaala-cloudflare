import { account } from './entries/account';
import { analytics } from './entries/analytics';
import { discovery } from './entries/discovery';
import { enquiries } from './entries/enquiries';
import { growth } from './entries/growth';
import { identity } from './entries/identity';
import { photos } from './entries/photos';
import { pricing } from './entries/pricing';
import { products } from './entries/products';
import { registration } from './entries/registration';
import { salesStock } from './entries/sales-stock';
import { shopSetup } from './entries/shop-setup';
import { createMatcher } from './matcher';
import type { FaqEntry, MatcherOptions } from './types';

export const ALL_ENTRIES: FaqEntry[] = [
  ...registration, ...shopSetup, ...products, ...photos, ...pricing, ...identity,
  ...discovery, ...analytics, ...enquiries, ...salesStock, ...growth, ...account,
];
export const merchantKb = (opts?: MatcherOptions) => createMatcher(ALL_ENTRIES, opts);
export { createMatcher, renderReply, gapReport } from './matcher';
export type * from './types';
