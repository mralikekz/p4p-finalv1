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

// API endpoints
app.get("/api/votes", async (req, res) => {
  const dbData = await readDB();
  res.json(dbData);
});

app.post("/api/votes", async (req, res) => {
  const { fighter_key, points, pi_amount, base_points } = req.body;
  
  if (!fighter_key) {
    res.status(400).json({ error: "fighter_key is required" });
    return;
  }

  const dbData = await readDB();
  if (!dbData.votes) {
    dbData.votes = [];
  }

  let entry = dbData.votes.find((v: any) => v.fighter_key === fighter_key);
  if (!entry) {
    entry = {
      fighter_key,
      fighter_name: req.body.fighter_name || fighter_key,
      division: req.body.division || "Unknown",
      points: Number(base_points) || 0,
      pi_amount: 0
    };
    dbData.votes.push(entry);
  }

  entry.points = (Number(entry.points) || 0) + (Number(points) || 100);
  entry.pi_amount = (Number(entry.pi_amount) || 0) + (Number(pi_amount) || 1);

  await writeDB(dbData);
  res.json({ success: true, entry });
});

app.post("/api/approve", (req, res) => {
  res.json({ approved: true });
});

app.post("/api/complete", (req, res) => {
  res.json({ completed: true });
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
