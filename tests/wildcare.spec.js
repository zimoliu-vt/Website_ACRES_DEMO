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
    sessionStorage.setItem("wildcare-auto-location-requested-v2", "true");
    localStorage.setItem("wildcare-volunteer-tutorial-seen-v1", "true");
    localStorage.setItem("wildcare-team-tutorial-seen-v1", "true");
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

test("first entry requests an approximate location and starts in satellite mode", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("wildcare-demo-warning-ack-v1", "true");
    localStorage.setItem("wildcare-phone-tutorial-seen-v1", "true");
    localStorage.setItem("wildcare-volunteer-tutorial-seen-v1", "true");
    localStorage.setItem("wildcare-team-tutorial-seen-v1", "true");
    // Simulate a tab that still has the pre-cache request marker. The current
    // flow must request once, save the area, and then restore it on reload.
    sessionStorage.setItem("wildcare-auto-location-requested-v1", "true");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition(success) {
        sessionStorage.setItem("test-geolocation-calls", String(Number(sessionStorage.getItem("test-geolocation-calls") || 0) + 1));
        success({ coords: { latitude: 1.3521, longitude: 103.8198, accuracy: 80 } });
      } }
    });
  });
  await page.goto(`/?auto-location-test=${Date.now()}`);
  await expect(page.locator("#map-hint")).toContainText("Your nearby area is highlighted");
  await expect(page.getByRole("button", { name: "Satellite" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator(".report-marker").first().evaluate(element => getComputedStyle(element).marginTop)).toBe("-32px");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("test-geolocation-calls"))).toBe("1");
  await page.reload();
  await expect(page.locator("#map-hint")).toContainText("Your nearby area is highlighted");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("test-geolocation-calls"))).toBe("1");
});

test("failed automatic location falls back closer and retries after reload", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("wildcare-demo-warning-ack-v1", "true");
    localStorage.setItem("wildcare-phone-tutorial-seen-v1", "true");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition(_success, failure) {
        sessionStorage.setItem("test-failed-geolocation-calls", String(Number(sessionStorage.getItem("test-failed-geolocation-calls") || 0) + 1));
        failure(new Error("Location unavailable"));
      } }
    });
  });
  await page.goto(`/?auto-location-fallback-test=${Date.now()}`);
  await expect(page.locator("#map-hint")).toContainText("Location access unavailable");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("test-failed-geolocation-calls"))).toBe("1");
  await page.reload();
  await expect(page.locator("#map-hint")).toContainText("Location access unavailable");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("test-failed-geolocation-calls"))).toBe("2");
});

test("phone has detailed volunteer and rescue team walkthroughs", async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("wildcare-demo-warning-ack-v1", "true");
    localStorage.setItem("wildcare-phone-tutorial-seen-v1", "true");
    sessionStorage.setItem("wildcare-auto-location-requested-v1", "true");
  });
  await page.goto(`/?portal-tutorial-test=${Date.now()}`);
  await page.getByRole("button", { name: "Volunteer" }).click();
  if (!isMobile) {
    await expect(page.locator("#portal-tutorial-dialog")).not.toBeVisible();
    return;
  }
  await expect(page.getByRole("heading", { name: "Create your volunteer profile" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Find a nearby case" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Share a safe observation" })).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();

  await page.getByRole("link", { name: "Rescue team sign-in" }).click();
  await page.getByLabel("Demo PIN").fill("0000");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Open the rescue queue" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Review the evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Manage the case" })).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await page.getByRole("button", { name: "Open rescue team walkthrough" }).click();
  await expect(page.getByRole("heading", { name: "Open the rescue queue" })).toBeVisible();
});

test("phone tutorial guides the user through real reporting controls", async ({ page, isMobile }) => {
  let reportPosts = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/api/reports")) reportPosts += 1;
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("wildcare-demo-warning-ack-v1", "true");
    sessionStorage.setItem("wildcare-auto-location-requested-v1", "true");
  });
  await page.goto(`/?tutorial-test=${Date.now()}`);
  if (!isMobile) {
    await expect(page.locator("#phone-tutorial-dialog")).not.toBeVisible();
    await expect(page.locator("#phone-help")).not.toBeVisible();
    return;
  }
  await expect(page.getByRole("heading", { name: "Make a report yourself" })).toBeVisible();
  await expect(page.locator(".tutorial-practice-warning")).toContainText("No report will be submitted, saved, or added to the rescue-team queue.");
  await page.getByRole("button", { name: "Start walkthrough" }).click();
  await expect(page.getByText("Choose the animal’s location")).toBeVisible();
  await expect(page.locator("#map-tutorial-guide")).toContainText("nothing will be submitted or saved");
  await expect(page.getByLabel("Search for a location in Singapore")).toBeFocused();
  await page.locator("#map").click();
  await expect(page.locator("#report-tutorial-title")).toHaveText("Describe the animal");
  await expect(page.locator("#report-tutorial-guide")).toContainText("this will not create a case");
  await page.getByRole("radio", { name: /Bird/ }).check();
  await page.getByLabel("What seems to be wrong?").selectOption("Unable to move or fly");
  await page.getByLabel(/Describe what you can see/).fill("Interactive tutorial test");
  await expect(page.locator("#report-tutorial-title")).toHaveText("Your report is ready");
  await expect(page.getByRole("button", { name: /Send demo report/ })).toBeEnabled();
  await page.getByRole("button", { name: /Send demo report/ }).click();
  await expect(page.getByText("Walkthrough complete — no report was submitted.")).toBeVisible();
  await expect(page.locator("#report-dialog")).not.toBeVisible();
  expect(reportPosts).toBe(0);
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
  await expect(page.locator("body")).toHaveClass(isMobile ? /phone-report-map/ : /^(?!.*phone-report-map)/);
  await expect.poll(() => page.locator("body").evaluate(element => getComputedStyle(element).overflowY)).toBe(isMobile ? "hidden" : "visible");
  if (isMobile) {
    await expect.poll(() => page.locator("#toast").evaluate(element => getComputedStyle(element).bottom)).toBe("82px");
    await page.getByRole("button", { name: "Volunteer" }).click();
    await expect(page.locator("body")).not.toHaveClass(/phone-report-map/);
    await expect.poll(() => page.locator("body").evaluate(element => getComputedStyle(element).overflowY)).not.toBe("hidden");
  }
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
