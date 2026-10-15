import type { AssistProposal, AssistRequest, ProposalItem } from './types';

/**
 * The same proposal, made by the app alone, with no AI and no network. It is used when no AI is set up (or the person prefers it),
 * and it goes through exactly the same review. Plain rules, written down: rotate through the candidates so nothing repeats while
 * there is still something new, and spread sessions across the days.
 */
export const localProposal = (req: AssistRequest): AssistProposal => {
  const items: ProposalItem[] = [];
  const cs = req.candidates;
  if (cs.length === 0) return { feature: req.feature, note: '', items };
  if (req.feature === 'meals') {
    let n = 0;
    const used = new Set<string>();
    for (const date of req.days) {
      for (const slot of req.slots) {
        if (items.length >= req.maxItems) break;
        const fits = cs.filter((c) => c.slots?.includes(slot));
        if (!fits.length) continue;
        // prefer something not yet used; when everything has been, start the rotation again
        const fresh = fits.filter((c) => !used.has(c.id));
        const pool = fresh.length ? fresh : fits;
        const pick = pool[n++ % pool.length];
        used.add(pick.id);
        items.push({ candidateId: pick.id, date, slot, reason: `${pick.minutes} minutes in total` });
      }
    }
    return { feature: 'meals', note: 'A simple rotation through meals that fit what you told us.', items };
  }
  if (req.feature === 'movement') {
    // spread the sessions out: every other day when there is room, then fill in
    const order = [...req.days.keys()].sort((a, b) => (a % 2) - (b % 2) || a - b).slice(0, req.maxItems).sort((a, b) => a - b);
    const byType = [...new Set(cs.map((c) => c.tags[0] ?? ''))];
    order.forEach((di, i) => {
      const type = byType[i % byType.length];
      const pool = cs.filter((c) => (c.tags[0] ?? '') === type);
      const pick = pool[Math.floor(i / byType.length) % pool.length] ?? cs[i % cs.length];
      items.push({ candidateId: pick.id, date: req.days[di], slot: null, reason: `${pick.minutes} minutes${pick.tags[0] ? `, ${pick.tags[0]}` : ''}` });
    });
    return { feature: 'movement', note: 'Sessions spread over your days, with a mix of kinds.', items };
  }
  for (const c of cs.slice(0, req.maxItems)) items.push({ candidateId: c.id, date: null, slot: null, reason: `a first try takes ${c.minutes} minutes` });
  return { feature: 'learning', note: 'The first ideas that fit your answers.', items };
};
