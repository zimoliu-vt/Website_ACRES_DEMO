import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const baseUrl = process.env.WILDCARE_BASE_URL || "https://wildcare.liuzimo.cn";
const imagePath = process.env.JEV_TEST_IMAGE;
if (!imagePath) throw new Error("Set JEV_TEST_IMAGE to a local JPEG, PNG, or WebP animal photo.");

const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const mimeType = mimeTypes[extname(imagePath).toLowerCase()];
if (!mimeType) throw new Error("JEV_TEST_IMAGE must be a JPEG, PNG, or WebP file.");

const image = `data:${mimeType};base64,${(await readFile(imagePath)).toString("base64")}`;
const response = await fetch(`${baseUrl}/api/analyze-animal`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ image })
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`JEV test failed (${response.status}): ${result.error || "Unknown error"}`);
for (const field of ["isAnimal", "animal", "condition", "rescueNeeded", "rescueProbability"]) {
  if (!(field in result)) throw new Error(`JEV response is missing ${field}.`);
}
console.log(`JEV test passed: animal=${result.animal}, condition=${result.condition}, rescueNeeded=${result.rescueNeeded}, confidence=${Math.round(Number(result.rescueProbability) * 100)}%`);
