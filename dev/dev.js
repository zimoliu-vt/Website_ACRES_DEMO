const TOKEN_KEY = "wildcare-dev-token";
let devToken = sessionStorage.getItem(TOKEN_KEY) || "";
let pendingUserRemoval = null;

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

async function loadUsers() {
  const users = await devFetch("/dev/users");
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
    await Promise.all([loadStatus(), loadLogs(), loadUsers()]);
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
