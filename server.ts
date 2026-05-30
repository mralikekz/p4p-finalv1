import express from "express";
import path from "path";
import fs from "fs/promises";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;
const dbPath = path.join(process.cwd(), "db.json");

// Define custom types
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory rate limiting tracker
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

// DB helper functions
async function readDB() {
  try {
    const data = await fs.readFile(dbPath, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    return { votes: [] };
  }
}

async function writeDB(data: any) {
  await fs.writeFile(dbPath, JSON.stringify(data, null, 2), "utf-8");
}

app.use(express.json());

// Main official wallet address and API key from environment
const DEVELOPER_WALLET_ADDRESS = process.env.DEVELOPER_WALLET_ADDRESS || "GBHVTAJ7543JH4YE3NMKJQQKGIIN2EDEY2JAWP2H653RPL37VDBFPPLO";
const PI_API_KEY = process.env.PI_API_KEY || "";

// Serve the Pi validation-key.txt at the root
app.get("/validation-key.txt", async (req, res) => {
  try {
    const keyPath = path.join(process.cwd(), "validation-key.txt");
    res.sendFile(keyPath);
  } catch (err: any) {
    res.status(404).send("File not found");
  }
});

// API endpoints
app.get("/api/votes", async (req, res) => {
  const dbData = await readDB();
  res.json(dbData.votes || []);
});

// Disable direct, unverified votes updates
app.post("/api/votes", (req, res) => {
  res.status(403).json({
    error: "Direct vote updates are prohibited. All votes must be validated through /api/verify-payment."
  });
});

// Secure endpoint for verifying payments
app.post("/api/verify-payment", async (req, res) => {
  const { paymentId, fighterId, fighterName, division } = req.body;

  if (!paymentId || !fighterId) {
    res.status(400).json({ error: "paymentId and fighterId are required fields" });
    return;
  }

  // Rate Limiting by IP client
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").toString();
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many payment verification requests. Limit is 3 requests per minute." });
    return;
  }

  let isPaymentValid = false;
  let validationError = "Verification failed";

  // If in sandbox mode or starting with demo_, simulate success
  if (!PI_API_KEY || paymentId.startsWith("demo_") || paymentId.includes("sandbox")) {
    console.log(`[Pi Sandbox Verification] Developer mode emulation for payment: ${paymentId}`);
    isPaymentValid = true;
  } else {
    try {
      // Secure server-side request to Pi Network API
      const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}`, {
        headers: {
          "Authorization": `Key ${PI_API_KEY}`
        }
      });

      if (!response.ok) {
        throw new Error(`Pi APIs responded with HTTP status ${response.status}`);
      }

      const pmtData: any = await response.json();

      // Criteria (a): Transaction state completed
      const isCompleted = pmtData.status === "completed" || 
                          (pmtData.status && pmtData.status.developer_completed === true) || 
                          pmtData.state === "completed";

      // Criteria (b): Exact size is 1.0 Pi
      const isAmountValid = pmtData.amount !== undefined && Number(pmtData.amount) === 1.0;

      // Criteria (c): Destination is official wallet
      const isRecipientValid = pmtData.recipient && pmtData.recipient.toLowerCase() === DEVELOPER_WALLET_ADDRESS.toLowerCase();

      if (!isCompleted) {
        validationError = "Pi Network transaction is not yet completed on blockchain";
      } else if (!isAmountValid) {
        validationError = `Transaction amount mismatch: expected 1.0, got ${pmtData.amount}`;
      } else if (!isRecipientValid) {
        validationError = `Recipient wallet mismatch: expected ${DEVELOPER_WALLET_ADDRESS}, got ${pmtData.recipient}`;
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

  // Add the verified vote and increment by 100 points
  const dbData = await readDB();
  if (!dbData.votes) {
    dbData.votes = [];
  }

  let entry = dbData.votes.find((v: any) => v.fighter_key === fighterId);
  if (!entry) {
    entry = {
      fighter_key: fighterId,
      fighter_name: fighterName || fighterId,
      division: division || "Unknown Class",
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

// Approve integration
app.post("/api/approve", async (req, res) => {
  const { paymentId } = req.body;

  if (!paymentId) {
    res.status(400).json({ error: "paymentId is required" });
    return;
  }

  if (!PI_API_KEY || paymentId.startsWith("demo_")) {
    console.log(`[Pi Sandbox] Approving simulated payment: ${paymentId}`);
    res.json({ approved: true });
    return;
  }

  try {
    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${PI_API_KEY}`,
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

// Finalize complete integration
app.post("/api/complete", async (req, res) => {
  const { paymentId, txid } = req.body;

  if (!paymentId) {
    res.status(400).json({ error: "paymentId is required" });
    return;
  }

  if (!PI_API_KEY || paymentId.startsWith("demo_")) {
    console.log(`[Pi Sandbox] Finalizing simulated payment: ${paymentId}`);
    res.json({ completed: true });
    return;
  }

  try {
    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${PI_API_KEY}`,
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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
