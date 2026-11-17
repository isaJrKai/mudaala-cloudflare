import type { FaqAction, FaqEntry, ImplStatus, Topic } from './types';
export const cmd = (value: string): FaqAction => ({ kind: 'command', value });
export const app = (): FaqAction => ({ kind: 'miniapp' });
type Opts = { action?: FaqAction; src: string; note?: string; needs?: string };
export const faq = (id: string, topic: Topic, status: ImplStatus, questions: string[], answer: string, o: Opts): FaqEntry =>
  ({ id, topic, status, questions, answer, action: o.action, source: o.src, statusNote: o.note, needs: o.needs });
