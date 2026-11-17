import { app, cmd, faq } from '../helpers';
export const discovery = [
  faq('discovery.find', 'discovery', 'live',
    ['How do customers find my products?', 'How will people see my shop?', 'Where do my products show up?'],
    'Customers can find your active listings through Mudaala search and browse, and through your public shop link. Send /publicshop to get the link.',
    { action: cmd('/publicshop'), src: 'docs/TELEGRAM_COMMERCE_ASSISTANT_IMPLEMENTATION.md (search active eligible listings)' }),
  faq('discovery.not-appearing', 'discovery', 'partial',
    ['Why isn\'t my product appearing?', 'My product is not showing', 'Customers cannot see my listing', 'Product missing from search'],
    'Only active, unexpired listings show to customers. Send /products to see what is active now. If your product is missing, it may have expired after 30 days or may not have finished posting.',
    { action: cmd('/products'), src: 'webhook route.ts (/products filters ACTIVE + not expired)', note: 'If it should be active and is not, tell us.' }),
  faq('discovery.share', 'discovery', 'live',
    ['How do I share my shop?', 'Share my products on WhatsApp', 'How can I advertise my shop?'],
    'Send /publicshop, then share that link on WhatsApp, Facebook or anywhere your customers are.',
    { action: cmd('/publicshop'), src: 'webhook route.ts (/publicshop)' }),
];
