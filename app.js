const STORAGE_KEY = "wildcare-demo-reports-v1";
const DEMO_WARNING_KEY = "wildcare-demo-warning-ack-v1";

const sampleReports = [
  { id: "WC-1043", animal: "Bird", condition: "Unable to move or fly", notes: "A small green bird is on the grass beside the footpath. It tries to hop but cannot fly.", reporter: "Mei", contact: "", lat: 1.3048, lng: 103.8318, area: "Singapore Botanic Gardens", status: "New", createdAt: Date.now() - 12 * 60 * 1000 },
  { id: "WC-1042", animal: "Reptile", condition: "In an unsafe location", notes: "Monitor lizard resting close to the park connector where bicycles are passing.", reporter: "Anonymous", contact: "", lat: 1.3197, lng: 103.9237, area: "Bedok Reservoir", status: "Acknowledged", createdAt: Date.now() - 48 * 60 * 1000 },
  { id: "WC-1041", animal: "Mammal", condition: "Injured or bleeding", notes: "Macaque has a visible wound on its rear leg and is staying apart from the group.", reporter: "Daniel", contact: "", lat: 1.3505, lng: 103.7764, area: "Bukit Timah Nature Reserve", status: "Assigned", createdAt: Date.now() - 2.4 * 60 * 60 * 1000 },
  { id: "WC-1040", animal: "Bird", condition: "Trapped or entangled", notes: "Bird caught in loose netting near a community garden fence.", reporter: "Priya", contact: "", lat: 1.3711, lng: 103.8451, area: "Bishan–Ang Mo Kio Park", status: "Resolved", createdAt: Date.now() - 26 * 60 * 60 * 1000 }
];

const animalEmoji = { Bird: "🐦", Mammal: "🐒", Reptile: "🦎", Other: "🐾" };
let reports = loadReports();
let map;
let selectedLocation = null;
let locationMarker = null;
let reportMarkers = [];
let detailMap = null;
let selectedReportId = null;
let currentFilter = "active";
let workerAuthenticated = sessionStorage.getItem("wildcare-worker-auth") === "true";
let reverseLookupTimer = null;

function loadReports() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : structuredClone(sampleReports);
  } catch {
    return structuredClone(sampleReports);
  }
}

function saveReports() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

function initMap() {
  if (!window.L) {
    document.querySelector("#map").innerHTML = '<div style="height:100%;display:grid;place-items:center;padding:30px;text-align:center;color:#173f35"><div><strong>Map unavailable offline</strong><p>Connect to the internet to load the interactive Singapore map.</p></div></div>';
    return;
  }
  map = L.map("map", { zoomControl: false, minZoom: 10, maxBounds: [[1.16, 103.55], [1.49, 104.15]] }).setView([1.3521, 103.8198], 12);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  map.on("click", (event) => chooseLocation(event.latlng.lat, event.latlng.lng));
  drawReportMarkers();
}

function chooseLocation(lat, lng) {
  selectedLocation = { lat, lng, name: estimatedArea(lat, lng) };
  if (map) {
    if (locationMarker) locationMarker.remove();
    locationMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    locationMarker.on("dragend", (event) => {
      const point = event.target.getLatLng();
      selectedLocation = { lat: point.lat, lng: point.lng, name: estimatedArea(point.lat, point.lng) };
      updateCoordinateCopy();
      scheduleReverseLookup(point.lat, point.lng);
    });
  }
  updateCoordinateCopy();
  document.querySelector("#report-dialog").showModal();
  scheduleReverseLookup(lat, lng);
}

function updateCoordinateCopy() {
  document.querySelector("#coordinates").textContent = `${selectedLocation.name} · ${selectedLocation.lat.toFixed(4)}, ${selectedLocation.lng.toFixed(4)}`;
}

function scheduleReverseLookup(lat, lng) {
  clearTimeout(reverseLookupTimer);
  document.querySelector("#coordinates").textContent = `Finding the nearest street… · ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  reverseLookupTimer = setTimeout(() => reverseGeocode(lat, lng), 700);
}

async function reverseGeocode(lat, lng) {
  const cacheKey = `wildcare-address-${lat.toFixed(4)}-${lng.toFixed(4)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    selectedLocation.name = cached;
    updateCoordinateCopy();
    return;
  }
  try {
    const params = new URLSearchParams({ format: "jsonv2", lat, lon: lng, zoom: "18", addressdetails: "1", "accept-language": "en" });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
    if (!response.ok) throw new Error("Address lookup unavailable");
    const result = await response.json();
    const address = result.address || {};
    const street = address.road || address.pedestrian || address.footway || address.neighbourhood || result.name;
    const locality = address.suburb || address.quarter || address.city_district || address.city;
    const label = [street, locality].filter((value, index, array) => value && array.indexOf(value) === index).slice(0, 2).join(", ") || result.display_name?.split(",").slice(0, 2).join(",") || estimatedArea(lat, lng);
    if (selectedLocation && Math.abs(selectedLocation.lat - lat) < .0001 && Math.abs(selectedLocation.lng - lng) < .0001) {
      selectedLocation.name = label;
      updateCoordinateCopy();
    }
    localStorage.setItem(cacheKey, label);
  } catch {
    if (selectedLocation) updateCoordinateCopy();
  }
}

function drawReportMarkers() {
  if (!map) return;
  reportMarkers.forEach(marker => marker.remove());
  reportMarkers = reports.filter(report => report.status !== "Resolved").map(report => {
    const icon = L.divIcon({ className: "report-marker", html: `<span>${animalEmoji[report.animal] || "🐾"}</span>`, iconSize: [32, 32] });
    return L.marker([report.lat, report.lng], { icon }).addTo(map).bindPopup(`<strong>${report.animal}</strong><br>${report.condition}`);
  });
}

function switchView(viewName) {
  if (viewName === "worker" && !workerAuthenticated) {
    openWorkerLogin();
    return;
  }
  document.querySelectorAll(".mode-button").forEach(button => button.classList.toggle("active", button.dataset.view === viewName));
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === `${viewName}-view`));
  if (viewName === "reporter" && map) setTimeout(() => map.invalidateSize(), 80);
  if (viewName === "worker") renderDashboard();
}

function openWorkerLogin() {
  const dialog = document.querySelector("#login-dialog");
  document.querySelector("#login-error").textContent = "";
  document.querySelector("#worker-pin").value = "";
  dialog.showModal();
  setTimeout(() => document.querySelector("#worker-pin").focus(), 50);
}

function logoutWorker() {
  workerAuthenticated = false;
  sessionStorage.removeItem("wildcare-worker-auth");
  switchView("reporter");
  showToast("You have logged out of the worker dashboard.");
}

function relativeTime(timestamp) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function estimatedArea(lat, lng) {
  if (lng < 103.79) return "Western Singapore";
  if (lng > 103.9) return "Eastern Singapore";
  if (lat > 1.36) return "Northern Singapore";
  if (lat < 1.29) return "Southern Singapore";
  return "Central Singapore";
}

function renderDashboard() {
  const active = reports.filter(report => report.status !== "Resolved");
  const newReports = reports.filter(report => report.status === "New");
  const assigned = reports.filter(report => report.status === "Assigned");
  const resolved = reports.filter(report => report.status === "Resolved");
  const stats = [
    ["New reports", newReports.length, "●"],
    ["Active cases", active.length, "↗"],
    ["Assigned", assigned.length, "✓"],
    ["Resolved", resolved.length, "✦"]
  ];
  document.querySelector("#stats-grid").innerHTML = stats.map(([label, number, icon]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-number">${number}</div></article>`).join("");

  const visible = reports.filter(report => {
    if (currentFilter === "active") return report.status !== "Resolved";
    if (currentFilter === "resolved") return report.status === "Resolved";
    return true;
  }).sort((a, b) => b.createdAt - a.createdAt);

  document.querySelector("#queue-count").textContent = visible.length;
  const list = document.querySelector("#report-list");
  list.innerHTML = visible.length ? visible.map(report => `
    <button class="report-card ${selectedReportId === report.id ? "selected" : ""}" data-report-id="${report.id}" type="button">
      <span class="animal-avatar">${animalEmoji[report.animal] || "🐾"}</span>
      <span class="report-copy"><strong>${escapeHtml(report.animal)} · ${escapeHtml(report.condition)}</strong><p>${escapeHtml(report.notes)}</p><small>⌖ ${escapeHtml(report.area)} · ${relativeTime(report.createdAt)}</small></span>
      <span class="status-pill status-${report.status.toLowerCase()}">${report.status}</span>
    </button>`).join("") : '<div class="empty-detail"><span>✓</span><h3>No reports here</h3><p>There are no reports matching this filter.</p></div>';

  list.querySelectorAll("[data-report-id]").forEach(button => button.addEventListener("click", () => selectReport(button.dataset.reportId)));
  if (selectedReportId && reports.some(report => report.id === selectedReportId)) renderReportDetail(selectedReportId);
}

function selectReport(id) {
  selectedReportId = id;
  renderDashboard();
}

function renderReportDetail(id) {
  const report = reports.find(item => item.id === id);
  if (!report) return;
  const panel = document.querySelector("#detail-panel");
  panel.innerHTML = `<div class="detail-content">
    <div class="detail-top"><div><span class="case-id">Case ${escapeHtml(report.id)}</span><h2>${animalEmoji[report.animal]} ${escapeHtml(report.animal)}</h2><span class="status-pill status-${report.status.toLowerCase()}">${report.status}</span></div><span class="animal-avatar">${animalEmoji[report.animal]}</span></div>
    <div class="detail-map" id="detail-map" aria-label="Map showing the selected report location"></div>
    <div class="detail-meta">
      <div class="meta-box"><small>Location</small><strong>${escapeHtml(report.area)}</strong></div>
      <div class="meta-box"><small>Reported</small><strong>${relativeTime(report.createdAt)}</strong></div>
      <div class="meta-box"><small>Condition</small><strong>${escapeHtml(report.condition)}</strong></div>
      <div class="meta-box"><small>Reporter</small><strong>${escapeHtml(report.reporter || "Anonymous")}</strong></div>
    </div>
    <p class="notes-box">${escapeHtml(report.notes)}</p>
    <div class="status-control"><label for="case-status">Update case status</label><select id="case-status">
      ${["New", "Acknowledged", "Assigned", "Resolved"].map(status => `<option ${status === report.status ? "selected" : ""}>${status}</option>`).join("")}
    </select></div>
  </div>`;
  panel.querySelector("#case-status").addEventListener("change", event => {
    report.status = event.target.value;
    saveReports();
    drawReportMarkers();
    showToast(`Case ${report.id} updated to ${report.status}.`);
    renderDashboard();
  });
  setTimeout(() => renderDetailMap(report), 0);
}

function renderDetailMap(report) {
  if (!window.L || !document.querySelector("#detail-map")) return;
  if (detailMap) detailMap.remove();
  detailMap = L.map("detail-map", { zoomControl: true, attributionControl: true, dragging: true, scrollWheelZoom: false }).setView([report.lat, report.lng], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(detailMap);
  const icon = L.divIcon({ className: "report-marker", html: `<span>${animalEmoji[report.animal] || "🐾"}</span>`, iconSize: [32, 32] });
  L.marker([report.lat, report.lng], { icon }).addTo(detailMap).bindPopup(`<strong>${escapeHtml(report.animal)}</strong><br>${escapeHtml(report.area)}`).openPopup();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 3200);
}

document.querySelectorAll(".mode-button").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
const demoWarningDialog = document.querySelector("#demo-warning-dialog");
demoWarningDialog.addEventListener("cancel", event => event.preventDefault());
document.querySelector("#acknowledge-demo").addEventListener("click", () => {
  sessionStorage.setItem(DEMO_WARNING_KEY, "true");
  demoWarningDialog.close();
});
document.querySelectorAll("[data-guide-step]").forEach(button => button.addEventListener("click", () => {
  const mapPanel = document.querySelector(".map-panel");
  mapPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  const hint = document.querySelector("#map-hint");
  hint.innerHTML = button.dataset.guideStep === "location" ? "<span>＋</span> Click the animal’s location on the map" : "<span>1</span> First choose a location, then the report form will open";
  hint.animate([{ transform: "translateX(-50%) scale(1)" }, { transform: "translateX(-50%) scale(1.06)" }, { transform: "translateX(-50%) scale(1)" }], { duration: 500 });
}));
document.querySelectorAll(".filter").forEach(button => button.addEventListener("click", () => {
  currentFilter = button.dataset.filter;
  document.querySelectorAll(".filter").forEach(item => item.classList.toggle("active", item === button));
  renderDashboard();
}));

document.querySelector("#close-dialog").addEventListener("click", () => document.querySelector("#report-dialog").close());
document.querySelector("#finish-report").addEventListener("click", () => document.querySelector("#success-dialog").close());
document.querySelector("#close-login").addEventListener("click", () => document.querySelector("#login-dialog").close());
document.querySelector("#login-form").addEventListener("submit", event => {
  event.preventDefault();
  const pinInput = document.querySelector("#worker-pin");
  if (pinInput.value !== "0000") {
    document.querySelector("#login-error").textContent = "That PIN is incorrect. Try 0000 for this demo.";
    pinInput.select();
    return;
  }
  workerAuthenticated = true;
  sessionStorage.setItem("wildcare-worker-auth", "true");
  document.querySelector("#login-dialog").close();
  switchView("worker");
  showToast("Worker dashboard unlocked.");
});
document.querySelector("#worker-logout").addEventListener("click", logoutWorker);
document.querySelector("#new-report-worker").addEventListener("click", () => switchView("reporter"));
document.querySelector("#reset-demo").addEventListener("click", () => {
  reports = structuredClone(sampleReports);
  selectedReportId = null;
  saveReports();
  drawReportMarkers();
  renderDashboard();
  showToast("Demo reports have been reset.");
});

document.querySelector("#locate-button").addEventListener("click", () => {
  if (!navigator.geolocation) return showToast("Location is not available in this browser.");
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    if (latitude < 1.16 || latitude > 1.49 || longitude < 103.55 || longitude > 104.15) {
      showToast("Your location appears to be outside Singapore. Click the map instead.");
      return;
    }
    map?.setView([latitude, longitude], 16);
    chooseLocation(latitude, longitude);
  }, () => showToast("We could not access your location. Click the map instead."));
});

document.querySelector("#report-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!selectedLocation) return showToast("Please choose a location on the map first.");
  const data = new FormData(event.currentTarget);
  const nextNumber = Math.max(...reports.map(report => Number(report.id.split("-")[1]) || 1000), 1000) + 1;
  const report = {
    id: `WC-${nextNumber}`,
    animal: data.get("animal"),
    condition: data.get("condition"),
    notes: data.get("notes"),
    reporter: data.get("reporter") || "Anonymous",
    contact: data.get("contact") || "",
    lat: selectedLocation.lat,
    lng: selectedLocation.lng,
    area: selectedLocation.name || estimatedArea(selectedLocation.lat, selectedLocation.lng),
    status: "New",
    createdAt: Date.now()
  };
  reports.unshift(report);
  saveReports();
  drawReportMarkers();
  event.currentTarget.reset();
  document.querySelector("#report-dialog").close();
  if (locationMarker) { locationMarker.remove(); locationMarker = null; }
  selectedReportId = report.id;
  document.querySelector("#success-case-id").textContent = report.id;
  setTimeout(() => document.querySelector("#success-dialog").showModal(), 120);
});

document.querySelector("#photo-input").addEventListener("change", event => {
  const label = event.target.closest("label");
  const helper = label.querySelector("small");
  helper.textContent = event.target.files[0] ? `${event.target.files[0].name} selected locally` : "Optional — not uploaded in this demo";
});

initMap();
renderDashboard();
if (sessionStorage.getItem(DEMO_WARNING_KEY) !== "true") demoWarningDialog.showModal();
