import { tokenize, normalize } from './normalize';
import type { FaqAction, FaqEntry, MatchResult, MatcherOptions } from './types';

interface Indexed { entry: FaqEntry; variants: { norm: string; set: Set<string> }[] }

export function createMatcher(entries: FaqEntry[], opts: MatcherOptions = {}) {
  const threshold = opts.threshold ?? 0.55;
  const gap = opts.ambiguityGap ?? 0.06;
  const serve = new Set(opts.serveStatuses ?? ['live', 'partial']);

  const index: Indexed[] = entries.map((entry) => ({
    entry,
    variants: entry.questions.map((q) => ({ norm: normalize(q), set: new Set(tokenize(q)) })),
  }));

  // IDF over all variants: rare words (qr, mucode, expense) count more than "post"/"shop".
  const df = new Map<string, number>();
  let N = 0;
  for (const { variants } of index) for (const v of variants) { N++; for (const t of v.set) df.set(t, (df.get(t) ?? 0) + 1); }
  const idf = (t: string) => Math.log(1 + N / (1 + (df.get(t) ?? 0)));
  const w = (s: Set<string>) => [...s].reduce((a, t) => a + idf(t), 0);

  function score(qNorm: string, qSet: Set<string>, v: { norm: string; set: Set<string> }): number {
    if (qNorm && qNorm === v.norm) return 1;
    if (!qSet.size || !v.set.size) return 0;
    let inter = 0;
    for (const t of qSet) if (v.set.has(t)) inter += idf(t);
    // Words we have never seen in any FAQ (product names like "handbag") must not dilute the score.
    const known = new Set([...qSet].filter((t) => df.has(t)));
    const q = w(known), f = w(v.set);
    if (!q) return 0;
    const containment = inter / q;            // how much of what they said is covered
    const coverage = inter / f;               // how much of the FAQ variant they hit
    return 0.65 * containment + 0.35 * coverage;
  }

  function match(message: string): MatchResult {
    const qSet = new Set(tokenize(message));
    const qNorm = normalize(message);
    if (qSet.size === 0) return { kind: 'no_match', bestScore: 0 };

    const scored = index
      .map(({ entry, variants }) => ({ entry, score: Math.max(...variants.map((v) => score(qNorm, qSet, v))) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < threshold) return { kind: 'no_match', bestScore: best?.score ?? 0 };

    const close = scored.filter((s) => s.score >= threshold && best.score - s.score <= gap);
    if (close.length > 1) {
      // weak tie => we don't actually understand it; let AI interpret instead of offering random options
      if (best.score < 0.7) return { kind: 'no_match', bestScore: best.score };
      // same-topic near-duplicates are fine to disambiguate; cross-entry closeness => ask
      return { kind: 'ambiguous', candidates: close.slice(0, 3).map((s) => s.entry) };
    }
    if (!serve.has(best.entry.status)) return { kind: 'unsupported', entry: best.entry, score: best.score };
    return { kind: 'answer', entry: best.entry, score: best.score };
  }

  return { match };
}

/** Merchant-facing text. Never states unbuilt features as fact. */
export function renderReply(r: MatchResult): { text: string; action?: FaqAction; useAI: boolean } {
  switch (r.kind) {
    case 'answer': {
      const note = r.entry.status === 'partial' && r.entry.statusNote ? `\n\nNote: ${r.entry.statusNote}` : '';
      return { text: r.entry.answer + note, action: r.entry.action, useAI: false };
    }
    case 'unsupported':
      return { text: r.entry.statusNote ?? "That isn't available in Telegram yet. We're working on it.", useAI: false };
    case 'ambiguous':
      return { text: 'Did you mean:\n' + r.candidates.map((c, i) => `${i + 1}. ${c.questions[0]}`).join('\n'), useAI: false };
    case 'no_match':
      return { text: '', useAI: true };
  }
}

/** Gap list for the PR description: everything not yet live and what backend it needs. */
export function gapReport(entries: FaqEntry[]) {
  return entries.filter((e) => e.status !== 'live').map((e) => ({ id: e.id, status: e.status, needs: e.needs ?? 'verify against source' }));
}
