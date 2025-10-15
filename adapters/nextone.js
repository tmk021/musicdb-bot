import * as cheerio from "cheerio";
import { limNext, getHtml } from "../lib/http.js";

/** Placeholder adapter — update selectors/URLs to match real NexTone HTML. */
export async function searchNextone({ title, artist }) {
  const u = new URL("https://search.nex-tone.co.jp/");
  const html = await limNext.schedule(()=>getHtml(u.toString()));
  const $ = cheerio.load(html);
  const hits = [];
  $(".result-item").each((_i, el)=>{
    const t = $(el).find(".title").text().trim();
    const a = $(el).find(".artist").text().trim();
    const url = $(el).find("a").attr("href") || u.toString();
    hits.push({ title: t, artist: a, url, source: "NexTone" });
  });
  return hits;
}
