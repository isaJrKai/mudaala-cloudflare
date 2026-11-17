import { app, faq } from '../helpers';
export const identity = [
  faq('identity.mucode', 'identity', 'live',
    ['What is a MU-CODE?', 'How do I get my MU-CODE?', 'Where is my mucode?', 'What is my shop code?'],
    'Your MU-CODE is your shop code, for example MD-4821. It identifies your shop on Mudaala, never changes, and is created when you set up your shop. Customers can type it into Mudaala search or scan your QR poster.',
    { action: app(), src: 'src/lib/shop.ts (MD- + 4 digits, never regenerated); src/lib/copy.ts posterCodeNote', needs: 'Owner decision: customer-facing name is "shop code" in the UI, "MU-CODE" in docs' }),
  faq('identity.qr', 'identity', 'live',
    ['How do I get my shop QR code?', 'Send me my QR code', 'I want a QR code for my shop', 'Where can I print my QR?', 'Shop poster'],
    'Open your shop page and tap Show poster and print. It makes a printable QR poster with your shop code, and you can share it on WhatsApp. Anyone who scans it lands on your shop. The code stays the same, so old posters keep working.',
    { action: app(), src: 'src/components/commerce/shop-view.tsx; src/lib/copy.ts posterTitle/posterShow/posterShare', needs: 'Send QR/poster as an image inside chat' }),
  faq('identity.find-by-code', 'identity', 'live',
    ['Can customers find me with my code?', 'How do customers use my MU-CODE?', 'Can someone search my shop by code?'],
    'Yes. Customers can type your shop code into Mudaala search like a till number, or scan your QR poster.',
    { src: 'src/lib/copy.ts findAgainHint; src/app/api/shops/lookup/route.ts' }),
];
