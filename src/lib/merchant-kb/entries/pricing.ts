import { app, faq } from '../helpers';
export const pricing = [
  faq('pricing.format', 'pricing', 'live',
    ['What currency do I use for prices?', 'How do I write the price?', 'Can I leave the price empty?', 'Ask seller price'],
    'Enter the price as a number, for example 85000. If you leave the price empty, customers see "Ask seller".',
    { action: app(), src: 'webhook route.ts (price === null -> Ask seller)' }),
  faq('pricing.momo', 'pricing', 'partial',
    ['Can I add my mobile money code?', 'Add my MoMo merchant code', 'Show payment details on my shop', 'Which payment methods can I show customers?'],
    'You can add a mobile money merchant code and network to your shop profile. Mudaala connects shoppers to you but does not collect or confirm payments.',
    { action: app(), src: 'src/lib/validation.ts momoMerchantCode; docs/TELEGRAM_COMMERCE_ASSISTANT_IMPLEMENTATION.md (not a bank)', note: 'Always confirm payment yourself before handing over goods.' }),
  faq('pricing.negotiable', 'pricing', 'unverified',
    ['Can customers negotiate the price?', 'Mark a price as negotiable', 'How do I set a discount?'],
    'Pricing options depend on what Mudaala supports.', { src: 'none', needs: 'Confirm whether negotiable/discount fields exist' }),
  faq('pricing.fees', 'pricing', 'unverified',
    ['Do I pay to use Mudaala?', 'How much does it cost to sell on Mudaala?', 'Are there fees?', 'Is Mudaala free?'],
    'Fees must be confirmed by the Mudaala team.', { src: 'none', needs: 'Confirmed pricing policy from owner. Never guess.' }),
];
