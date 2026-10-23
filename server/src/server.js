import crypto from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import jwt from "jsonwebtoken";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const jwtSecret = process.env.JWT_SECRET;
const demoPin = process.env.DEMO_PIN || "0000";
const jevApiKey = process.env.JEV_API_KEY || "";
const jevModel = process.env.JEV_MODEL || "jev-preview";
const scrypt = promisify(crypto.scrypt);
const analysisRequests = new Map();

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
      request_key text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS request_key text;
    CREATE UNIQUE INDEX IF NOT EXISTS reports_request_key_idx ON reports(request_key) WHERE request_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS volunteers (
      id text PRIMARY KEY,
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id text PRIMARY KEY,
      username text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL CHECK (role IN ('volunteer', 'worker')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const { rows } = await pool.query("SELECT count(*)::int AS count FROM reports");
  if (rows[0].count === 0) {
    await seedDatabase();
  }
}

function normaliseUsername(value) {
  return String(value || "").trim().toLowerCase();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, saltHex, hashHex] = String(encoded).split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function volunteerToken(id) {
  return jwt.sign({ sub: id, role: "volunteer" }, jwtSecret, { expiresIn: "30d" });
}

function requireVolunteerOwner(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  try {
    const claims = jwt.verify(token || "", jwtSecret);
    if (claims.role !== "worker" && (claims.role !== "volunteer" || claims.sub !== request.params.id)) throw new Error("Invalid account");
    next();
  } catch {
    response.status(401).json({ error: "Please sign in to manage this volunteer profile" });
  }
}

function requireVolunteer(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  try {
    const claims = jwt.verify(token || "", jwtSecret);
    if (claims.role !== "volunteer" || !claims.sub) throw new Error("Invalid account");
    request.auth = claims;
    next();
  } catch {
    response.status(401).json({ error: "Volunteer sign-in required" });
  }
}

function reportResponders(report) {
  if (Array.isArray(report.responders)) return report.responders;
  if (!report.volunteerId) return [];
  return [{
    id: report.volunteerId,
    name: report.volunteerName || "Volunteer",
    status: report.volunteerStatus || "On the way",
    offeredAt: report.volunteerOfferedAt || report.volunteerArrivedAt || Date.now(),
    arrivedAt: report.volunteerArrivedAt || null
  }];
}

function applyResponders(report, responders) {
  report.responders = responders;
  const first = responders[0];
  if (first) {
    report.volunteerId = first.id;
    report.volunteerName = first.name;
    report.volunteerStatus = responders.length > 1 ? `${responders.length} volunteers responding` : first.status;
    report.volunteerArrivedAt = first.arrivedAt || null;
  } else {
    delete report.volunteerId;
    delete report.volunteerName;
    delete report.volunteerStatus;
    delete report.volunteerArrivedAt;
  }
  return report;
}

function addHistory(report, label) {
  report.history = Array.isArray(report.history) ? report.history : [{ label: "Report submitted", at: report.createdAt }];
  report.history.push({ label, at: Date.now() });
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
  const { contact, reporter, photo, volunteerPhoto, clientRequestId, ...safe } = report;
  const responders = Array.isArray(safe.responders)
    ? safe.responders.map(({ experience, experienceDetails, animalPreferences, ...responder }) => responder)
    : safe.responders;
  return { ...safe, responders, reporter: reporter ? "Name hidden" : "Anonymous", hasPhoto: Boolean(photo), hasVolunteerPhoto: Boolean(volunteerPhoto) };
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

app.post("/analyze-animal", async (request, response) => {
  if (!jevApiKey) return response.status(503).json({ error: "Jev image analysis is not configured yet" });
  const now = Date.now();
  const address = request.ip || request.socket.remoteAddress || "unknown";
  const recent = (analysisRequests.get(address) || []).filter(timestamp => now - timestamp < 60000);
  if (recent.length >= 10) return response.status(429).json({ error: "Too many image checks. Please wait a minute and try again." });
  recent.push(now);
  analysisRequests.set(address, recent);

  const match = String(request.body?.image || "").match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return response.status(400).json({ error: "Use a JPEG or PNG photo" });
  if (match[2].length > 3_500_000) return response.status(413).json({ error: "The photo is too large" });
  const format = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const jevResponse = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${jevApiKey}`,
        "Content-Type": "application/json",
        "TypeSafe-Danger-Zone-Images": "true"
      },
      body: JSON.stringify({
        model: jevModel,
        state: "animal_photo",
        assets: { animal_photo: { type: "image", format, data_base64: match[2] } },
        questions: {
          animal_present: {
            type: "noul",
            instructions: "Does animal_photo clearly contain a real animal as the main subject?",
            criteria: { true: "A real living or deceased animal is visible", false: "No animal is visible, or this is a drawing, toy, screen, or unclear image" }
          },
          animal_type: {
            type: "choice",
            instructions: "Which broad animal group best matches the animal visible in animal_photo?",
            criteria: { Bird: "A bird", Mammal: "A mammal", Reptile: "A reptile", Other: "Another animal type or too unclear to classify" }
          },
          condition: {
            type: "choice",
            instructions: "Which visible condition best matches animal_photo? Choose Not sure unless the visual evidence is clear.",
            criteria: {
              "Injured or bleeding": "A visible wound, injury, or bleeding",
              "Unable to move or fly": "The animal visibly cannot move normally or fly",
              "Trapped or entangled": "The animal is visibly trapped or entangled",
              "Young animal alone": "A visibly young animal appears alone",
              "In an unsafe location": "The animal is in immediate environmental danger such as traffic",
              "Not sure": "The condition cannot be safely determined from the image"
            }
          }
        }
      })
    });
    const payload = await jevResponse.json().catch(() => ({}));
    if (!jevResponse.ok) return response.status(502).json({ error: payload.detail || payload.error || "Jev could not analyze this photo" });
    const animalProbability = Number(payload.answers?.animal_present?.noul || 0);
    const animalType = payload.answers?.animal_type;
    const condition = payload.answers?.condition;
    response.json({
      isAnimal: animalProbability >= 0.65,
      animalProbability,
      animal: animalType?.choice || "Other",
      animalConfidence: Number(animalType?.confidence || 0),
      condition: condition?.choice || "Not sure",
      conditionConfidence: Number(condition?.confidence || 0),
      model: payload.model || jevModel
    });
  } catch (error) {
    response.status(error.name === "AbortError" ? 504 : 502).json({ error: error.name === "AbortError" ? "Jev took too long to respond" : "Jev image analysis is temporarily unavailable" });
  } finally {
    clearTimeout(timeout);
  }
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
  const requestKey = typeof report.clientRequestId === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(report.clientRequestId) ? report.clientRequestId : null;
  if (requestKey) {
    const existing = await pool.query("SELECT payload FROM reports WHERE request_key = $1", [requestKey]);
    if (existing.rows[0]) return response.json(existing.rows[0].payload);
  }
  const { rows } = await pool.query("SELECT coalesce(max(substring(id from 4)::int), 1000) + 1 AS next FROM reports WHERE id ~ '^WC-[0-9]+$'");
  const now = Date.now();
  const saved = { ...report, id: `WC-${rows[0].next}`, status: "New", createdAt: now, history: [{ label: "Report submitted", at: now }] };
  try {
    await pool.query("INSERT INTO reports (id, payload, request_key) VALUES ($1, $2, $3)", [saved.id, saved, requestKey]);
  } catch (error) {
    if (requestKey && error.code === "23505") {
      const existing = await pool.query("SELECT payload FROM reports WHERE request_key = $1", [requestKey]);
      if (existing.rows[0]) return response.json(existing.rows[0].payload);
    }
    throw error;
  }
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

app.post("/auth/volunteer-signup", async (request, response) => {
  const username = normaliseUsername(request.body?.username);
  const password = String(request.body?.password || "");
  const profile = request.body?.profile;
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return response.status(400).json({ error: "Use 3–32 letters, numbers, dots, dashes, or underscores for the username" });
  if (password.length < 10 || password.length > 128) return response.status(400).json({ error: "Password must contain 10–128 characters" });
  if (!profile?.name || !profile?.contact || !Number.isFinite(Number(profile?.lat)) || !Number.isFinite(Number(profile?.lng))) return response.status(400).json({ error: "Complete all volunteer profile fields" });
  if (!Array.isArray(profile?.experience) || profile.experience.length === 0) return response.status(400).json({ error: "Select at least one type of animal medical, care, or handling experience" });
  if (!Number.isFinite(profile?.demoAgreementAcceptedAt) || profile.demoAgreementAcceptedAt <= 0) return response.status(400).json({ error: "You must agree that this is strictly a demo and no travel or real-world action is required" });

  const id = crypto.randomUUID();
  const saved = { ...profile, id, username };
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO accounts (id, username, password_hash, role) VALUES ($1, $2, $3, 'volunteer')", [id, username, passwordHash]);
    await client.query("INSERT INTO volunteers (id, payload) VALUES ($1, $2)", [id, saved]);
    await client.query("COMMIT");
    response.status(201).json({ token: volunteerToken(id), volunteer: saved });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return response.status(409).json({ error: "That username is already in use" });
    throw error;
  } finally {
    client.release();
  }
});

app.post("/auth/volunteer-signin", async (request, response) => {
  const username = normaliseUsername(request.body?.username);
  const password = String(request.body?.password || "");
  const { rows } = await pool.query("SELECT id, password_hash FROM accounts WHERE username = $1 AND role = 'volunteer'", [username]);
  if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) return response.status(401).json({ error: "Incorrect username or password" });
  const volunteerResult = await pool.query("SELECT payload FROM volunteers WHERE id = $1", [rows[0].id]);
  if (!volunteerResult.rows[0]) return response.status(404).json({ error: "Volunteer profile not found" });
  response.json({ token: volunteerToken(rows[0].id), volunteer: volunteerResult.rows[0].payload });
});

app.post("/reports/:id/volunteer-offer", requireVolunteer, async (request, response) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const allResult = await client.query("SELECT id, payload FROM reports WHERE payload->>'status' <> 'Resolved' FOR UPDATE");
    const targetRow = allResult.rows.find(row => row.id === request.params.id);
    if (!targetRow) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Active case not found" });
    }
    const existingCase = allResult.rows.find(row => reportResponders(row.payload).some(item => item.id === request.auth.sub));
    if (existingCase && existingCase.id !== request.params.id) {
      await client.query("ROLLBACK");
      return response.status(409).json({ error: `You are already responding to ${existingCase.id}. Cancel that response before choosing another case.` });
    }
    const responders = reportResponders(targetRow.payload);
    if (responders.some(item => item.id === request.auth.sub)) {
      await client.query("COMMIT");
      return response.json(targetRow.payload);
    }
    if (responders.length >= 3) {
      await client.query("ROLLBACK");
      return response.status(409).json({ error: "This case already has three volunteers" });
    }
    const volunteerResult = await client.query("SELECT payload FROM volunteers WHERE id = $1", [request.auth.sub]);
    const profile = volunteerResult.rows[0]?.payload || {};
    const name = profile.name || "Volunteer";
    responders.push({
      id: request.auth.sub,
      name,
      status: "On the way",
      offeredAt: Date.now(),
      arrivedAt: null,
      experience: Array.isArray(profile.experience) ? profile.experience : [],
      experienceDetails: String(profile.experienceDetails || "").slice(0, 240),
      animalPreferences: Array.isArray(profile.animalPreferences) ? profile.animalPreferences : []
    });
    const report = applyResponders(targetRow.payload, responders);
    if (report.status === "New") report.status = "Acknowledged";
    addHistory(report, `${name} offered to observe`);
    await client.query("UPDATE reports SET payload = $2, updated_at = now() WHERE id = $1", [request.params.id, report]);
    await client.query("COMMIT");
    response.json(report);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
});

app.post("/reports/:id/volunteer-cancel", requireVolunteer, async (request, response) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT payload FROM reports WHERE id = $1 FOR UPDATE", [request.params.id]);
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Case not found" });
    }
    const report = result.rows[0].payload;
    const responders = reportResponders(report);
    const leaving = responders.find(item => item.id === request.auth.sub);
    if (!leaving) {
      await client.query("ROLLBACK");
      return response.status(409).json({ error: "You are not assigned to this case" });
    }
    applyResponders(report, responders.filter(item => item.id !== request.auth.sub));
    if (report.responders.length === 0 && report.status === "Acknowledged") report.status = "New";
    addHistory(report, `${leaving.name} cancelled their response`);
    await client.query("UPDATE reports SET payload = $2, updated_at = now() WHERE id = $1", [request.params.id, report]);
    await client.query("COMMIT");
    response.json(report);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
});

app.post("/reports/:id/volunteer-arrive", requireVolunteer, async (request, response) => {
  const result = await pool.query("SELECT payload FROM reports WHERE id = $1", [request.params.id]);
  if (!result.rows[0]) return response.status(404).json({ error: "Case not found" });
  const report = result.rows[0].payload;
  const responders = reportResponders(report);
  const responder = responders.find(item => item.id === request.auth.sub);
  if (!responder) return response.status(409).json({ error: "You are not assigned to this case" });
  responder.status = "Arrived";
  responder.arrivedAt = Date.now();
  applyResponders(report, responders);
  addHistory(report, `${responder.name} arrived nearby`);
  await pool.query("UPDATE reports SET payload = $2, updated_at = now() WHERE id = $1", [request.params.id, report]);
  response.json(report);
});

app.put("/volunteers/:id", requireVolunteerOwner, async (request, response) => {
  const volunteer = { ...request.body, id: request.params.id };
  await pool.query(`INSERT INTO volunteers (id, payload) VALUES ($1, $2)
    ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, updated_at = now()`, [volunteer.id, volunteer]);
  response.json(volunteer);
});

app.delete("/volunteers/:id", requireVolunteerOwner, async (request, response) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM volunteers WHERE id = $1", [request.params.id]);
    await client.query("DELETE FROM accounts WHERE id = $1", [request.params.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  response.status(204).end();
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "The demo backend could not complete this request" });
});

await initialiseDatabase();
app.listen(port, "0.0.0.0", () => console.log(`WildCare demo API listening on ${port}`));

