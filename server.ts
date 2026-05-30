import express from "express";
import path from "path";
import fs from "fs/promises";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "votes.json");

// Helper to safely load database
async function readDB() {
  try {
    const data = await fs.readFile(DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    return { votes: [] };
  }
}

// Helper to safely write database
async function writeDB(data: any) {
  try {
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write database file:", error);
  }
}

app.use(express.json());

// In-memory Rate Limit state tracker
interface RateLimitEntry {
  count: number;
  resetTime: number;
}
const rateLimits = new Map<string, RateLimitEntry>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimits.set(ip, {
      count: 1,
      resetTime: now + 60 * 1000 // 1 minute sliding window
    });
    return true;
  }
  if (entry.count >= 3) {
    return false;
  }
  entry.count++;
  return true;
}

// API endpoints
app.get("/api/votes", async (req, res) => {
  const dbData = await readDB();
  res.json(dbData);
});

// Disable direct, unverified vote additions to prevent security bypasses
app.post("/api/votes", (req, res) => {
  res.status(403).json({ 
    error: "Direct vote updates are strictly prohibited. All votes must be validated through /api/verify-payment" 
  });
});

// Secure endpoint for verifying payments in Node.js serverless architecture style
app.post("/api/verify-payment", async (req, res) => {
  const { paymentId, fighterId, fighterName, division } = req.body;
  
  if (!paymentId || !fighterId) {
    res.status(400).json({ error: "paymentId and fighterId are required" });
    return;
  }

  // Apply rate limiting checking to avoid brute force or DDOS of paymentIds
  const ip = (req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString();
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many payment verification requests. Limit is 3 requests per minute." });
    return;
  }

  const piApiKey = process.env.PI_API_KEY;
  const officialWallet = process.env.DEVELOPER_WALLET_ADDRESS || "GCXCW4REFA6PMYKOOI5N7F53P4HJR2SETBIOVTVH3ZAFFG35G47OMTWG";

  let isPaymentValid = false;
  let validationError = "Verification failed";

  // If in sandbox mode, or sandbox payment ID is used, safely emulate success
  if (!piApiKey || paymentId.startsWith("demo_") || paymentId.includes("sandbox")) {
    console.log(`[Pi Sandbox Verification] Developer mode emulation for payment: ${paymentId}`);
    isPaymentValid = true;
  } else {
    try {
      // Secure sever-side network call to official Pi blockchain API
      const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}`, {
        headers: {
          "Authorization": `Key ${piApiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`Pi network API responded with HTTP ${response.status}`);
      }

      const pmtData: any = await response.json();

      // Check Criteria (a): transaction state must be strictly equal to completed
      const isCompleted = pmtData.status === "completed" || 
                          (pmtData.status && pmtData.status.developer_completed === true) || 
                          pmtData.state === "completed";

      // Check Criteria (b): transaction cost must be exactly 1.0 Pi
      const isAmountValid = pmtData.amount !== undefined && Number(pmtData.amount) === 1.0;

      // Check Criteria (c): beneficiary wallet address must match ours
      const isRecipientValid = pmtData.recipient && pmtData.recipient.toLowerCase() === officialWallet.toLowerCase();

      if (!isCompleted) {
        validationError = "Pi Network transaction is not completed";
      } else if (!isAmountValid) {
        validationError = `Transaction amount mismatch: expected 1.0, got ${pmtData.amount}`;
      } else if (!isRecipientValid) {
        validationError = `Destination wallet error: mismatch with developer official address`;
      } else {
        isPaymentValid = true;
      }
    } catch (e: any) {
      console.error("[Verify API Client Error] Failed contacting blockchain:", e.message);
      validationError = `Could not contact Pi Servers: ${e.message}`;
    }
  }

  if (!isPaymentValid) {
    res.status(403).json({ error: `Access Denied: ${validationError}` });
    return;
  }

  // Increment and persist the vote inside DB
  const dbData = await readDB();
  if (!dbData.votes) {
    dbData.votes = [];
  }

  let entry = dbData.votes.find((v: any) => v.fighter_key === fighterId);
  if (!entry) {
    entry = {
      fighter_key: fighterId,
      fighter_name: fighterName || fighterId,
      division: division || "Unknown",
      points: 0,
      pi_amount: 0
    };
    dbData.votes.push(entry);
  }

  entry.points = (Number(entry.points) || 0) + 100;
  entry.pi_amount = (Number(entry.pi_amount) || 0) + 1;

  await writeDB(dbData);
  res.status(200).json({ success: true, entry });
});

app.post("/api/approve", async (req, res) => {
  const { paymentId } = req.body;
  const piApiKey = process.env.PI_API_KEY;

  if (!paymentId) {
    res.status(400).json({ error: "paymentId is required" });
    return;
  }

  if (!piApiKey || paymentId.startsWith("demo_")) {
    console.log(`[Pi Sandbox] Approving simulated payment: ${paymentId}`);
    res.json({ approved: true });
    return;
  }

  try {
    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${piApiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Pi APIs responded with HTTP status ${response.status}`);
    }

    res.json({ approved: true });
  } catch (e: any) {
    console.error("[Pi SDK server-approval error]:", e.message);
    res.status(500).json({ error: `Integration error on Pi approval: ${e.message}` });
  }
});

app.post("/api/complete", async (req, res) => {
  const { paymentId, txid } = req.body;
  const piApiKey = process.env.PI_API_KEY;

  if (!paymentId) {
    res.status(400).json({ error: "paymentId is required" });
    return;
  }

  if (!piApiKey || paymentId.startsWith("demo_")) {
    console.log(`[Pi Sandbox] Finalizing simulated payment: ${paymentId}`);
    res.json({ completed: true });
    return;
  }

  try {
    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${piApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ txid })
    });

    if (!response.ok) {
      throw new Error(`Pi APIs responded with HTTP status ${response.status}`);
    }

    res.json({ completed: true });
  } catch (e: any) {
    console.error("[Pi SDK server-completion error]:", e.message);
    res.status(500).json({ error: `Integration error on Pi completion: ${e.message}` });
  }
});

async function startServer() {
  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
