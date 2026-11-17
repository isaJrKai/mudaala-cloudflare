const PHRASES: [RegExp, string][] = [
  [/\bmu[\s-]?code\b/g, 'mucode'],
  [/\bqr[\s-]?code\b/g, 'qr'],
  [/\bsold[\s-]?out\b/g, 'soldout'],
  [/\bout of stock\b/g, 'soldout'],
  [/\bno longer available\b/g, 'soldout'],
  [/\bwhats\s?app\b/g, 'whatsapp'],
  [/\bopening hours\b|\bworking hours\b|\bbusiness hours\b/g, 'hours'],
  [/\bsign ?up\b|\bregister\b|\bopen a shop\b|\bcreate a shop\b|\bstart selling\b/g, 'register'],
];
const SYN: Record<string, string> = {
  upload: 'post', publish: 'post', add: 'post', list: 'post', listing: 'product', item: 'product', items: 'product', products: 'product',
  remove: 'delete', erase: 'delete', hide: 'pause', archive: 'pause', unpublish: 'pause',
  pic: 'photo', pics: 'photo', picture: 'photo', pictures: 'photo', image: 'photo', images: 'photo', photograph: 'photo', photos: 'photo', photographs: 'photo',
  store: 'shop', business: 'shop', shops: 'shop', stores: 'shop',
  cost: 'price', pricing: 'price', prices: 'price', amount: 'price',
  edit: 'change', update: 'change', modify: 'change', correct: 'change', fix: 'change',
  customers: 'customer', buyers: 'customer', buyer: 'customer', clients: 'customer', enquiries: 'enquiry', inquiries: 'enquiry', inquiry: 'enquiry', messages: 'enquiry', message: 'enquiry',
  stats: 'analytics', statistics: 'analytics', insights: 'analytics', performance: 'analytics', views: 'view', visitors: 'view', visits: 'view', visited: 'view',
  link: 'link', url: 'link', share: 'share', sharing: 'share',
  rejected: 'reject', refused: 'reject', declined: 'reject', blocked: 'reject',
  appearing: 'appear', showing: 'appear', visible: 'appear', seen: 'appear',
  expenses: 'expense', costs: 'expense', sales: 'sale', sell: 'sale', sold: 'sale',
  telegram: 'telegram', bot: 'telegram', account: 'account', login: 'account', connect: 'account', reconnect: 'account', link2: 'account',
};
const STOP = new Set(['a','an','the','i','im','my','me','we','our','you','your','to','do','does','did','how','can','could','would','should','is','are','am','it','its','of','on','in','at','for','and','or','with','this','that','what','whats','want','wanna','need','please','help','some','any','be','get','have','has','there','so','just','if','when','where','why','which','will','now','mark','something','set']);

export function tokenize(input: string): string[] {
  let s = input.toLowerCase().replace(/['’]/g, '');
  for (const [re, to] of PHRASES) s = s.replace(re, ` ${to} `);
  const raw = s.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let w of raw) {
    if (STOP.has(w)) continue;
    if (SYN[w]) w = SYN[w];
    else if (w.length > 4 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}
export const normalize = (s: string) => tokenize(s).join(' ');
