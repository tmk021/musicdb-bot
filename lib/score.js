import { norm } from "./normalize.js";

export function scoreCandidate(q, h){
  const t = norm(q.title), a = norm(q.artist||'');
  const tt = norm(h.title), aa = norm(h.artist||'');
  const titleHit = (tt.includes(t) || t.includes(tt)) ? 60 : 0;
  const artistHit = a ? ((aa.includes(a)||a.includes(aa)) ? 25 : 0) : 10;
  const codeHit = h.work_code ? 30 : 0;
  return titleHit + artistHit + codeHit;
}
