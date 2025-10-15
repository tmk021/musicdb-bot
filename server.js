import express from "express";
import nacl from "tweetnacl";

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
    const title = data.data.options?.find(o => o.name === "title")?.value || "";
    const artist = data.data.options?.find(o => o.name === "artist")?.value || "";

    // Immediate ACK: respond with a simple message (type 4 = CHANNEL_MESSAGE_WITH_SOURCE)
    return res.json({
      type: 4,
      data: {
        content: `🎵 検索受付: 「${title}」${artist ? " / " + artist : ""}\n（サンプル動作：後でDBやDrive連携を追加できます）`
      }
    });
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

// Simple job endpoints (for Render Cron)
app.get("/jobs/export-daily", (_req, res) => res.send("OK: export-daily"));
app.get("/jobs/hot-recheck", (_req, res) => res.send("OK: hot-recheck"));
app.get("/jobs/export-weekly", (_req, res) => res.send("OK: export-weekly"));
app.get("/jobs/monthly-check", (_req, res) => res.send("OK: monthly-check"));
app.get("/jobs/check-tokens", (_req, res) => res.send("OK: check-tokens"));

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
