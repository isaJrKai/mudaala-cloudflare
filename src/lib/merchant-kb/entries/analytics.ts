import { app, faq } from '../helpers';
const A = 'docs/TELEGRAM_MINI_APP.md (Insights)';
const note = 'Asking for these numbers here in chat is still being built.';
export const analytics = [
  faq('analytics.summary', 'analytics', 'partial',
    ['How many people visited my shop today?', 'How is my shop performing?', 'Show my shop stats', 'How did I perform this week?'],
    'Send /shop and open Insights. You will see recorded views, shop visits, call and WhatsApp taps, shares and your top listings.',
    { action: app(), src: A, note, needs: 'In-chat analytics retrieval from business-analytics API (real figures only)' }),
  faq('analytics.top-product', 'analytics', 'partial',
    ['Which product received the most views?', 'Which products are getting attention?', 'What is my best product?', 'How many views did my product get?'],
    'Open Insights in My Shop to see your top listings by recorded views.',
    { action: app(), src: A, note, needs: 'In-chat per-product analytics' }),
  faq('analytics.contacts', 'analytics', 'partial',
    ['How many people contacted me?', 'How many clicked WhatsApp?', 'How many people called me?'],
    'Open Insights in My Shop to see call and WhatsApp taps. A tap means someone pressed the button. It does not prove a call or message happened.',
    { action: app(), src: A, note, needs: 'In-chat contact analytics' }),
  faq('analytics.meaning', 'analytics', 'live',
    ['What does product engagement mean?', 'What is a view?', 'Is a view a sale?', 'What is a tap?'],
    'A view means someone opened your product. A tap means someone pressed Call or WhatsApp. Neither is a confirmed sale. Only sales you record yourself count as sales, and Mudaala does not verify payments.',
    { src: A + ' (labels distinguish taps/views from confirmed sales)' }),
];
