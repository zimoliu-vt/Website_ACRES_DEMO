import { expect, test } from "@playwright/test";

const reports = [
  { id: "WC-2003", animal: "Bird", condition: "Unable to move or fly", notes: "Demo bird", reporter: "Name hidden", lat: 1.3048, lng: 103.8318, area: "Botanic Gardens", status: "New", createdAt: 1700000003000, history: [{ label: "Report submitted", at: 1700000003000 }] },
  { id: "WC-2002", animal: "Reptile", condition: "In an unsafe location", notes: "Demo reptile", reporter: "Anonymous", lat: 1.3197, lng: 103.9237, area: "Bedok Reservoir", status: "Acknowledged", volunteerStatus: "On the way", responders: [{ id: "vol-1", name: "Demo Volunteer", status: "On the way" }], createdAt: 1700000002000, history: [{ label: "Report submitted", at: 1700000002000 }] },
  { id: "WC-2001", animal: "Mammal", condition: "Injured or bleeding", notes: "Closed demo case", reporter: "Name hidden", lat: 1.3505, lng: 103.7764, area: "Bukit Timah", status: "Resolved", createdAt: 1700000001000, history: [{ label: "Report submitted", at: 1700000001000 }] }
];

async function mockBackend(page) {
  await page.route("**/api/reports", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reports) }));
  await page.route("**/api/auth/worker", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "demo-worker-token" }) }));
}

async function enterDemo(page) {
  await page.addInitScript(() => sessionStorage.setItem("wildcare-demo-warning-ack-v1", "true"));
  await page.goto(`/?deployment-test=${Date.now()}`);
}

async function openTeam(page) {
  await page.getByRole("link", { name: /Rescue team sign-in|Team dashboard/ }).click();
  await page.getByLabel("Demo PIN").fill("0000");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Wildlife reports" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test("report flow explains requirements and protects a changed draft", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: /Choose a location/ }).click();
  await expect(page.getByLabel("Search for a location in Singapore")).toBeFocused();
  await page.locator("#map").click();

  await expect(page.getByText("Step 2 of 3 · report details")).toBeVisible();
  await expect(page.getByLabel("Open camera or choose an animal photo")).toBeAttached();
  await expect(page.getByRole("button", { name: /Send demo report/ })).toBeDisabled();

  await page.getByRole("button", { name: /Fill a random demo report/ }).click();
  await expect(page.getByRole("button", { name: /Send demo report/ })).toBeEnabled();

  page.once("dialog", async dialog => {
    expect(dialog.message()).toContain("Discard this unfinished demo report?");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Your name (optional)")).toHaveValue("Random");
});

test("photo uploads are normalized to dimensions accepted by Jev", async ({ page }) => {
  await page.route("**/api/analyze-animal", async route => {
    const image = JSON.parse(route.request().postData() || "{}").image;
    expect(image).toMatch(/^data:image\/jpeg;base64,/);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ isAnimal: true, animal: "Other", animalConfidence: .9, condition: "Not sure", conditionConfidence: .9, rescueNeeded: false, rescueProbability: .1, model: "test" })
    });
  });
  await enterDemo(page);
  await page.getByRole("button", { name: /Choose a location/ }).click();
  await page.locator("#map").click();
  await page.getByLabel("Open camera or choose an animal photo").setInputFiles({
    name: "tiny image with spaces.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKAAAAAASUVORK5CYII=", "base64")
  });
  await expect(page.locator("#jev-analysis")).toContainText("Jev found an animal");
  await expect.poll(() => page.locator("#photo-preview-image").evaluate(image => [image.naturalWidth, image.naturalHeight])).toEqual([768, 768]);
});

test("choosing a searched area switches the reporting map to satellite", async ({ page }) => {
  await page.route("https://nominatim.openstreetmap.org/search?**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ lat: "1.3640", lon: "103.8460", name: "Bishan–Ang Mo Kio Park", display_name: "Bishan–Ang Mo Kio Park, Bishan, Singapore", address: { country_code: "sg", park: "Bishan–Ang Mo Kio Park", suburb: "Bishan" } }])
  }));
  await enterDemo(page);
  await page.getByLabel("Search for a location in Singapore").fill("Bishan park");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /Bishan–Ang Mo Kio Park/ }).click();
  await expect(page.getByRole("button", { name: "Satellite" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('img[src*="World_Transportation"]')).not.toHaveCount(0);
  await expect(page.locator('img[src*="World_Boundaries_and_Places"]')).not.toHaveCount(0);
  await expect(page.locator("#map-hint")).toContainText("click the animal’s exact location");
});

test("team filters keep the visible list and detail panel synchronized", async ({ page }) => {
  await enterDemo(page);
  await openTeam(page);

  await page.getByRole("tab", { name: "Closed" }).click();
  await expect(page.getByRole("heading", { name: "Closed reports" })).toBeVisible();
  await expect(page.locator('[data-report-id="WC-2001"]')).toBeVisible();
  await expect(page.locator('[data-report-id="WC-2002"]')).toHaveCount(0);
  await expect(page.locator("#detail-panel")).toContainText("WC-2001");
  await expect(page.locator("#detail-panel")).not.toContainText("WC-2002");

  await page.getByRole("tab", { name: "Volunteers" }).click();
  await expect(page.getByRole("heading", { name: "Reports with volunteers" })).toBeVisible();
  await expect(page.locator('[data-report-id="WC-2002"]')).toBeVisible();
  await expect(page.locator("#detail-panel")).toContainText("WC-2002");
});

test("new report clears old reporting and team search context", async ({ page }) => {
  await enterDemo(page);
  await openTeam(page);
  await page.getByLabel("Search reports").fill("zzzz");
  await expect(page.getByText("No matching reports")).toBeVisible();

  await page.getByRole("button", { name: /New report/ }).click();
  await expect(page.getByLabel("Search for a location in Singapore")).toHaveValue("");
  await expect(page.locator("#map-hint")).toContainText("Search for an area");

  await page.getByRole("link", { name: "Team dashboard" }).click();
  await expect(page.getByLabel("Search reports")).toHaveValue("");
  await expect(page.locator('[data-report-id="WC-2003"]')).toBeVisible();
});
