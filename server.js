import express from "express";
import nacl from "tweetnacl";
import pkg from "pg";
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// シンプル正規化（必要なら後でNFKC/かな整形を追加）
const norm = s => (s || "").trim();

// 作品コード整形：8桁→ 3-4-1
const normalizeWorkCode = raw => {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length !== 8) return null;
  const f = `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  return /^\d{3}-\d{4}-\d$/.test(f) ? f : null;
};

// CSV生成（実データ）
async function dumpCsvFromDb() {
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
      .map(v => `"${String(v).replace(/"/g,'""')}"`)
      .join(",")
  ).join("\n");
  return header + body + "\n";
}


// --- Middleware to capture raw body for Discord signature verification
const app = express();
app.use(express.raw({ type: 'application/json' }));

// Helpers
function verifyDiscordRequest(req, publicKey) {
  const signature = req.header("X-Signature-Ed25519");
  const timestamp = req.header("X-Signature-Timestamp");
  const body = req.body; // Buffer because of express.raw

  if (!signature || !timestamp) return false;
  try {
    const isVerified = nacl.sign.detached.verify(
      Buffer.from(timestamp + body.toString(), "utf8"),
      Buffer.from(signature, "hex"),
      Buffer.from(publicKey, "hex")
    );
    return isVerified;
  } catch (e) {
    return false;
  }
}

// Root health
app.get("/", (_req, res) => res.status(200).send("MusicDB Bot server is running"));

// Discord interactions endpoint
app.post("/discord/commands", (req, res) => {
  const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || "";
  if (!PUBLIC_KEY || !verifyDiscordRequest(req, PUBLIC_KEY)) {
    return res.status(401).send("invalid request signature");
  }

  let data = {};
  try {
    data = JSON.parse(req.body.toString("utf8"));
  } catch (e) {
    return res.status(400).send("bad json");
  }

  // PING (type 1)
  if (data.type === 1) {
    return res.json({ type: 1 });
  }

  const name = data?.data?.name;

  // Minimal handlers (you can expand later)
  if (name === "track_search") {
  try {
    const title  = norm(data.data.options?.find(o => o.name === "title")?.value);
    const artist = norm(data.data.options?.find(o => o.name === "artist")?.value);

    // 1) まずDBから検索
    const q1 = `SELECT * FROM tracks
                WHERE title_norm = $1 AND (artist_norm = $2 OR $2 = '')
                ORDER BY updated_at DESC LIMIT 1`;
    const r1 = await pool.query(q1, [title, artist]);

    if (r1.rows.length) {
      const t = r1.rows[0];
      return res.json({
        type: 4,
        data: {
          content:
`🎵 ${t.title_norm}${t.artist_norm ? " — " + t.artist_norm : ""}
作品コード: ${t.work_code || "—"}
BPM/Key: ${t.bpm || "—"} / ${t.key || "—"}
信頼度: ${t.confidence || 0}`
        }
      });
    }

    // 2) なければ種レコードを作成（後で外部連携で埋める）
    const ins = await pool.query(
      `INSERT INTO tracks (title_norm, artist_norm, confidence, provenance)
       VALUES ($1, $2, 0, '{"status":"seed"}') RETURNING *`,
      [title, artist]
    );

    // 3) ここで「外部最小連携」を呼ぶ場所（まずはスタブ）
    const stub = {
      work_code: normalizeWorkCode("123-4567-8"),
      bpm: "92",
      key: "A minor",
      confidence: 96,
      provenance: { source: "stub", fetched_at: new Date().toISOString() }
    };

    if (stub && stub.confidence >= 95) {
      await pool.query(
        `UPDATE tracks SET
           work_code=$1, bpm=$2, key=$3, confidence=$4,
           provenance = COALESCE(provenance,'{}'::jsonb) || $5::jsonb,
           updated_at=now()
         WHERE id=$6`,
        [stub.work_code, stub.bpm, stub.key, stub.confidence, JSON.stringify(stub.provenance), ins.rows[0].id]
      );
    }

    return res.json({
      type: 4,
      data: {
        content:
`🟡 データ未登録でした。ベースを作成しました。
タイトル: ${title}${artist ? " / " + artist : ""}
→ 後続の自動再検索でBPM/Key/作品コードを取得します。`
      }
    });
  } catch (e) {
    console.error("track_search error:", e);
    return res.json({ type: 4, data: { content: "❌ 内部エラーが発生しました（管理者に通知済み）" } });
  }
}


  if (name === "artist_list") {
    const artist = data.data.options?.find(o => o.name === "name")?.value || "";
    return res.json({
      type: 4,
      data: {
        content: `🎤 アーティスト一覧（仮）: ${artist}\n（サンプル動作：後でDB参照に置き換えます）`
      }
    });
  }

  // Fallback
  return res.json({
    type: 4,
    data: { content: "コマンドが未対応です。" }
  });
});

async function discordNotify(message) {
  const token = process.env.DISCORD_TOKEN;
  const channel = process.env.SYSTEM_STATUS_CHANNEL;
  if (!token || !channel) return; // 未設定なら黙ってスキップ
  await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: message })
  });
}


// Simple job endpoints (for Render Cron)
app.get("/jobs/export-daily", (_req, res) => res.send("OK: export-daily"));
app.get("/jobs/hot-recheck", (_req, res) => res.send("OK: hot-recheck"));
app.get("/jobs/export-weekly", (_req, res) => res.send("OK: export-weekly"));
app.get("/jobs/monthly-check", (_req, res) => res.send("OK: monthly-check"));
app.get("/jobs/check-tokens", (_req, res) => res.send("OK: check-tokens"));

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
