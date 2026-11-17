import { app, cmd, faq } from '../helpers';
const E = 'docs/TELEGRAM_COMMERCE_ASSISTANT_IMPLEMENTATION.md (section 2) + webhook route.ts';
export const enquiries = [
  faq('enquiries.reply', 'enquiries', 'live',
    ['How do I reply to customers?', 'A customer messaged me', 'Answer a customer enquiry', 'Where do I see customer messages?', 'See my enquiries'],
    'Send /enquiries to see shopper enquiries. Reply with /reply ID your message, and your reply is passed to the customer.',
    { action: cmd('/enquiries'), src: E }),
  faq('enquiries.enable', 'enquiries', 'live',
    ['How do I get customer enquiries on Telegram?', 'Turn on Telegram enquiries', 'I am not receiving enquiries here'],
    'Link your Telegram with /link CODE, start this bot, and enable Telegram enquiries on your listings. Only accounts with a shop profile can enable them. If you are not connected, shoppers are shown WhatsApp or phone instead.',
    { action: cmd('/link'), src: 'docs/TELEGRAM_MERCHANT_ASSISTANT.md (Buyer account identity)' }),
  faq('enquiries.payment', 'enquiries', 'live',
    ['Did the customer pay?', 'How do I know a customer has paid?', 'Confirm payment from customer', 'Customer says they sent money'],
    'Mudaala does not collect or confirm payments, so I can never tell you a customer has paid. Check your own mobile money or bank record before you hand over goods.',
    { src: 'docs/TELEGRAM_COMMERCE_ASSISTANT_IMPLEMENTATION.md (not checkout-first, not a bank)', needs: 'Verified payment integration if ever added' }),
];
