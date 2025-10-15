// server.js
import express from "express";
import fetch from "node-fetch";
import { google } from "googleapis";
import pkg from "pg";
import nacl from "tweetnacl";
const { Pool } = pkg;

const app = express(); // ← グローバルな body-parser は付けない（Discord署名のため）

/* ====== ENV ====== */
const PORT = process.env.PORT || 3000;
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SYSTEM_STATUS_CHANNEL = process.env.SYSTEM_STATUS_CHANNEL;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

/* ====== UTILS ====== */
async function discordNotify(message) {
  if (!DISCORD_TOKEN || !SYSTEM_STATUS_CHANNEL) return;
  await fetch(`https://discord.com/api/v10/channels/${SYSTEM_STATUS_CHANNEL}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bot ${DISCORD_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: message })
  }).catch(()=>{});
}

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracks (
      id SERIAL PRIMARY KEY,
      title_norm TEXT NOT NULL,
      artist_norm TEXT,
      work_code TEXT CHECK (work_code ~ '^[0-9]{3}-[0-9]{4}-[0-9]$') OR work_code IS NULL,
      bpm TEXT,
      key TEXT,
      confidence INTEGER DEFAULT 0,
      provenance JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_artist_title ON tracks(artist_norm, title_norm);
  `);
}

const norm = (s) => (s || "").trim();

/* ====== DB → CSV ====== */
async function dumpCsvFromDb() {
  if (!pool) return "title,artist,work_code,bpm,key,confidence\n";
  const { rows } = await pool.query(
    `SELECT title_norm AS title,
            COALESCE(artist_norm,'') AS artist,
            COALESCE(work_code,'')  AS work_code,
            COALESCE(bpm,'')        AS bpm,
            COALESCE(key,'')        AS key,
            COALESCE(confidence,0)  AS confidence
       FROM tracks
       ORDER BY updated_at DESC
       LIMIT 5000`
  );
  const header = "title,artist,work_code,bpm,key,confidence\n";
  const body = rows.map(r =>
    [r.title, r.artist, r.work_code, r.bpm, r.key, r.confidence]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  ).join("\n");
  return header + (body ? body + "\n" : "");
}

/* ====== Google Drive upload ====== */
async function uploadToDrive(filename, csvText) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error("Google credentials missing");
  }
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: "v3", auth });

  const folderName = "musicdb_exports";
  const list = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)"
  });
  let folderId = list.data.files?.[0]?.id;
  if (!folderId) {
    const f = await drive.files.create({
      requestBody: { name: folderName, mimeType: "application/vnd.google-apps.folder" },
      fields: "id"
    });
    folderId = f.data.id;
  }
  const fileRes = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: "text/csv", body: csvText },
    fields: "id, webViewLink"
  });
  return fileRes.data.webViewLink;
}

/* ====== 外部検索（雛形） ====== */
import { lookupExternalMinimal } from "./services/lookup.js";

/* ====== Routes ====== */
app.get("/", (_req, res) => res.send("MusicDB Bot Server is running"));

/** Discord Slash Commands — raw JSON で署名検証 */
app.post("/discord/commands", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    // ---- Verify signature (raw Body 必須) ----
    const signature = req.get("X-Signature-Ed25519");
    const timestamp = req.get("X-Signature-Timestamp");
    const raw = req.body; // Buffer
    if (!DISCORD_PUBLIC_KEY || !signature || !timestamp || !raw) return res.status(401).send("missing sig");

    const ok = nacl.sign.detached.verify(
      Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from(raw)]),
      Buffer.from(signature, "hex"),
      Buffer.from(DISCORD_PUBLIC_KEY, "hex")
    );
    if (!ok) return res.status(401).send("bad sig");

    const data = JSON.parse(raw.toString("utf8"));
    if (data?.type === 1) return res.json({ type: 1 }); // PING

    const name = data?.data?.name;

    if (name === "track_search") {
      const title = norm(data.data.options?.find(o => o.name === "title")?.value);
      const artist = norm(data.data.options?.find(o => o.name === "artist")?.value || "");

      await ensureSchema();

      // 1) 既存ヒット
      let found = null;
      if (pool) {
        const r = await pool.query(
          `SELECT * FROM tracks
           WHERE title_norm = $1
             AND (artist_norm = $2 OR $2 = '')
           ORDER BY updated_at DESC
           LIMIT 1`,
          [title, artist]
        );
        found = r.rows[0] || null;
      }

      if (found) {
        return res.json({
          type: 4,
          data: { content:
            `🎵 ${found.title_norm}${found.artist_norm ? " — " + found.artist_norm : ""}\n` +
            `作品コード: ${found.work_code || "—"}\n` +
            `BPM/Key: ${found.bpm || "—"} / ${found.key || "—"}\n` +
            `信頼度: ${found.confidence || 0}`
          }
        });
      }

      // 2) 新規作成（seed）
      let insertedId = null;
      if (pool) {
        const ins = await pool.query(
          `INSERT INTO tracks (title_norm, artist_norm, confidence, provenance)
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING id`,
          [title, artist, 0, JSON.stringify({ status: "seed" })]
        );
        insertedId = ins.rows[0]?.id;
      }

      // 3) 外部検索（雛形・失敗しても落ちない）
      try {
        const ext = await lookupExternalMinimal({ title, artist });
        if (ext && pool && insertedId) {
          await pool.query(
            `UPDATE tracks SET
               work_code=$1, bpm=$2, key=$3, confidence=$4,
               provenance = COALESCE(provenance,'{}'::jsonb) || $5::jsonb,
               updated_at=now()
             WHERE id=$6`,
            [ext.work_code, ext.bpm, ext.key, ext.confidence, JSON.stringify(ext.provenance), insertedId]
          );
        }
      } catch (e) {
        console.warn("lookupExternalMinimal failed:", e.message);
      }

      return res.json({
        type: 4,
        data: { content:
          `🟡 データ未登録でした。ベースを作成しました。\n` +
          `タイトル: ${title}${artist ? " / " + artist : ""}\n` +
          `→ 自動再検索でBPM/Key/作品コードを取得します。`
        }
      });
    }

    if (name === "artist_list") {
      const artist = norm(data.data.options?.find(o => o.name === "name")?.value);
      const limit = Number(data.data.options?.find(o => o.name === "limit")?.value || 25);
      await ensureSchema();
      if (!pool) return res.json({ type: 4, data: { content: "DB未設定です" } });
      const r = await pool.query(
        "SELECT title_norm, work_code, bpm, key FROM tracks WHERE artist_norm=$1 ORDER BY updated_at DESC LIMIT $2",
        [artist, Math.min(limit, 50)]
      );
      const lines = r.rows.map(x => `・${x.title_norm} (${x.work_code || "—"})`).join("\n") || "該当なし";
      return res.json({ type: 4, data: { content: `🎤 ${artist}\n${lines}` } });
    }

    return res.json({ type: 4, data: { content: "Unknown command" } });
  } catch (e) {
    console.error("discord handler error:", e);
    return res.status(500).send("error");
  }
});

/* ====== Jobs ====== */
app.get("/jobs/export-daily", async (_req, res) => {
  try {
    await ensureSchema();
    const csvText = await dumpCsvFromDb();
    const filename = `export_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    const link = await uploadToDrive(filename, csvText);
    await discordNotify(`📦 エクスポート完了: ${link}`);
    console.log("✅ CSV exported:", link);
    res.send(`OK: ${link}`);
  } catch (e) {
    console.error("export-daily error:", e);
    await discordNotify(`❌ エクスポート失敗: ${e.message || e}`);
    res.status(500).send("NG");
  }
});

/* ====== Start ====== */
app.listen(PORT, () => console.log("MusicDB bot running on port", PORT));
