import Bottleneck from "bottleneck";

export const limJwid = new Bottleneck({ minTime: 1200, reservoir: 30, reservoirRefreshInterval: 60000, reservoirRefreshAmount: 30 });
export const limNext = new Bottleneck({ minTime: 1200, reservoir: 30, reservoirRefreshInterval: 60000, reservoirRefreshAmount: 30 });

export async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "ja-JP" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
