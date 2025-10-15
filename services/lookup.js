import { searchJwid } from "../adapters/jwid.js";
import { searchNextone } from "../adapters/nextone.js";
import { normalizeWorkCode } from "../lib/normalize.js";
import { scoreCandidate } from "../lib/score.js";

export async function lookupExternalMinimal(q){
  const [jw, nx] = await Promise.allSettled([
    searchJwid(q),
    searchNextone(q)
  ]);
  const cand = [
    ...(jw.status==="fulfilled" ? jw.value : []),
    ...(nx.status==="fulfilled" ? nx.value : []),
  ];
  if (!cand.length) return null;
  const scored = cand.map(h=>({ ...h, _score: scoreCandidate(q, h) })).sort((a,b)=>b._score-a._score);
  const best = scored[0];
  const work_code = normalizeWorkCode(best.work_code || "") || undefined;
  const confidence = Math.min(
    (best.source==="J-WID" && work_code ? 95 : 80) + (best._score>70 ? 5 : 0),
    100
  );
  return {
    work_code,
    bpm: best.bpm,
    key: best.key,
    confidence,
    provenance: { source: best.source, url: best.url, fetched_at: new Date().toISOString() }
  };
}
