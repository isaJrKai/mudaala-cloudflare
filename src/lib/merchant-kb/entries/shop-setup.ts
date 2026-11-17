import { app, cmd, faq } from '../helpers';
const S = 'docs/TELEGRAM_MINI_APP.md (My shop) + src/lib/validation.ts';
const note = 'Changing this by typing in chat is still being built.';
export const shopSetup = [
  faq('shop.change-name', 'shop-setup', 'partial',
    ['How do I change my shop name?', 'Rename my shop', 'Update the name of my business'],
    'Send /shop, open My shop and edit your profile. The name needs 2 to 80 characters and no emojis.',
    { action: app(), src: S, note, needs: 'In-chat profile edit with confirmation' }),
  faq('shop.change-contact', 'shop-setup', 'partial',
    ['How do I change my phone number?', 'Update my WhatsApp number', 'Change my contact number', 'Customers are calling the wrong number'],
    'Send /shop, open My shop and edit your phone or WhatsApp number there.',
    { action: app(), src: S, note, needs: 'In-chat contact edit with confirmation' }),
  faq('shop.change-location-hours', 'shop-setup', 'partial',
    ['How do I change my shop location?', 'Update my opening hours', 'I moved my shop to a new area', 'Change my trading area'],
    'Send /shop, open My shop and edit your district, area or opening hours (up to 120 characters).',
    { action: app(), src: S, note, needs: 'In-chat location/hours edit' }),
  faq('shop.change-photo', 'shop-setup', 'partial',
    ['How do I change my shop logo?', 'Update my profile photo', 'Add a cover photo to my shop'],
    'Send /shop, open My shop and change your profile photo or cover photo in your shop profile.',
    { action: app(), src: S, note, needs: 'In-chat image change with moderation' }),
  faq('shop.preview', 'shop-setup', 'live',
    ['How does my shop look to customers?', 'Preview my shop', 'Show me my public shop page', 'Send me my shop link', 'How do I get my shop link?'],
    'Send /publicshop and I will give you your public shop link. Open it to see exactly what customers see.',
    { action: cmd('/publicshop'), src: 'src/app/api/telegram/webhook/route.ts (/publicshop)' }),
];
