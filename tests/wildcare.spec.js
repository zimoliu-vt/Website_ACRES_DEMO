import { expect, test } from "@playwright/test";

const evidencePhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKAAAAAASUVORK5CYII=";
const reports = [
  { id: "WC-2003", animal: "Bird", condition: "Unable to move or fly", notes: "Demo bird", reporter: "Name hidden", photo: evidencePhoto, lat: 1.3048, lng: 103.8318, area: "Botanic Gardens", status: "New", createdAt: 1700000003000, history: [{ label: "Report submitted", at: 1700000003000 }] },
  { id: "WC-2002", animal: "Reptile", condition: "In an unsafe location", notes: "Demo reptile", reporter: "Anonymous", volunteerPhoto: evidencePhoto, lat: 1.3197, lng: 103.9237, area: "Bedok Reservoir", status: "Acknowledged", volunteerStatus: "On the way", responders: [{ id: "vol-1", name: "Demo Volunteer", status: "On the way" }], createdAt: 1700000002000, history: [{ label: "Report submitted", at: 1700000002000 }] },
  { id: "WC-2001", animal: "Mammal", condition: "Injured or bleeding", notes: "Closed demo case", reporter: "Name hidden", lat: 1.3505, lng: 103.7764, area: "Bukit Timah", status: "Resolved", createdAt: 1700000001000, history: [{ label: "Report submitted", at: 1700000001000 }] }
];

async function mockBackend(page) {
  await page.route("https://analytics.liusida.com/umami/script.js", route => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "window.__umamiEvents=[];window.umami={track(...args){window.__umamiEvents.push(['track',...args])},identify(...args){window.__umamiEvents.push(['identify',...args])}};"
  }));
  await page.route("**/api/reports", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reports) }));
  await page.route("**/api/auth/worker", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "demo-worker-token" }) }));
}

async function enterDemo(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("wildcare-demo-warning-ack-v1", "true");
    localStorage.setItem("wildcare-phone-tutorial-seen-v1", "true");
  });
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

test("phone tutorial guides the user through real reporting controls", async ({ page, isMobile }) => {
  await page.addInitScript(() => sessionStorage.setItem("wildcare-demo-warning-ack-v1", "true"));
  await page.goto(`/?tutorial-test=${Date.now()}`);
  if (!isMobile) {
    await expect(page.locator("#phone-tutorial-dialog")).not.toBeVisible();
    await expect(page.locator("#phone-help")).not.toBeVisible();
    return;
  }
  await expect(page.getByRole("heading", { name: "Make a report yourself" })).toBeVisible();
  await page.getByRole("button", { name: "Start walkthrough" }).click();
  await expect(page.getByText("Choose the animal’s location")).toBeVisible();
  await expect(page.getByLabel("Search for a location in Singapore")).toBeFocused();
  await page.locator("#map").click();
  await expect(page.locator("#report-tutorial-title")).toHaveText("Describe the animal");
  await page.getByRole("radio", { name: /Bird/ }).check();
  await page.getByLabel("What seems to be wrong?").selectOption("Unable to move or fly");
  await page.getByLabel(/Describe what you can see/).fill("Interactive tutorial test");
  await expect(page.locator("#report-tutorial-title")).toHaveText("Your report is ready");
  await expect(page.getByRole("button", { name: /Send demo report/ })).toBeEnabled();
  await page.getByRole("button", { name: "Finish guide" }).click();
  await expect(page.locator("#phone-tutorial-dialog")).not.toBeVisible();
  await expect(page.locator("#report-tutorial-guide")).not.toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open reporting tutorial" }).click();
  await expect(page.getByRole("heading", { name: "Make a report yourself" })).toBeVisible();
});

test("automatically detects phone-sized layouts", async ({ page, isMobile }) => {
  await enterDemo(page);
  await expect(page.locator("html")).toHaveAttribute("data-layout", isMobile ? "phone" : "desktop");
  await expect(page.locator("html")).toHaveClass(isMobile ? /phone-layout/ : /^(?!.*phone-layout)/);
  await expect.poll(() => page.locator(".mode-switch").evaluate(element => getComputedStyle(element).position)).toBe(isMobile ? "fixed" : "static");
  await expect.poll(() => page.locator(".demo-banner small").evaluate(element => getComputedStyle(element).display)).toBe(isMobile ? "none" : "block");
  await expect.poll(() => page.locator(".intro-panel").evaluate(element => getComputedStyle(element).display)).toBe(isMobile ? "none" : "flex");
  await expect(page.locator("#map-search-input")).toHaveAttribute("placeholder", isMobile ? "Search street, park or area" : "Search street, park or postcode");
});

test("report flow explains requirements and protects a changed draft", async ({ page, isMobile }) => {
  await enterDemo(page);
  if (!isMobile) {
    await page.getByRole("button", { name: /Choose a location/ }).click();
    await expect(page.getByLabel("Search for a location in Singapore")).toBeFocused();
  }
  await page.locator("#map").click();

  await expect(page.getByText("Step 2 of 3 · report details")).toBeVisible();
  await expect(page.getByLabel("Open camera or choose an animal photo")).toBeAttached();
  await expect(page.getByRole("button", { name: /Send demo report/ })).toBeDisabled();

  await page.getByRole("radio", { name: /Bird/ }).check();
  await page.getByLabel("What seems to be wrong?").selectOption("Unable to move or fly");
  await page.getByLabel(/Describe what you can see/).fill("Public report without a photo");
  await expect(page.getByRole("button", { name: /Send demo report/ })).toBeEnabled();

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

test("photo uploads are normalized to dimensions accepted by Jev", async ({ page, isMobile }) => {
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
  if (!isMobile) await page.getByRole("button", { name: /Choose a location/ }).click();
  await page.locator("#map").click();
  await page.getByLabel("Open camera or choose an animal photo").setInputFiles({
    name: "tiny image with spaces.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKAAAAAASUVORK5CYII=", "base64")
  });
  await expect(page.locator("#jev-analysis")).toContainText("Jev found an animal");
  await expect.poll(() => page.locator("#photo-preview-image").evaluate(image => [image.naturalWidth, image.naturalHeight])).toEqual([768, 768]);
  await expect(page.getByLabel("I understand that this photo can be seen by others.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Send demo report/ })).toBeDisabled();
  await page.getByLabel("I understand that this photo can be seen by others.").check();
  await expect(page.getByRole("button", { name: /Send demo report/ })).toBeEnabled();
});

test("Umami records safe portal and click events", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Volunteer" }).click();
  await expect.poll(() => page.evaluate(() => window.__umamiEvents)).toEqual(expect.arrayContaining([
    ["track", "portal_view", { view: "volunteer" }],
    ["track", "ui_click", { target: "volunteer" }]
  ]));
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
  await expect(page.getByRole("link", { name: "Team dashboard" })).toHaveClass(/active/);
  await expect(page.getByRole("link", { name: "Team dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("img", { name: "Reporter evidence thumbnail for WC-2003" })).toBeVisible();
  await page.locator('[data-report-id="WC-2003"]').click();
  await expect(page.getByRole("img", { name: "Reporter photo attached to case WC-2003" })).toBeVisible();

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
  await expect(page.getByRole("img", { name: "Volunteer evidence thumbnail for WC-2002" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Volunteer observation photo for case WC-2002" })).toBeVisible();
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

test("private developer console signs in and runs fixed diagnostics", async ({ page }) => {
  let users = [{ id: "user-1", username: "riverwatch", createdAt: new Date().toISOString(), name: "River Watcher", contact: "river@example.test", experience: ["Wildlife first aid"] }];
  await page.route("**/api/auth/dev", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "demo-dev-token" }) }));
  await page.route("**/api/dev/status", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, reports: { active: 3, photos: 2 }, volunteers: 1 }) }));
  await page.route("**/api/dev/logs?**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: 1, action: "POST /reports", details: { status: 201 }, created_at: new Date().toISOString() }]) }));
  await page.route("**/api/dev/users", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(users) }));
  await page.route("**/api/dev/users/user-1", async route => {
    const body = route.request().postDataJSON();
    if (body.password !== "test-password") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Incorrect developer password" }) });
    users = [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ removed: true }) });
  });
  await page.route("**/api/dev/run-checks", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ passed: true, finishedAt: Date.now(), checks: [{ name: "Database connection", passed: true, detail: "Connected" }] }) }));
  await page.goto("/dev/");
  await expect(page.getByRole("heading", { name: "Developer console" })).toBeVisible();
  await expect(page.getByText("5687")).toHaveCount(0);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Open console" }).click();
  await expect(page.getByRole("heading", { name: "System overview" })).toBeVisible();
  await expect(page.getByText("POST /reports")).toBeVisible();
  await expect(page.getByText("River Watcher")).toBeVisible();
  await expect(page.getByText("@riverwatch")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("heading", { name: "Remove River Watcher (@riverwatch)?" })).toBeVisible();
  await page.getByLabel("Enter the developer password again").fill("test-password");
  await page.getByRole("button", { name: "Remove user" }).click();
  await expect(page.getByText("No volunteer accounts have been registered.")).toBeVisible();
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("Database connection")).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible();
});
