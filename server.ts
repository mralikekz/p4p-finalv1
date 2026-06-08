import express from "express";
import path from "path";
import fs from "fs/promises";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;
const dbPath = path.join(process.cwd(), "db.json");

// Define custom types
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface Pioneer {
  username: string;
  walletAddress: string;
  registeredAt: string;
  uid?: string;
}

interface VoteEntry {
  fighter_key: string;
  fighter_name: string;
  division: string;
  points: number;
  pi_amount: number;
}

// In-memory rate limiting tracker
const rateLimits = new Map<string, RateLimitEntry>();

function checkRateLimit(ip: string): boolean {
  // Unlimited voting allowed for Pioneers (as requested: can vote up to 10000 times without limits)
  return true;
}

// DB helper functions for local filesystem
async function readDB() {
  try {
    const data = await fs.readFile(dbPath, "utf-8");
    const parsed = JSON.parse(data);
    return {
      votes: parsed.votes || [],
      users: parsed.users || [],
      payouts: parsed.payouts || []
    };
  } catch (e) {
    return { votes: [], users: [], payouts: [] };
  }
}

async function writeDB(data: any) {
  await fs.writeFile(dbPath, JSON.stringify(data, null, 2), "utf-8");
}

// --- LAZY SUPABASE CLIENT INITIALIZATION ---
let _supabaseClient: any = null;

function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      _supabaseClient = createClient(url, key);
      console.log("[Database Service] Connected to Supabase Persistent Cloud Database.");
      return _supabaseClient;
    } catch (err: any) {
      console.error("[Database Service] Supabase initialization failed:", err.message);
    }
  }
  return null;
}

// --- UNIVERSAL DATABASE LAYER (Supabase with JSON fallback) ---
async function getVotes(): Promise<VoteEntry[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("votes")
        .select("*")
        .order("points", { ascending: false });
      if (error) throw error;
      if (data && data.length > 0) {
        return data.map((v: any) => ({
          fighter_key: v.fighter_key,
          fighter_name: v.fighter_name,
          division: v.division,
          points: Number(v.points) || 0,
          pi_amount: Number(v.pi_amount) || 0
        }));
      }
    } catch (err: any) {
      if (err.message && err.message.includes("Could not find the table")) {
        console.warn("[Database Service] 'votes' table not found in Supabase. Please copy and paste schema.sql contents into your Supabase SQL Editor. Falling back smoothly to local db.json.");
      } else {
        console.warn("[Database Service] Failed to fetch votes from Supabase, using local db.json fallback:", err.message);
      }
    }
  }
  
  // Local fallback
  const local = await readDB();
  return local.votes || [];
}

async function getUsers(): Promise<Pioneer[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("pioneers")
        .select("*")
        .order("registered_at", { ascending: true });
      if (error) throw error;
      if (data) {
        return data.map((p: any) => ({
          username: p.username,
          walletAddress: p.wallet_address || "Simulated Wallet Address",
          registeredAt: p.registered_at || new Date().toISOString(),
          uid: p.uid || ""
        }));
      }
    } catch (err: any) {
      if (err.message && err.message.includes("Could not find the table")) {
        console.warn("[Database Service] 'pioneers' table not found in Supabase. Please copy and paste schema.sql contents into your Supabase SQL Editor. Falling back smoothly to local db.json.");
      } else {
        console.warn("[Database Service] Failed to fetch pioneers from Supabase, using local db.json fallback:", err.message);
      }
    }
  }
  
  // Local fallback
  const local = await readDB();
  return (local as any).users || [];
}

async function registerUser(username: string, walletAddress: string, uid?: string): Promise<Pioneer> {
  let cleanUsername = username.trim();
  if (!cleanUsername.startsWith("@")) {
    cleanUsername = "@" + cleanUsername;
  }
  let cleanWallet = (walletAddress || "").trim() || "Simulated Wallet Address";
  let cleanUid = (uid || "").trim();
  
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: existing, error: findError } = await supabase
        .from("pioneers")
        .select("*")
        .eq("username", cleanUsername)
        .maybeSingle();
      
      if (findError) throw findError;
      
      if (existing) {
        let needsUpdate = false;
        const updateFields: any = {};
        
        if (cleanWallet !== "Simulated Wallet Address" && (!existing.wallet_address || existing.wallet_address === "Simulated Wallet Address")) {
          updateFields.wallet_address = cleanWallet;
          needsUpdate = true;
        }
        if (cleanUid && (!existing.uid || existing.uid !== cleanUid)) {
          updateFields.uid = cleanUid;
          needsUpdate = true;
        }

        if (needsUpdate) {
          const { data: updated, error: updateError } = await supabase
            .from("pioneers")
            .update(updateFields)
            .eq("username", cleanUsername)
            .select()
            .single();
          if (updateError) throw updateError;
          return {
            username: updated.username,
            walletAddress: updated.wallet_address,
            registeredAt: updated.registered_at,
            uid: updated.uid
          };
        }
        return {
          username: existing.username,
          walletAddress: existing.wallet_address,
          registeredAt: existing.registered_at,
          uid: existing.uid
        };
      }
      
      const userToInsert = {
        username: cleanUsername,
        wallet_address: cleanWallet,
        uid: cleanUid,
        registered_at: new Date().toISOString()
      };
      
      const { data: created, error: insertError } = await supabase
        .from("pioneers")
        .insert(userToInsert)
        .select()
        .single();
        
      if (insertError) throw insertError;
      return {
        username: created.username,
        walletAddress: created.wallet_address,
        registeredAt: created.registered_at,
        uid: created.uid
      };
    } catch (err: any) {
      if (err.message && err.message.includes("Could not find the table")) {
        console.warn("[Database Service] Could not register user on Supabase ('pioneers' table not found). Falling back to local db.json.");
      } else {
        console.warn("[Database Service] Supabase register error, taking local db.json fallback:", err.message);
      }
    }
  }
  
  // Local fallback
  const dbData = await readDB();
  if (!dbData.users) dbData.users = [];
  
  let localExisting = dbData.users.find(
    (u: any) => u.username.toLowerCase() === cleanUsername.toLowerCase()
  );
  
  if (localExisting) {
    let localUpdated = false;
    if (cleanWallet !== "Simulated Wallet Address" && (!localExisting.walletAddress || localExisting.walletAddress === "Simulated Wallet Address")) {
      localExisting.walletAddress = cleanWallet;
      localUpdated = true;
    }
    if (cleanUid && (!localExisting.uid || localExisting.uid !== cleanUid)) {
      localExisting.uid = cleanUid;
      localUpdated = true;
    }
    if (localUpdated) {
      await writeDB(dbData);
    }
    return localExisting;
  }
  
  const newUser = {
    username: cleanUsername,
    walletAddress: cleanWallet,
    registeredAt: new Date().toISOString(),
    uid: cleanUid
  };
  
  dbData.users.push(newUser);
  await writeDB(dbData);
  return newUser;
}

async function incrementVote(fighterId: string, fighterName: string, division: string, pointsDelta: number, piDelta: number): Promise<VoteEntry> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: existing, error: selectError } = await supabase
        .from("votes")
        .select("*")
        .eq("fighter_key", fighterId)
        .maybeSingle();
      
      if (selectError) throw selectError;
      
      if (existing) {
        const updatedPoints = (Number(existing.points) || 0) + pointsDelta;
        const updatedPi = (Number(existing.pi_amount) || 0) + piDelta;
        
        const { data: updated, error: updateError } = await supabase
          .from("votes")
          .update({
            points: updatedPoints,
            pi_amount: updatedPi
          })
          .eq("fighter_key", fighterId)
          .select()
          .single();
          
        if (updateError) throw updateError;
        
        return {
          fighter_key: updated.fighter_key,
          fighter_name: updated.fighter_name,
          division: updated.division,
          points: Number(updated.points) || 0,
          pi_amount: Number(updated.pi_amount) || 0
        };
      } else {
        const { data: created, error: insertError } = await supabase
          .from("votes")
          .insert({
            fighter_key: fighterId,
            fighter_name: fighterName || fighterId,
            division: division || "Unknown Class",
            points: pointsDelta,
            pi_amount: piDelta
          })
          .select()
          .single();
          
        if (insertError) throw insertError;
        
        return {
          fighter_key: created.fighter_key,
          fighter_name: created.fighter_name,
          division: created.division,
          points: Number(created.points) || 0,
          pi_amount: Number(created.pi_amount) || 0
        };
      }
    } catch (err: any) {
      if (err.message && err.message.includes("Could not find the table")) {
        console.warn("[Database Service] Could not increment vote on Supabase ('votes' table not found). Falling back to local db.json.");
      } else {
        console.warn("[Database Service] Supabase increment votes failed, falling back to db.json:", err.message);
      }
    }
  }
  
  // Local fallback
  const dbData = await readDB();
  if (!dbData.votes) dbData.votes = [];
  
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
  
  entry.points = (Number(entry.points) || 0) + pointsDelta;
  entry.pi_amount = (Number(entry.pi_amount) || 0) + piDelta;
  
  await writeDB(dbData);
  return entry;
}


app.use(express.json());

// Enable CORS for frontend requests like Vercel or local testing
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,content-type,Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Main official wallet address and API key from environment
const DEVELOPER_WALLET_ADDRESS = process.env.DEVELOPER_WALLET_ADDRESS || process.env.DEVELOPER_WALLET || "GB2YFUTVSBFPT6PPNSIEVKMHGSUAIS6X46DP6RUXFJ6FDNLFDB2X6MZ";
const PI_API_KEY = process.env.PI_NETWORK_API_KEY || process.env.PI_API_KEY || "";

// Serve the Pi validation-key.txt at the root
app.get("/validation-key.txt", async (req, res) => {
  try {
    const keyPath = path.join(process.cwd(), "validation-key.txt");
    res.sendFile(keyPath);
  } catch (err: any) {
    res.status(404).send("File not found");
  }
});

// App configuration endpoint (serves the backend's configured wallet address to avoid hardcodings)
app.get("/api/config", (req, res) => {
  res.json({
    developerWalletAddress: DEVELOPER_WALLET_ADDRESS
  });
});

// API endpoints
app.get("/api/get-votes", async (req, res) => {
  const votes = await getVotes();
  res.json({ votes, success: true });
});

app.get("/api/votes", async (req, res) => {
  const votes = await getVotes();
  res.json({ votes, success: true });
});

// Reset database endpoint to clear votes (Athlete points, Fan votes and Pi collected will all start fresh at 0)
app.all("/api/reset-database", async (req, res) => {
  try {
    // 1. Reset local db.json fallback
    const freshData = { votes: [], users: [] };
    await fs.writeFile(dbPath, JSON.stringify(freshData, null, 2), "utf-8");
    console.log("[Database Service] Reset local db.json successfully.");

    // 2. Reset Supabase database "votes" table if active
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase
        .from("votes")
        .delete()
        .neq("fighter_key", "force_all_rows_delete_trick");
      if (error) {
        console.warn("[Database Service] Supabase tables deletion error:", error.message);
      } else {
        console.log("[Database Service] Reset Supabase votes table successfully.");
      }
    }

    res.json({ success: true, message: "All points, fan votes, and Pi collected have been successfully reset to 0!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get registered users list
app.get("/api/users", async (req, res) => {
  const users = await getUsers();
  res.json(users);
});

// Register or Login a Pioneer
app.post("/api/register", async (req, res) => {
  let { username, walletAddress, uid, accessToken } = req.body;

  if (accessToken) {
    console.log("[Pi Network backend auth] Validating access token with api.minepi.com...");
    try {
      const response = await fetch("https://api.minepi.com/v2/me", {
        headers: {
          "Authorization": `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        console.warn("[Pi Network backend auth] Verification failed with status code " + response.status);
        res.status(401).json({ error: "Invalid Pi Network access token from minepi.com" });
        return;
      }
      const piMe = await response.json() as { uid: string; username: string };
      if (!piMe || !piMe.username) {
        res.status(401).json({ error: "Could not parse user information from Pi Network" });
        return;
      }
      console.log(`[Pi Network backend auth] Successfully validated token for @${piMe.username} (${piMe.uid})`);
      username = piMe.username;
      uid = piMe.uid;
    } catch (apiErr: any) {
      console.error("[Pi Auth Error] Failed verifying token:", apiErr.message);
      res.status(401).json({ error: "Pi authentication failed: " + apiErr.message });
      return;
    }
  }

  if (!username) {
    res.status(400).json({ error: "Username is required" });
    return;
  }

  try {
    const user = await registerUser(username, walletAddress || "", uid || "");
    res.status(200).json({ success: true, user, status: "registered" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Disable direct, unverified votes updates
app.post("/api/votes", (req, res) => {
  res.status(403).json({
    error: "Direct vote updates are prohibited. All votes must be validated through /api/verify-payment."
  });
});

// Secure endpoint for verifying payments
app.post("/api/verify-payment", async (req, res) => {
  const { paymentId, txid, fighterId, fighterName, division } = req.body;

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
      // 1. If txid is provided, try to auto-complete the payment first on Pi Network
      if (txid) {
        try {
          console.log(`[Verify API] Attempting auto-completion for payment ${paymentId} with transaction ${txid}`);
          const completeResponse = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
            method: "POST",
            headers: {
              "Authorization": `Key ${PI_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ txid })
          });
          if (completeResponse.ok) {
            console.log(`[Verify API] Successfully completed payment ${paymentId} with txid ${txid}`);
          } else {
            console.log(`[Verify API] Complete response status: ${completeResponse.status}. (Could be already completed)`);
          }
        } catch (compErr: any) {
          console.warn("[Verify API] Server-initiated completion attempt encountered a non-blocking error:", compErr.message);
        }
      }

      // 2. Fetch the verified status of the payment from Pi API
      const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}`, {
        headers: {
          "Authorization": `Key ${PI_API_KEY}`
        }
      });

      if (!response.ok) {
        throw new Error(`Pi APIs responded with HTTP status ${response.status}`);
      }

      const pmtData: any = await response.json();
      console.log(`[Verify API] Received payments data from Pi Network API:`, JSON.stringify(pmtData));

      // Criteria (a): Transaction state completed or approved/signed
      const isCompleted = pmtData.status === "completed" || 
                          pmtData.state === "completed" ||
                          (pmtData.status && (
                            pmtData.status.developer_completed === true || 
                            pmtData.status.developer_approved === true ||
                            pmtData.status.transaction_verified === true
                          )) ||
                          (pmtData.transaction && pmtData.transaction.verified === true);

      // Criteria (b): Exact size is 1.0 Pi (with float tolerance check)
      const parsedAmount = pmtData.amount !== undefined ? Number(pmtData.amount) : 0;
      const isAmountValid = Math.abs(parsedAmount - 1.0) < 0.01;

      // Criteria (c): Destination is official wallet (check both to_address and recipient fields)
      const actualRecipient = (
        pmtData.to_address || 
        pmtData.recipient || 
        pmtData.recipient_address ||
        (pmtData.transaction && pmtData.transaction.recipient) ||
        (pmtData.transaction && pmtData.transaction.to_address) ||
        ""
      ).toString().trim();

      const isRecipientValid = actualRecipient && actualRecipient.toLowerCase() === DEVELOPER_WALLET_ADDRESS.toLowerCase();

      if (!isCompleted) {
        validationError = "Pi Network transaction is not completed or approved yet on blockchain";
      } else if (!isAmountValid) {
        validationError = `Transaction amount mismatch: expected 1.0, got ${pmtData.amount || parsedAmount}`;
      } else if (!isRecipientValid) {
        validationError = `Recipient wallet mismatch: expected ${DEVELOPER_WALLET_ADDRESS}, got ${actualRecipient || "undefined"}`;
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

  // Add the verified vote and increment by 100 points and 1.0 Pi
  try {
    const entry = await incrementVote(fighterId, fighterName, division, 100, 1);
    res.status(200).json({ success: true, entry });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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

// --- PAYOUT UTILITIES & ENDPOINTS (Pi Checklist Step 10 compliance) ---
async function getPayouts(): Promise<any[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("payouts")
        .select("*")
        .order("completed_at", { ascending: false });
      if (error) throw error;
      if (data) {
        return data.map((p: any) => ({
          paymentId: p.payment_id,
          txid: p.txid,
          recipientUid: p.recipient_uid,
          amount: Number(p.amount) || 0,
          memo: p.memo,
          status: p.status,
          completedAt: p.completed_at
        }));
      }
    } catch (err: any) {
      if (err.message && err.message.includes("Could not find the table")) {
        console.warn("[Database Service] 'payouts' table not found in Supabase. Falling back smoothly to local db.json.");
      } else {
        console.warn("[Database Service] Failed to fetch payouts from Supabase:", err.message);
      }
    }
  }

  // Local fallback
  const local = await readDB();
  return (local as any).payouts || [];
}

async function savePayoutToDB(payout: any): Promise<void> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase
        .from("payouts")
        .insert({
          payment_id: payout.paymentId,
          txid: payout.txid,
          recipient_uid: payout.recipientUid,
          amount: payout.amount,
          memo: payout.memo,
          status: payout.status,
          completed_at: payout.completedAt
        });
      if (!error) {
        console.log("[Database Service] Payout stored successfully in Supabase.");
        return;
      }
      throw error;
    } catch (err: any) {
      console.warn("[Database Service] Supabase store payout error, saving to db.json fallback:", err.message);
    }
  }

  // Local fallback
  const dbData = await readDB() as any;
  if (!dbData.payouts) dbData.payouts = [];
  dbData.payouts.push(payout);
  await writeDB(dbData);
  console.log("[Database Service] Payout stored successfully in local db.json.");
}

// Endpoint to list payouts history
app.get("/api/payouts", async (req, res) => {
  try {
    const payouts = await getPayouts();
    res.json({ success: true, payouts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to execute App-to-User payouts directly from backend
app.post("/api/payout", async (req, res) => {
  const { uid, amount, memo } = req.body;

  if (!uid || !amount) {
    res.status(400).json({ error: "uid and amount are required parameters" });
    return;
  }

  // Simulation mode fallback
  if (!PI_API_KEY || uid.startsWith("demo_") || uid.includes("sandbox")) {
    console.log(`[Pi Sandbox Payout] Simulating payout of ${amount} to uid: ${uid}`);
    const mockTxid = "GAUX" + Math.random().toString(36).substring(2, 10).toUpperCase() + "SIMULATEDPAYOUT";
    const mockPaymentId = "payout_" + Math.random().toString(36).substring(2, 12);
    
    const mockPayout = {
      paymentId: mockPaymentId,
      txid: mockTxid,
      recipientUid: uid,
      amount: Number(amount),
      memo: memo || "Developer test payout",
      status: "completed",
      completedAt: new Date().toISOString()
    };

    try {
      await savePayoutToDB(mockPayout);
      res.json({
        success: true,
        paymentId: mockPaymentId,
        txid: mockTxid,
        state: "completed",
        message: "Sandbox payout simulated and cached successfully!"
      });
    } catch (saveErr: any) {
      res.status(500).json({ error: `Simulated payout saved failed: ${saveErr.message}` });
    }
    return;
  }

  try {
    console.log(`[Payout API] POST /v2/payments for payout amount: ${amount}, uid: ${uid}`);
    
    // Step 1: Create the payment on Pi Platform Server
    const createResponse = await fetch("https://api.minepi.com/v2/payments", {
      method: "POST",
      headers: {
        "Authorization": `Key ${PI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        payment: {
          amount: Number(amount),
          memo: memo || "Developer test payout",
          metadata: { direction: "app_to_user" },
          uid: uid
        }
      })
    });

    if (!createResponse.ok) {
      const errText = await createResponse.text();
      throw new Error(`Pi APIs creation failed (status ${createResponse.status}): ${errText}`);
    }

    const pmtData: any = await createResponse.json();
    const paymentId = pmtData.id;
    console.log(`[Payout API] Payout created. ID: ${paymentId}. Approving next...`);

    // Step 2: Server-Side Approval
    const approveResponse = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${PI_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!approveResponse.ok) {
      const errText = await approveResponse.text();
      throw new Error(`Pi APIs approval failed (status ${approveResponse.status}): ${errText}`);
    }
    console.log(`[Payout API] Payout Approved. Completing/Submitting next...`);

    // Step 3: Server-Side Completion (triggers blockchain transaction)
    const completeResponse = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${PI_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!completeResponse.ok) {
      const errText = await completeResponse.text();
      throw new Error(`Pi APIs completion failed (status ${completeResponse.status}): ${errText}`);
    }

    const completeData: any = await completeResponse.json();
    const txid = completeData.transaction?.txid || completeData.txid || "payout_blockchain_txid";
    console.log(`[Payout API] Completed. Transaction TxID: ${txid}`);

    // Save payout details in the database
    const payoutRecord = {
      paymentId: paymentId,
      txid: txid,
      recipientUid: uid,
      amount: Number(amount),
      memo: memo || "Developer test payout",
      status: "completed",
      completedAt: new Date().toISOString()
    };

    await savePayoutToDB(payoutRecord);

    res.json({
      success: true,
      paymentId: paymentId,
      txid: txid,
      state: "completed",
      message: "App-to-User Payout completed and verified in sandbox blockchain!"
    });

  } catch (error: any) {
    console.error("[Payout API Failure]:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Dedicated standalone routes to pass Pi Network Core Team portal moderation:
// App's Privacy Policy URL and App's Terms of Service URL
function servePolicyFile(res: any, fileName: string) {
  const possiblePaths = [
    path.join(process.cwd(), "dist", fileName),
    path.join(process.cwd(), "dist", fileName.replace(".html", ""), "index.html"),
    path.join(process.cwd(), "public", fileName),
    path.join(process.cwd(), "public", fileName.replace(".html", ""), "index.html")
  ];

  async function tryNext(index: number) {
    if (index >= possiblePaths.length) {
      res.status(404).send(`<h1>404 Not Found</h1><p>Could not load ${fileName}. Please contact support.</p>`);
      return;
    }
    const currentPath = possiblePaths[index];
    try {
      await fs.access(currentPath);
      res.sendFile(currentPath);
    } catch {
      tryNext(index + 1);
    }
  }

  tryNext(0);
}

app.get(["/privacy", "/privacy.html"], (req, res) => {
  servePolicyFile(res, "privacy.html");
});

app.get(["/terms", "/terms.html"], (req, res) => {
  servePolicyFile(res, "terms.html");
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
