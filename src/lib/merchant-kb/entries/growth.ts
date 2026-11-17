import { app, faq } from '../helpers';
const G = 'docs/MUDAALA_GROWTH_COACH.md';
export const growth = [
  faq('growth.attract', 'growth', 'live',
    ['How do I attract more customers?', 'How can I sell more?', 'Give me tips to grow my shop'],
    'Complete your shop profile, add products with clear real photos, keep prices and availability up to date, reply to enquiries quickly and share your shop poster and link.',
    { src: G + ' (recommendation principles)' }),
  faq('growth.reminders', 'growth', 'partial',
    ['Remind me later', 'Remind me in 30 minutes', 'Why did I get this reminder?', 'Stop sending me reminders', 'Snooze notification'],
    'Reminders come from real activity in your shop and appear in your Mudaala notification centre. You can snooze for 15 minutes, 30 minutes, 1 hour or tomorrow, or dismiss them.',
    { action: app(), src: G + ' (Merchant controls)', note: 'Reminders inside Telegram are still being connected.', needs: 'Growth Coach delivery to Telegram' }),
];
