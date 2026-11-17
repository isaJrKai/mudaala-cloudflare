import { app, faq } from '../helpers';
export const photos = [
  faq('photos.limit', 'photos', 'live',
    ['Photo too large', 'Image file size too big', 'How many photos can I add?', 'What is the maximum photo size?'],
    'Each listing can have up to 4 photos, and each photo can be up to 8MB. If a photo is too big, take it again at a lower camera quality or send it as a normal photo.',
    { src: 'src/lib/validation.ts photos max(4); src/app/api/upload/route.ts MAX_BYTES 8MB' }),
  faq('photos.rejected', 'photos', 'partial',
    ['Why was my photo rejected?', 'My picture was not accepted', 'Photo upload failed', 'Photo blocked'],
    'Mudaala checks every photo before it goes live. Use a clear photo of the actual product in good light and try again. The app shows the reason when it rejects one.',
    { action: app(), src: 'src/lib/image-moderation.ts; docs/MARKETPLACE_TRUST_AND_SAFETY.md', note: 'If it keeps failing, tell us what you uploaded.', needs: 'Surface exact rejection reason in Telegram' }),
  faq('photos.add-more', 'photos', 'live',
    ['Add another photo', 'Can I add more pictures to a product?', 'Attach a second image to my listing'],
    'Open Products, pick the product and add photos, up to 4 in total.', { action: app(), src: 'src/lib/validation.ts photos max(4)' }),
  faq('photos.tips', 'photos', 'live',
    ['How do I take good product photos?', 'Tips for better pictures', 'What kind of photo sells best?'],
    'Use daylight, keep the product in the middle and in focus, and show the real item. Clear real photos help customers trust your shop.',
    { src: 'docs/MUDAALA_GROWTH_COACH.md (real shop facts only); general guidance' }),
];
