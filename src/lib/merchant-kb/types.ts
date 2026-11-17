export type Topic =
  | 'registration' | 'shop-setup' | 'products' | 'photos' | 'pricing' | 'identity'
  | 'discovery' | 'analytics' | 'enquiries' | 'sales-stock' | 'growth' | 'account';

/**
 * live        = merged, tested, verified in production -> served to merchants
 * partial     = works but incomplete -> served, with statusNote appended
 * planned     = not built yet -> NEVER served as fact; returns "unsupported"
 * unverified  = written from spec, not yet checked against code -> NEVER served until flipped
 */
export type ImplStatus = 'live' | 'partial' | 'planned' | 'unverified';

export type FaqAction =
  | { kind: 'command'; value: string }   // existing bot command, e.g. "/products"
  | { kind: 'miniapp'; value?: string }  // open the Mini App (https://mudaala.store/telegram)
  | { kind: 'workflow'; value: string }; // future in-chat workflow id (router-owned)

export interface FaqEntry {
  id: string;                 // e.g. "products.post-photo"
  topic: Topic;
  questions: string[];        // canonical question + alternative phrasings
  answer: string;             // verified answer (what to say once status is live/partial)
  action?: FaqAction;         // what the router should offer/run after the answer
  source: string;             // source of truth: file/PR/endpoint that proves the answer
  status: ImplStatus;
  statusNote?: string;        // shown to merchant for partial/planned
  needs?: string;             // backend capability required before this can go live
}

export type MatchResult =
  | { kind: 'answer'; entry: FaqEntry; score: number }
  | { kind: 'unsupported'; entry: FaqEntry; score: number }
  | { kind: 'ambiguous'; candidates: FaqEntry[] }
  | { kind: 'no_match'; bestScore: number }; // -> hand to conversational AI fallback

export interface MatcherOptions {
  threshold?: number;                 // min score to accept (default 0.55)
  ambiguityGap?: number;              // top-2 within this gap => ambiguous (default 0.06)
  serveStatuses?: ImplStatus[];       // default ['live','partial']
}
