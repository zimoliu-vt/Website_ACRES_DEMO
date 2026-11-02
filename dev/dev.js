const TOKEN_KEY = "wildcare-dev-token";
let devToken = sessionStorage.getItem(TOKEN_KEY) || "";
let pendingUserRemoval = null;
let devLogs = [];
let devReports = [];
let devUsers = [];
const DEV_PAGE_SIZE = 100;
let logOffset = 0;
let reportOffset = 0;
let logHasMore = true;
let reportHasMore = true;
let loadingLogs = false;
let loadingReports = false;
let userOffset = 0;
let userHasMore = true;
let loadingUsers = false;
const featureNames = ["volunteerPortal", "photoTools", "tutorials", "locationSearch"];

async function devFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (devToken) headers.Authorization = `Bearer ${devToken}`;
  const response = await fetch(`/api${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The developer service is unavailable.");
  return result;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function safeClass(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function exactTime(value) {
  return new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Singapore" }).format(new Date(value));
}

function uptimeLabel(seconds = 0) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ");
}

function statTone(label, value) {
  if (label === "Service") return value === "Online" ? "good" : "danger";
  if (label === "Jev analysis") return value === "Configured" ? "good" : "danger";
  if (label === "Active reports" && Number(value) > 0) return "attention";
  return "neutral";
}

async function loadStatus() {
  const status = await devFetch("/dev/status");
  document.querySelector("#dev-stats").innerHTML = [
    ["Service", status.ok ? "Online" : "Unavailable"],
    ["Active reports", status.reports.active],
    ["Total reports", status.reports.total],
    ["Stored photos", status.reports.photos],
    ["Volunteers", status.volunteers],
    ["Logged actions", status.loggedActions],
    ["Jev analysis", status.jevConfigured ? "Configured" : "Not configured"],
    ["API uptime", uptimeLabel(status.uptimeSeconds)]
  ].map(([label, value]) => `<article class="dev-stat dev-tone-${statTone(label, value)}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></article>`).join("");
  document.querySelector("#dev-alerts").innerHTML = status.alerts.map(alert => `<div class="dev-alert dev-alert-${safeClass(alert.level)}">${escapeHtml(alert.message)}</div>`).join("");
  const size = bytes => bytes < 1024 * 1024 ? `${Math.max(0, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  document.querySelector("#dev-storage").innerHTML = [["Database", size(status.storage.databaseBytes)], ["Stored photos", size(status.storage.photoBytes)]].map(([label,value]) => `<article><small>${label}</small><strong>${value}</strong></article>`).join("");
}

async function loadFeatureSettings() {
  const result = await devFetch("/dev/settings");
  featureNames.forEach(name => {
    document.querySelector(`#dev-feature-form [name="${name}"]`).checked = result.features[name] !== false;
  });
  document.querySelector("#dev-feature-status").textContent = "Current live settings loaded.";
  const publicForm = document.querySelector("#dev-public-form");
  publicForm.elements.maintenance.checked = Boolean(result.config?.maintenance);
  publicForm.elements.announcement.value = result.config?.announcement || "";
  publicForm.elements.demoBannerVisible.checked = result.config?.demoBannerVisible !== false;
}

async function loadSettingsHistory() {
  const result = await devFetch("/dev/settings-history");
  document.querySelector("#dev-settings-history").innerHTML = result.items.length ? result.items.map(item => `<article><div><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(exactTime(item.created_at))}</small></div><button type="button" data-undo-setting="${item.id}">Undo</button></article>`).join("") : '<p class="dev-empty">No reversible settings changes yet.</p>';
  document.querySelectorAll("[data-undo-setting]").forEach(button => button.addEventListener("click", async () => { button.disabled = true; await devFetch(`/dev/settings-history/${button.dataset.undoSetting}/undo`, { method: "POST" }); await Promise.all([loadFeatureSettings(), loadSettingsHistory(), loadLogs()]); }));
}

function renderLogs() {
  const query = document.querySelector("#dev-log-search").value.trim().toLowerCase();
  const logs = query ? devLogs.filter(log => `${log.action} ${JSON.stringify(log.details || {})}`.toLowerCase().includes(query)) : devLogs;
  document.querySelector("#dev-logs").innerHTML = logs.length ? logs.map(log => `<article class="dev-log dev-log-${safeClass(log.action)}"><span>•</span><div><strong>${escapeHtml(log.action)}</strong><small>${escapeHtml(JSON.stringify(log.details || {}))}</small></div><time>${escapeHtml(exactTime(log.created_at))}</time></article>`).join("") : `<p class="dev-empty">${query ? "No activity matches this search." : "No backend activity has been recorded yet."}</p>`;
}

async function loadLogs({ append = false } = {}) {
  if (loadingLogs || (append && !logHasMore)) return;
  loadingLogs = true;
  if (!append) logOffset = 0;
  const result = await devFetch(`/dev/logs?limit=${DEV_PAGE_SIZE}&offset=${append ? logOffset : 0}`);
  devLogs = append ? [...devLogs, ...result.items] : result.items;
  logOffset = devLogs.length;
  logHasMore = result.hasMore;
  renderLogs();
  loadingLogs = false;
}

function renderReports() {
  const query = document.querySelector("#dev-report-search").value.trim().toLowerCase();
  const status = document.querySelector("#dev-report-status").value;
  const reports = devReports.filter(report => (!status || report.status === status) && (!query || `${report.id} ${report.animal} ${report.condition} ${report.location}`.toLowerCase().includes(query)));
  const active = reports.filter(report => !["Resolved", "Completed", "Deleted"].includes(report.status)).length;
  const urgent = reports.filter(report => ["High", "Urgent", "Critical"].includes(report.priority)).length;
  const photos = reports.filter(report => report.hasPhoto).length;
  document.querySelector("#dev-report-summary").innerHTML = [
    ["visible", `${reports.length} shown`], ["active", `${active} active`], ["urgent", `${urgent} priority`], ["photos", `${photos} with photos`]
  ].map(([kind, text]) => `<span class="dev-summary-${kind}">${escapeHtml(text)}</span>`).join("");
  document.querySelector("#dev-reports").innerHTML = reports.length ? reports.map(report => `<article class="dev-report">
    <div class="dev-report-main"><strong>${escapeHtml(report.id)}</strong><span class="dev-status dev-status-${safeClass(report.status)}">${escapeHtml(report.status)}</span><small>${escapeHtml(report.animal)} · ${escapeHtml(report.condition)}</small><small>${escapeHtml(report.location)}</small></div>
    <div class="dev-report-meta"><span class="dev-photo-${report.hasPhoto ? "yes" : "no"}">${report.hasPhoto ? "Photo" : "No photo"}</span><span class="dev-priority dev-priority-${safeClass(report.priority || "Normal")}">${escapeHtml(report.priority || "Normal")} priority</span><time>${escapeHtml(exactTime(report.updatedAt || report.createdAt))}</time></div>
  </article>`).join("") : '<p class="dev-empty">No reports match these filters.</p>';
}

async function loadReports({ append = false } = {}) {
  if (loadingReports || (append && !reportHasMore)) return;
  loadingReports = true;
  if (!append) reportOffset = 0;
  const result = await devFetch(`/dev/reports?limit=${DEV_PAGE_SIZE}&offset=${append ? reportOffset : 0}`);
  devReports = append ? [...devReports, ...result.items] : result.items;
  reportOffset = devReports.length;
  reportHasMore = result.hasMore;
  const select = document.querySelector("#dev-report-status");
  const current = select.value;
  const statuses = [...new Set(devReports.map(report => report.status).filter(Boolean))].sort();
  select.innerHTML = '<option value="">All statuses</option>' + statuses.map(status => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join("");
  if (statuses.includes(current)) select.value = current;
  renderReports();
  loadingReports = false;
}

function loadMoreNearBottom(element, loader) {
  element.addEventListener("scroll", () => {
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 140) loader({ append: true });
  });
}

async function loadUsers({ append = false } = {}) {
  if (loadingUsers || (append && !userHasMore)) return;
  loadingUsers = true;
  if (!append) userOffset = 0;
  const result = await devFetch(`/dev/users?limit=${DEV_PAGE_SIZE}&offset=${append ? userOffset : 0}`);
  devUsers = append ? [...devUsers, ...result.items] : result.items;
  userOffset = devUsers.length;
  userHasMore = result.hasMore;
  const users = devUsers;
  document.querySelector("#dev-users").innerHTML = users.length ? users.map(user => {
    const details = [
      `@${user.username}`,
      user.contact || "No contact supplied",
      user.experience?.length ? user.experience.join(", ") : "No experience supplied",
      `Joined ${exactTime(user.createdAt)}`
    ];
    return `<article class="dev-user"><div><strong>${escapeHtml(user.name)}</strong><small>${details.map(escapeHtml).join(" · ")}</small></div><button class="dev-remove-user" type="button" data-remove-user="${escapeHtml(user.id)}">Remove</button></article>`;
  }).join("") : '<p class="dev-empty">No volunteer accounts have been registered.</p>';
  document.querySelectorAll("[data-remove-user]").forEach(button => button.addEventListener("click", () => {
    const user = users.find(item => item.id === button.dataset.removeUser);
    if (user) openRemoveUser(user);
  }));
  loadingUsers = false;
}

function openRemoveUser(user) {
  pendingUserRemoval = user;
  document.querySelector("#remove-user-name").textContent = `${user.name} (@${user.username})`;
  document.querySelector("#remove-user-password").value = "";
  document.querySelector("#remove-user-error").hidden = true;
  document.querySelector("#remove-user-dialog").showModal();
  document.querySelector("#remove-user-password").focus();
}

function closeRemoveUser() {
  document.querySelector("#remove-user-dialog").close();
  pendingUserRemoval = null;
}

async function openConsole() {
  try {
    await Promise.all([loadStatus(), loadFeatureSettings(), loadSettingsHistory(), loadLogs(), loadReports(), loadUsers()]);
    document.querySelector("#dev-login").hidden = true;
    document.querySelector("#dev-console").hidden = false;
  } catch {
    devToken = "";
    sessionStorage.removeItem(TOKEN_KEY);
    document.querySelector("#dev-login").hidden = false;
    document.querySelector("#dev-console").hidden = true;
  }
}

document.querySelector("#dev-login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const error = document.querySelector("#dev-login-error");
  error.hidden = true;
  try {
    const result = await devFetch("/auth/dev", { method: "POST", body: JSON.stringify({ password: document.querySelector("#dev-password").value }) });
    devToken = result.token;
    sessionStorage.setItem(TOKEN_KEY, devToken);
    document.querySelector("#dev-password").value = "";
    await openConsole();
  } catch (loginError) {
    error.textContent = loginError.message;
    error.hidden = false;
  }
});

document.querySelector("#dev-logout").addEventListener("click", () => {
  devToken = "";
  sessionStorage.removeItem(TOKEN_KEY);
  document.querySelector("#dev-console").hidden = true;
  document.querySelector("#dev-login").hidden = false;
  document.querySelector("#dev-password").focus();
});

document.querySelector("#refresh-dev-logs").addEventListener("click", loadLogs);
document.querySelector("#dev-log-search").addEventListener("input", renderLogs);
document.querySelector("#refresh-dev-reports").addEventListener("click", loadReports);
document.querySelector("#dev-report-search").addEventListener("input", renderReports);
document.querySelector("#dev-report-status").addEventListener("change", renderReports);
loadMoreNearBottom(document.querySelector("#dev-logs"), loadLogs);
loadMoreNearBottom(document.querySelector("#dev-reports"), loadReports);
loadMoreNearBottom(document.querySelector("#dev-users"), loadUsers);
async function saveFeatureSettings() {
  const form = document.querySelector("#dev-feature-form");
  const status = document.querySelector("#dev-feature-status");
  const inputs = featureNames.map(name => form.elements[name]);
  const features = Object.fromEntries(featureNames.map(name => [name, form.elements[name].checked]));
  inputs.forEach(input => { input.disabled = true; });
  status.textContent = "Saving…";
  try {
    await devFetch("/dev/settings", { method: "PUT", body: JSON.stringify({ features }) });
    status.textContent = "Saved automatically. Reload the public website to see the changes.";
  } catch (error) {
    await loadFeatureSettings().catch(() => {});
    status.textContent = `Could not save: ${error.message}`;
  } finally {
    inputs.forEach(input => { input.disabled = false; });
  }
}
featureNames.forEach(name => document.querySelector(`#dev-feature-form [name="${name}"]`).addEventListener("change", saveFeatureSettings));
document.querySelector("#restore-dev-features").addEventListener("click", async () => {
  featureNames.forEach(name => { document.querySelector(`#dev-feature-form [name="${name}"]`).checked = true; });
  await saveFeatureSettings();
});
let publicSaveTimer;
async function savePublicConfig() {
  const form = document.querySelector("#dev-public-form");
  const status = document.querySelector("#dev-public-status");
  status.textContent = "Saving…";
  try {
    await devFetch("/dev/config", { method: "PUT", body: JSON.stringify({ maintenance: form.elements.maintenance.checked, announcement: form.elements.announcement.value, demoBannerVisible: form.elements.demoBannerVisible.checked, password: form.elements.password.value }) });
    form.elements.password.value = "";
    document.querySelector("#banner-password-wrap").hidden = true;
    status.textContent = "Saved automatically.";
    await loadSettingsHistory();
  } catch (error) { status.textContent = error.message; }
}
document.querySelector("#dev-public-form").addEventListener("change", event => {
  if (event.target.name === "demoBannerVisible" && !event.target.checked) { document.querySelector("#banner-password-wrap").hidden = false; document.querySelector("#dev-public-status").textContent = "Enter your password to confirm hiding the demo banner."; return; }
  savePublicConfig();
});
document.querySelector('#dev-public-form [name="announcement"]').addEventListener("input", () => { clearTimeout(publicSaveTimer); publicSaveTimer = setTimeout(savePublicConfig, 600); });
document.querySelector('#dev-public-form [name="password"]').addEventListener("change", savePublicConfig);
document.querySelector("#refresh-settings-history").addEventListener("click", loadSettingsHistory);
document.querySelector("#add-sample-report").addEventListener("click", async () => { const status = document.querySelector("#sample-report-status"); status.textContent = "Adding one sample report…"; try { const result = await devFetch("/dev/sample-report", { method: "POST" }); status.textContent = `${result.report.id} added. No existing reports were removed.`; await Promise.all([loadStatus(), loadReports(), loadLogs()]); } catch (error) { status.textContent = error.message; } });
document.querySelector("#refresh-dev-users").addEventListener("click", loadUsers);
document.querySelector("#close-remove-user").addEventListener("click", closeRemoveUser);
document.querySelector("#remove-user-dialog").addEventListener("cancel", event => {
  event.preventDefault();
  closeRemoveUser();
});
document.querySelector("#remove-user-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!pendingUserRemoval) return;
  const button = event.currentTarget.querySelector('[type="submit"]');
  const error = document.querySelector("#remove-user-error");
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Removing…";
  try {
    await devFetch(`/dev/users/${encodeURIComponent(pendingUserRemoval.id)}`, {
      method: "DELETE",
      body: JSON.stringify({ password: document.querySelector("#remove-user-password").value })
    });
    closeRemoveUser();
    await Promise.all([loadUsers(), loadStatus(), loadLogs()]);
  } catch (removeError) {
    error.textContent = removeError.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Remove user";
  }
});
document.querySelector("#run-dev-checks").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Running…";
  try {
    const result = await devFetch("/dev/run-checks", { method: "POST", body: "{}" });
    document.querySelector("#dev-check-results").innerHTML = result.checks.map(check => `<article class="dev-check ${check.passed ? (check.warning ? "warning" : "") : "failed"}"><span>${check.passed ? (check.warning ? "△" : "✓") : "!"}</span><div><strong>${escapeHtml(check.name)}</strong><small>${escapeHtml(check.detail)}</small></div><time>${escapeHtml(exactTime(result.finishedAt))}</time></article>`).join("");
    await Promise.all([loadStatus(), loadLogs()]);
  } catch (error) {
    document.querySelector("#dev-check-results").innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "Run checks";
  }
});

if (devToken) openConsole();
