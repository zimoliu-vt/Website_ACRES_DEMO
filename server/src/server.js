import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const jwtSecret = process.env.JWT_SECRET;
const demoPin = process.env.DEMO_PIN || "0000";

if (!jwtSecret || jwtSecret.length < 24) throw new Error("JWT_SECRET must contain at least 24 characters");

app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));

const seedReports = [
  { id: "WC-1043", animal: "Bird", condition: "Unable to move or fly", notes: "A small green bird is on the grass beside the footpath. It tries to hop but cannot fly.", reporter: "Mei", contact: "", lat: 1.3048, lng: 103.8318, area: "Singapore Botanic Gardens", status: "New", createdAt: Date.now() - 720000 },
  { id: "WC-1042", animal: "Reptile", condition: "In an unsafe location", notes: "Monitor lizard resting close to the park connector where bicycles are passing.", reporter: "Anonymous", contact: "", lat: 1.3197, lng: 103.9237, area: "Bedok Reservoir", status: "Acknowledged", createdAt: Date.now() - 2880000 },
  { id: "WC-1041", animal: "Mammal", condition: "Injured or bleeding", notes: "Macaque has a visible wound on its rear leg and is staying apart from the group.", reporter: "Daniel", contact: "", lat: 1.3505, lng: 103.7764, area: "Bukit Timah Nature Reserve", status: "Assigned", createdAt: Date.now() - 8640000 },
  { id: "WC-1040", animal: "Bird", condition: "Trapped or entangled", notes: "Bird caught in loose netting near a community garden fence.", reporter: "Priya", contact: "", lat: 1.3711, lng: 103.8451, area: "Bishan–Ang Mo Kio Park", status: "Resolved", createdAt: Date.now() - 93600000 }
].map(report => ({ ...report, history: [{ label: "Report submitted", at: report.createdAt }] }));

async function initialiseDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id text PRIMARY KEY,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS volunteers (
      id text PRIMARY KEY,
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const { rows } = await pool.query("SELECT count(*)::int AS count FROM reports");
  if (rows[0].count === 0) {
    await seedDatabase();
  }
}

async function seedDatabase() {
  for (const report of seedReports) {
    await pool.query("INSERT INTO reports (id, payload) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, updated_at = now()", [report.id, report]);
  }
}

function requireWorker(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  try {
    const claims = jwt.verify(token || "", jwtSecret);
    if (claims.role !== "worker") throw new Error("Invalid role");
    next();
  } catch {
    response.status(401).json({ error: "Worker authentication required" });
  }
}

function isWorkerRequest(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  try {
    return jwt.verify(token || "", jwtSecret).role === "worker";
  } catch {
    return false;
  }
}

function publicReport(report) {
  const { contact, reporter, photo, volunteerPhoto, ...safe } = report;
  return { ...safe, reporter: reporter ? "Name hidden" : "Anonymous", hasPhoto: Boolean(photo), hasVolunteerPhoto: Boolean(volunteerPhoto) };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get("/health", async (_request, response) => {
  await pool.query("SELECT 1");
  response.json({ ok: true, service: "wildcare-demo-api" });
});

app.get("/reports", async (request, response) => {
  const { rows } = await pool.query("SELECT payload FROM reports ORDER BY created_at DESC");
  const reports = rows.map(row => row.payload);
  response.json(isWorkerRequest(request) ? reports : reports.map(publicReport));
});

app.post("/reports", async (request, response) => {
  const report = request.body;
  if (!report || !report.animal || !report.condition || !report.notes || !Number.isFinite(Number(report.lat)) || !Number.isFinite(Number(report.lng))) {
    return response.status(400).json({ error: "Missing required report fields" });
  }
  const { rows } = await pool.query("SELECT coalesce(max(substring(id from 4)::int), 1000) + 1 AS next FROM reports WHERE id ~ '^WC-[0-9]+$'");
  const now = Date.now();
  const saved = { ...report, id: `WC-${rows[0].next}`, status: "New", createdAt: now, history: [{ label: "Report submitted", at: now }] };
  await pool.query("INSERT INTO reports (id, payload) VALUES ($1, $2)", [saved.id, saved]);
  response.status(201).json(saved);
});

app.put("/reports/:id", async (request, response) => {
  const report = { ...request.body, id: request.params.id };
  const result = await pool.query("UPDATE reports SET payload = $2, updated_at = now() WHERE id = $1 RETURNING payload", [request.params.id, report]);
  if (!result.rowCount) return response.status(404).json({ error: "Report not found" });
  response.json(result.rows[0].payload);
});

app.post("/reports/reset", requireWorker, async (_request, response) => {
  await pool.query("DELETE FROM reports");
  await seedDatabase();
  const { rows } = await pool.query("SELECT payload FROM reports ORDER BY created_at DESC");
  response.json(rows.map(row => row.payload));
});

app.post("/auth/worker", (request, response) => {
  if (!safeEqual(request.body?.pin || "", demoPin)) return response.status(401).json({ error: "Incorrect demo PIN" });
  response.json({ token: jwt.sign({ role: "worker" }, jwtSecret, { expiresIn: "8h" }) });
});

app.put("/volunteers/:id", async (request, response) => {
  const volunteer = { ...request.body, id: request.params.id };
  await pool.query(`INSERT INTO volunteers (id, payload) VALUES ($1, $2)
    ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, updated_at = now()`, [volunteer.id, volunteer]);
  response.json(volunteer);
});

app.delete("/volunteers/:id", async (request, response) => {
  await pool.query("DELETE FROM volunteers WHERE id = $1", [request.params.id]);
  response.status(204).end();
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "The demo backend could not complete this request" });
});

await initialiseDatabase();
app.listen(port, "0.0.0.0", () => console.log(`WildCare demo API listening on ${port}`));

