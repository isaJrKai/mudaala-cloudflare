import { cmd, faq } from '../helpers';
const M = 'docs/TELEGRAM_MERCHANT_ASSISTANT.md';
export const account = [
  faq('account.reconnect', 'account', 'live',
    ['How do I reconnect my Telegram account?', 'My Telegram is not linked', 'The bot does not recognise me', 'Link Telegram to a different account'],
    'Generate a new one-time code in Account, then send /link CODE. Each Mudaala account has one active Telegram, so linking a new one replaces the old one.',
    { action: cmd('/link'), src: M + ' (Buyer account identity)' }),
  faq('account.unlink', 'account', 'live',
    ['How do I disconnect Telegram?', 'Unlink my account', 'Stop the bot from managing my shop'],
    'Send /unlink from the connected private chat. This disconnects Telegram and turns off Telegram enquiries. You will need a new code to reconnect.',
    { action: cmd('/unlink'), src: M }),
  faq('account.security', 'account', 'live',
    ['Is my shop safe?', 'Can someone else change my shop?', 'Someone else is using my account'],
    'Only the Telegram account you linked can use your shop here. Mudaala never asks for your password in chat, and the bot only works in private chats.',
    { src: M + ' (hashed ids, private chats only)' }),
  faq('account.commands', 'account', 'live',
    ['What can this bot do?', 'List of commands', 'Show me the menu', 'How do I use this bot?'],
    'Send /help to see every command: /search, /link, /unlink, /shop, /publicshop, /products, /enquiries, /messages, /reply and /followup.',
    { action: cmd('/help'), src: 'webhook route.ts (/help text)' }),
];
