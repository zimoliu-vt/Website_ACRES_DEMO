const TOKEN_KEY = "wildcare-dev-token";
let devToken = sessionStorage.getItem(TOKEN_KEY) || "";

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

function exactTime(value) {
  return new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Singapore" }).format(new Date(value));
}

async function loadStatus() {
  const status = await devFetch("/dev/status");
  document.querySelector("#dev-stats").innerHTML = [
    ["Service", status.ok ? "Online" : "Unavailable"],
    ["Active reports", status.reports.active],
    ["Stored photos", status.reports.photos],
    ["Volunteers", status.volunteers]
  ].map(([label, value]) => `<article class="dev-stat"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></article>`).join("");
}

async function loadLogs() {
  const logs = await devFetch("/dev/logs?limit=80");
  document.querySelector("#dev-logs").innerHTML = logs.length ? logs.map(log => `<article class="dev-log"><span>•</span><div><strong>${escapeHtml(log.action)}</strong><small>${escapeHtml(JSON.stringify(log.details || {}))}</small></div><time>${escapeHtml(exactTime(log.created_at))}</time></article>`).join("") : '<p class="dev-empty">No backend activity has been recorded yet.</p>';
}

async function openConsole() {
  try {
    await Promise.all([loadStatus(), loadLogs()]);
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
