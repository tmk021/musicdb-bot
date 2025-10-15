import * as cheerio from "cheerio";
import { limJwid, getHtml } from "../lib/http.js";
import { normalizeWorkCode } from "../lib/normalize.js";

/** Placeholder adapter — update selectors/URLs to match real J-WID HTML. */
export async function searchJwid({ title, artist }) {
  const u = new URL("https://www2.jasrac.or.jp/eJwid/");
  const html = await limJwid.schedule(()=>getHtml(u.toString()));
  const $ = cheerio.load(html);
  const hits = [];
  // Example selectors — replace with real ones
  $("table.search-results tr.result").each((_i, el)=>{
    const t = $(el).find(".title").text().trim();
    const a = $(el).find(".artist").text().trim();
    const codeRaw = $(el).find(".workcode").text().trim();
    const code = normalizeWorkCode(codeRaw);
    const url = $(el).find("a.detail").attr("href") || u.toString();
    if (t) hits.push({ title: t, artist: a, work_code: code || undefined, url, source: "J-WID" });
  });
  return hits;
}
