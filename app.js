const STORAGE_KEY = "wildcare-demo-reports-v1";
const DEMO_WARNING_KEY = "wildcare-demo-warning-ack-v1";
const VOLUNTEER_KEY = "wildcare-demo-volunteer-v1";
const API_BASE = "/api";
const RESCUE_ENTRY_PATH = "/8f3c6a91d2";
const isRescueEntry = window.location.pathname === RESCUE_ENTRY_PATH;

const sampleReports = [
  { id: "WC-1043", animal: "Bird", condition: "Unable to move or fly", notes: "A small green bird is on the grass beside the footpath. It tries to hop but cannot fly.", reporter: "Mei", contact: "", lat: 1.3048, lng: 103.8318, area: "Singapore Botanic Gardens", status: "New", createdAt: Date.now() - 12 * 60 * 1000 },
  { id: "WC-1042", animal: "Reptile", condition: "In an unsafe location", notes: "Monitor lizard resting close to the park connector where bicycles are passing.", reporter: "Anonymous", contact: "", lat: 1.3197, lng: 103.9237, area: "Bedok Reservoir", status: "Acknowledged", createdAt: Date.now() - 48 * 60 * 1000 },
  { id: "WC-1041", animal: "Mammal", condition: "Injured or bleeding", notes: "Macaque has a visible wound on its rear leg and is staying apart from the group.", reporter: "Daniel", contact: "", lat: 1.3505, lng: 103.7764, area: "Bukit Timah Nature Reserve", status: "Assigned", createdAt: Date.now() - 2.4 * 60 * 60 * 1000 },
  { id: "WC-1040", animal: "Bird", condition: "Trapped or entangled", notes: "Bird caught in loose netting near a community garden fence.", reporter: "Priya", contact: "", lat: 1.3711, lng: 103.8451, area: "Bishan–Ang Mo Kio Park", status: "Resolved", createdAt: Date.now() - 26 * 60 * 60 * 1000 }
];

const animalEmoji = { Bird: "🐦", Mammal: "🐒", Reptile: "🦎", Other: "🐾" };
let reports = loadReports();
let map;
let streetLayer = null;
let satelliteLayer = null;
let selectedLocation = null;
let locationMarker = null;
let searchAreaMarker = null;
let reportMarkers = [];
let detailMap = null;
let selectedReportId = null;
let currentFilter = "active";
let workerAuthenticated = sessionStorage.getItem("wildcare-worker-auth") === "true";
let workerToken = sessionStorage.getItem("wildcare-worker-token") || "";
let volunteerToken = localStorage.getItem("wildcare-volunteer-token") || "";
let backendReady = false;
let reverseLookupTimer = null;
let selectedPhotoDataUrl = "";
let pendingReopen = null;
let volunteer = loadVolunteer();
if (volunteer && !volunteerToken) {
  volunteer = null;
  localStorage.removeItem(VOLUNTEER_KEY);
}
let volunteerAssessmentReportId = null;
let volunteerPhotoDataUrl = "";
let volunteerMap = null;
let volunteerLocationMarker = null;
let volunteerRadiusCircle = null;
let pendingVolunteerLocation = null;

const singaporeBoundary = [
  [1.145, 103.605], [1.205, 103.605], [1.265, 103.625], [1.325, 103.635],
  [1.365, 103.675], [1.405, 103.73], [1.475, 103.81], [1.445, 103.875],
  [1.42, 103.94], [1.405, 104.045], [1.34, 104.105], [1.275, 104.035],
  [1.235, 103.94], [1.205, 103.835], [1.19, 103.72]
];

function isSingaporePoint(lat, lng) {
  let inside = false;
  for (let i = 0, j = singaporeBoundary.length - 1; i < singaporeBoundary.length; j = i++) {
    const [latI, lngI] = singaporeBoundary[i];
    const [latJ, lngJ] = singaporeBoundary[j];
    const intersects = ((latI > lat) !== (latJ > lat)) && (lng < (lngJ - lngI) * (lat - latI) / (latJ - latI) + lngI);
    if (intersects) inside = !inside;
  }
  return inside;
}

function rejectOutsideSingapore() {
  showToast("That location is outside Singapore and cannot be selected.");
  const hint = document.querySelector("#map-hint");
  hint.innerHTML = "<span>!</span> Singapore locations only";
  setTimeout(() => { hint.innerHTML = "<span>＋</span> Select the animal’s location in Singapore"; }, 2600);
}

function loadReports() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const loaded = stored ? JSON.parse(stored) : structuredClone(sampleReports);
    return loaded.map(report => {
      if (!Array.isArray(report.history)) {
        report.history = [{ label: "Report submitted", at: report.createdAt }];
        if (report.status !== "New") report.history.push({ label: `Status changed to ${statusLabel(report.status)}`, at: report.createdAt + 60000 });
      }
      return report;
    });
  } catch {
    return structuredClone(sampleReports).map(report => ({ ...report, history: [{ label: "Report submitted", at: report.createdAt }] }));
  }
}

function saveReports() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  if (backendReady) reports.forEach(report => persistReport(report));
}

function loadVolunteer() {
  try { return JSON.parse(localStorage.getItem(VOLUNTEER_KEY)) || null; } catch { return null; }
}

function saveVolunteer() {
  if (volunteer) localStorage.setItem(VOLUNTEER_KEY, JSON.stringify(volunteer));
  else localStorage.removeItem(VOLUNTEER_KEY);
  if (backendReady && volunteer) {
    apiFetch(`/volunteers/${encodeURIComponent(volunteer.id)}`, { method: "PUT", body: JSON.stringify(volunteer) }).catch(() => {});
  }
}

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = workerToken || volunteerToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "The demo backend is unavailable.");
  }
  return response.status === 204 ? null : response.json();
}

async function loadBackendReports(silent = false) {
  let latestReports;
  try {
    latestReports = await apiFetch("/reports");
  } catch {
    if (!silent) showToast("Using this browser’s cached demo data while the backend reconnects.");
    return false;
  }
  reports = latestReports;
  backendReady = true;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reports)); } catch {}
  drawReportMarkers();
  renderDashboard();
  renderVolunteerPortal();
  return true;
}

function persistReport(report) {
  return apiFetch(`/reports/${encodeURIComponent(report.id)}`, { method: "PUT", body: JSON.stringify(report) });
}

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this photo."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("This image format could not be previewed."));
      image.onload = () => {
        const maxDimension = 1000;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", .76));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function clearSelectedPhoto() {
  selectedPhotoDataUrl = "";
  document.querySelector("#photo-input").value = "";
  document.querySelector("#photo-preview").hidden = true;
  document.querySelector("#photo-preview-image").removeAttribute("src");
}

function validPhotoSource(value) {
  return typeof value === "string" && /^data:image\/(jpeg|png|webp);base64,/i.test(value) ? value : "";
}

function initMap() {
  if (!window.L) {
    document.querySelector("#map").innerHTML = '<div style="height:100%;display:grid;place-items:center;padding:30px;text-align:center;color:#173f35"><div><strong>Map unavailable offline</strong><p>Connect to the internet to load the interactive Singapore map.</p></div></div>';
    return;
  }
  map = L.map("map", { zoomControl: false, minZoom: 10, maxBounds: [[1.16, 103.55], [1.49, 104.15]] }).setView([1.3521, 103.8198], 12);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
  satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community"
  });
  streetLayer.addTo(map);
  map.on("click", (event) => {
    if (!isSingaporePoint(event.latlng.lat, event.latlng.lng)) return rejectOutsideSingapore();
    if (searchAreaMarker) {
      searchAreaMarker.remove();
      searchAreaMarker = null;
    }
    chooseLocation(event.latlng.lat, event.latlng.lng);
  });
  drawReportMarkers();
}

function setMapStyle(style) {
  if (!map || !streetLayer || !satelliteLayer) return;
  const useSatellite = style === "satellite";
  if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer);
  if (map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer);
  (useSatellite ? satelliteLayer : streetLayer).addTo(map);
  document.querySelectorAll("[data-map-style]").forEach(button => {
    const active = button.dataset.mapStyle === style;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function chooseLocation(lat, lng) {
  selectedLocation = { lat, lng, name: estimatedArea(lat, lng) };
  document.querySelector("#report-form-error").hidden = true;
  if (map) {
    if (locationMarker) locationMarker.remove();
    locationMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    locationMarker.on("dragend", (event) => {
      const point = event.target.getLatLng();
      if (!isSingaporePoint(point.lat, point.lng)) {
        event.target.setLatLng([selectedLocation.lat, selectedLocation.lng]);
        rejectOutsideSingapore();
        return;
      }
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

function searchResultLabel(result) {
  const address = result.address || {};
  return result.name || address.road || address.park || address.suburb || result.display_name.split(",")[0];
}

function renderSearchResults(results, message = "") {
  const container = document.querySelector("#map-search-results");
  if (message) {
    container.innerHTML = `<p class="search-message">${escapeHtml(message)}</p>`;
    container.hidden = false;
    return;
  }
  container.innerHTML = results.map((result, index) => {
    const parts = result.display_name.split(",").map(part => part.trim());
    return `<button class="search-result" data-search-index="${index}" type="button"><strong>${escapeHtml(searchResultLabel(result))}</strong><small>${escapeHtml(parts.slice(1, 4).join(", ") || "Singapore")}</small></button>`;
  }).join("") + '<div class="search-credit">Search © OpenStreetMap contributors</div>';
  container.hidden = false;
  container.querySelectorAll("[data-search-index]").forEach(button => button.addEventListener("click", () => {
    const result = results[Number(button.dataset.searchIndex)];
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!isSingaporePoint(lat, lng)) {
      button.disabled = true;
      button.querySelector("small").textContent = "Outside Singapore — not selectable";
      return;
    }
    container.hidden = true;
    document.querySelector("#map-search-input").value = searchResultLabel(result);
    if (searchAreaMarker) searchAreaMarker.remove();
    searchAreaMarker = L.circle([lat, lng], {
      radius: 260,
      color: "#f7ff72",
      weight: 3,
      fillColor: "#f7ff72",
      fillOpacity: .18,
      interactive: false
    }).addTo(map);
    map.flyTo([lat, lng], 15, { duration: .8 });
    const hint = document.querySelector("#map-hint");
    hint.innerHTML = `<span>＋</span> ${escapeHtml(searchResultLabel(result))} is highlighted — click the animal’s exact location`;
    showToast(`Zoomed to ${searchResultLabel(result)}. Now click the exact location on the map.`);
  }));
}

async function searchSingapore(query) {
  const normalized = query.trim().toLowerCase();
  const cacheKey = `wildcare-search-${normalized}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {}
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
    countrycodes: "sg",
    viewbox: "103.55,1.49,104.15,1.16",
    bounded: "1",
    "accept-language": "en"
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!response.ok) throw new Error("Search is temporarily unavailable.");
  const results = (await response.json()).filter(result => result.address?.country_code === "sg" && isSingaporePoint(Number(result.lat), Number(result.lon)));
  try { localStorage.setItem(cacheKey, JSON.stringify(results)); } catch {}
  return results;
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
  if (viewName === "worker") {
    const latestVolunteerReport = reports.filter(report => report.volunteerStatus).sort((a, b) => (b.volunteerUpdatedAt || b.volunteerArrivedAt || 0) - (a.volunteerUpdatedAt || a.volunteerArrivedAt || 0))[0];
    if (latestVolunteerReport) selectedReportId = latestVolunteerReport.id;
    renderDashboard();
  }
  if (viewName === "volunteer") renderVolunteerPortal();
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
  sessionStorage.removeItem("wildcare-worker-token");
  workerToken = "";
  loadBackendReports();
  switchView("reporter");
  showToast("You have logged out of the Rescue Team Portal.");
}

function relativeTime(timestamp) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function exactTime(timestamp) {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Singapore",
    timeZoneName: "short"
  }).format(new Date(timestamp));
}

function estimatedArea(lat, lng) {
  if (lng < 103.79) return "Western Singapore";
  if (lng > 103.9) return "Eastern Singapore";
  if (lat > 1.36) return "Northern Singapore";
  if (lat < 1.29) return "Southern Singapore";
  return "Central Singapore";
}

function statusClass(status) {
  return String(status).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function statusLabel(status) {
  return ({
    "New": "Submitted",
    "Acknowledged": "Response accepted",
    "Assigned": "Rescue team assigned",
    "Urgent": "Urgent attention",
    "Reported deceased": "Possible deceased animal",
    "Resolved": "Closed"
  })[status] || status;
}

function addCaseEvent(report, label) {
  report.history = Array.isArray(report.history) ? report.history : [{ label: "Report submitted", at: report.createdAt }];
  report.history.push({ label, at: Date.now() });
}

function casePriority(report) {
  return ({ "Urgent": 0, "Reported deceased": 0, "Assigned": 1, "Acknowledged": 2, "New": 3, "Resolved": 4 })[report.status] ?? 3;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRadians = degrees => degrees * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderDashboard() {
  const active = reports.filter(report => report.status !== "Resolved");
  const newReports = reports.filter(report => report.status === "New");
  const assigned = reports.filter(report => report.status === "Assigned");
  const resolved = reports.filter(report => report.status === "Resolved");
  const deceased = reports.filter(report => report.status === "Reported deceased");
  const stats = [
    ["Submitted", newReports.length, "●"],
    ["Active cases", active.length, "↗"],
    ["Volunteer responses", reports.filter(report => report.volunteerStatus).length, "♡"],
    ["Deceased reports", deceased.length, "!"]
  ];
  document.querySelector("#stats-grid").innerHTML = stats.map(([label, number, icon]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-number">${number}</div></article>`).join("");

  const visible = reports.filter(report => {
    if (currentFilter === "active") return report.status !== "Resolved";
    if (currentFilter === "volunteers") return Boolean(report.volunteerStatus);
    if (currentFilter === "resolved") return report.status === "Resolved";
    return true;
  }).sort((a, b) => casePriority(a) - casePriority(b) || (b.volunteerUpdatedAt || b.createdAt) - (a.volunteerUpdatedAt || a.createdAt));

  document.querySelector("#queue-count").textContent = visible.length;
  const list = document.querySelector("#report-list");
  list.innerHTML = visible.length ? visible.map(report => `
    <button class="report-card ${selectedReportId === report.id ? "selected" : ""}" data-report-id="${report.id}" type="button">
      <span class="animal-avatar">${animalEmoji[report.animal] || "🐾"}</span>
      <span class="report-copy"><strong>${escapeHtml(report.animal)} · ${escapeHtml(report.condition)}</strong><p>${escapeHtml(report.notes)}</p>${report.volunteerStatus ? `<span class="volunteer-card-badge">♡ ${escapeHtml(report.volunteerStatus)}</span>` : ""}<small>⌖ ${escapeHtml(report.area)}</small><small class="report-time">${relativeTime(report.createdAt)} · ${exactTime(report.createdAt)}</small></span>
      <span class="status-pill status-${statusClass(report.status)}">${escapeHtml(statusLabel(report.status))}</span>
    </button>`).join("") : '<div class="empty-detail"><span>✓</span><h3>No reports here</h3><p>There are no reports matching this filter.</p></div>';

  list.querySelectorAll("[data-report-id]").forEach(button => button.addEventListener("click", () => selectReport(button.dataset.reportId)));
  if (selectedReportId && reports.some(report => report.id === selectedReportId)) renderReportDetail(selectedReportId);
}

function selectReport(id) {
  selectedReportId = id;
  renderDashboard();
  if (window.matchMedia("(max-width: 950px)").matches) {
    setTimeout(() => document.querySelector("#detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }
}

function renderReportDetail(id) {
  const report = reports.find(item => item.id === id);
  if (!report) return;
  const panel = document.querySelector("#detail-panel");
  panel.innerHTML = `<div class="detail-content">
    <div class="detail-top"><div><span class="case-id">Case ${escapeHtml(report.id)}</span><h2>${animalEmoji[report.animal]} ${escapeHtml(report.animal)}</h2><span class="status-pill status-${statusClass(report.status)}">${escapeHtml(statusLabel(report.status))}</span></div><span class="animal-avatar">${animalEmoji[report.animal]}</span></div>
    <div class="detail-map" id="detail-map" aria-label="Map showing the selected report location"></div>
    <div class="detail-meta">
      <div class="meta-box"><small>Location</small><strong>${escapeHtml(report.area)}</strong></div>
      <div class="meta-box"><small>Reported</small><strong>${relativeTime(report.createdAt)}</strong><span class="exact-time">${exactTime(report.createdAt)}</span></div>
      <div class="meta-box"><small>Condition</small><strong>${escapeHtml(report.condition)}</strong></div>
      <div class="meta-box"><small>Reporter</small><strong>${escapeHtml(report.reporter || "Anonymous")}</strong></div>
    </div>
    <p class="notes-box">${escapeHtml(report.notes)}</p>
    ${validPhotoSource(report.photo) ? `<figure class="case-photo"><img src="${validPhotoSource(report.photo)}" alt="Photo attached to case ${escapeHtml(report.id)}" /><figcaption>Photo supplied with this demo report</figcaption></figure>` : ""}
    ${report.volunteerStatus ? `<section class="volunteer-update"><div><span>♡</span><div><small>Volunteer response</small><strong>${escapeHtml(report.volunteerName || "Demo volunteer")} · ${escapeHtml(report.volunteerStatus)}</strong></div></div>${report.volunteerAssessment ? `<p><strong>${escapeHtml(report.volunteerAssessment)}</strong>${report.volunteerNotes ? ` — ${escapeHtml(report.volunteerNotes)}` : ""}</p>` : ""}</section>` : ""}
    ${validPhotoSource(report.volunteerPhoto) ? `<figure class="case-photo volunteer-evidence"><img src="${validPhotoSource(report.volunteerPhoto)}" alt="Volunteer observation photo for case ${escapeHtml(report.id)}" /><figcaption>Volunteer observation photo · demo</figcaption></figure>` : ""}
    <section class="case-timeline"><div class="timeline-heading"><span>Case progress</span><small>Newest update last</small></div><ol>${(Array.isArray(report.history) ? report.history : [{ label: "Report submitted", at: report.createdAt }]).map((event, index, history) => `<li class="${index === history.length - 1 ? "current" : ""}"><span></span><div><strong>${escapeHtml(event.label)}</strong><small>${relativeTime(event.at)} · ${exactTime(event.at)}</small></div></li>`).join("")}</ol></section>
    <div class="status-control"><label for="case-status">Update case status</label><select id="case-status">
      ${["New", "Acknowledged", "Assigned", "Urgent", "Reported deceased", "Resolved"].map(status => `<option value="${status}" ${status === report.status ? "selected" : ""}>${escapeHtml(statusLabel(status))}</option>`).join("")}
    </select></div>
  </div>`;
  panel.querySelector("#case-status").addEventListener("change", event => {
    const nextStatus = event.target.value;
    if (report.status === "Resolved" && nextStatus !== "Resolved") {
      event.target.value = "Resolved";
      pendingReopen = { report, nextStatus };
      document.querySelector("#reopen-case-id").textContent = report.id;
      document.querySelector("#reopen-dialog").showModal();
      return;
    }
    updateReportStatus(report, nextStatus);
  });
  setTimeout(() => renderDetailMap(report), 0);
}

function renderVolunteerPortal() {
  const registration = document.querySelector("#volunteer-registration");
  const dashboard = document.querySelector("#volunteer-dashboard");
  const accountActions = document.querySelector("#volunteer-account-actions");
  registration.hidden = Boolean(volunteer);
  dashboard.hidden = !volunteer;
  accountActions.hidden = !volunteer;
  if (!volunteer) {
    setTimeout(initVolunteerMap, 80);
    return;
  }

  document.querySelector("#volunteer-name").textContent = volunteer.name;
  document.querySelector("#volunteer-area").textContent = volunteer.areaName;
  document.querySelector("#volunteer-radius-summary").textContent = `${volunteer.radius} km`;
  document.querySelector("#volunteer-islands-toggle").checked = Boolean(volunteer.canTravelToIslands);
  document.querySelector("#volunteer-islands-label").textContent = volunteer.canTravelToIslands ? "Available" : "Mainland only";
  const nearby = reports.map(report => ({ report, distance: distanceKm(volunteer.lat, volunteer.lng, report.lat, report.lng) }))
    .filter(item => item.report.status !== "Resolved" && item.distance <= volunteer.radius && (volunteer.canTravelToIslands || !isOffshoreLocation(item.report)))
    .sort((a, b) => a.distance - b.distance);
  document.querySelector("#nearby-count").textContent = nearby.length;
  const container = document.querySelector("#nearby-cases");
  container.innerHTML = nearby.length ? nearby.map(({ report, distance }) => {
    const isMine = report.volunteerId === volunteer.id;
    const claimedByOther = report.volunteerId && !isMine;
    const action = !report.volunteerStatus
      ? `<button class="primary-button volunteer-case-action" data-volunteer-action="claim" data-report-id="${report.id}" type="button">Offer to observe</button>`
      : isMine && report.volunteerStatus === "On the way"
        ? `<button class="primary-button volunteer-case-action" data-volunteer-action="arrive" data-report-id="${report.id}" type="button">I’ve arrived</button>`
        : isMine && report.volunteerStatus === "Arrived"
          ? `<button class="primary-button volunteer-case-action" data-volunteer-action="assess" data-report-id="${report.id}" type="button">Send on-site update</button>`
          : `<span class="volunteer-state">${claimedByOther ? "Another volunteer is responding" : escapeHtml(report.volunteerStatus)}</span>`;
    return `<article class="nearby-case ${isMine ? "mine" : ""}"><div class="nearby-case-top"><span class="animal-avatar">${animalEmoji[report.animal] || "🐾"}</span><div><span class="case-id">${escapeHtml(report.id)} · ${distance.toFixed(1)} km away</span><h3>${escapeHtml(report.animal)} · ${escapeHtml(report.condition)}</h3></div><span class="status-pill status-${statusClass(report.status)}">${escapeHtml(statusLabel(report.status))}</span></div><p>${escapeHtml(report.notes)}</p><div class="nearby-location">⌖ ${escapeHtml(report.area)} · ${relativeTime(report.createdAt)} · ${exactTime(report.createdAt)}</div><div class="safe-task"><strong>Your role:</strong> Observe from a safe distance and update the rescue team.</div>${action}</article>`;
  }).join("") : '<div class="empty-detail"><span>✓</span><h3>No active cases nearby</h3><p>There are currently no demo reports inside your selected travel radius.</p></div>';
  container.querySelectorAll("[data-volunteer-action]").forEach(button => button.addEventListener("click", () => handleVolunteerAction(button.dataset.volunteerAction, button.dataset.reportId)));
}

function isOffshoreLocation(report) {
  const area = String(report.area || "");
  if (/\b(pulau|island|sentosa|ubin|tekong|kusu|lazarus|st\.? john|sisters?)\b/i.test(area)) return true;
  const lat = Number(report.lat);
  const lng = Number(report.lng);
  return lat < 1.257 ||
    (lat < 1.275 && lng > 103.79 && lng < 103.88) ||
    (lat > 1.38 && lng > 103.91) ||
    (lat < 1.27 && lng < 103.73);
}

function initVolunteerMap() {
  const container = document.querySelector("#volunteer-map");
  if (!container || container.offsetParent === null || !window.L) return;
  if (!volunteerMap) {
    volunteerMap = L.map("volunteer-map", { zoomControl: true, minZoom: 10, maxBounds: [[1.16, 103.55], [1.49, 104.15]] }).setView([1.3521, 103.8198], 11);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community" }).addTo(volunteerMap);
    volunteerMap.on("click", event => setVolunteerLocation(event.latlng.lat, event.latlng.lng));
  }
  volunteerMap.invalidateSize();
}

function setVolunteerLocation(lat, lng) {
  const error = document.querySelector("#volunteer-form-error");
  if (!isSingaporePoint(lat, lng)) {
    error.textContent = "Choose a starting location within Singapore.";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  pendingVolunteerLocation = { lat, lng, name: estimatedArea(lat, lng) };
  if (volunteerLocationMarker) volunteerLocationMarker.remove();
  volunteerLocationMarker = L.marker([lat, lng], { draggable: true }).addTo(volunteerMap);
  volunteerLocationMarker.on("dragend", event => {
    const point = event.target.getLatLng();
    if (!isSingaporePoint(point.lat, point.lng)) {
      event.target.setLatLng([pendingVolunteerLocation.lat, pendingVolunteerLocation.lng]);
      showToast("Choose a starting location within Singapore.");
      return;
    }
    setVolunteerLocation(point.lat, point.lng);
  });
  updateVolunteerRadiusCircle();
  const label = document.querySelector("#volunteer-location-label");
  label.innerHTML = `<span>⌖</span><div><strong>Finding the nearest street…</strong><small>${lat.toFixed(4)}, ${lng.toFixed(4)}</small></div>`;
  reverseVolunteerLocation(lat, lng);
}

function updateVolunteerRadiusCircle() {
  const radius = Number(document.querySelector("#volunteer-radius").value);
  document.querySelector("#volunteer-radius-output").textContent = `${radius} km`;
  if (!pendingVolunteerLocation || !volunteerMap) return;
  if (volunteerRadiusCircle) volunteerRadiusCircle.remove();
  volunteerRadiusCircle = L.circle([pendingVolunteerLocation.lat, pendingVolunteerLocation.lng], { radius: radius * 1000, color: "#d7f36c", weight: 2, fillColor: "#d7f36c", fillOpacity: .18, interactive: false }).addTo(volunteerMap);
  volunteerRadiusCircle.bringToBack();
}

async function reverseVolunteerLocation(lat, lng) {
  try {
    const params = new URLSearchParams({ format: "jsonv2", lat, lon: lng, zoom: "18", addressdetails: "1", "accept-language": "en" });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
    if (!response.ok) throw new Error();
    const result = await response.json();
    const address = result.address || {};
    const place = address.road || address.neighbourhood || address.suburb || address.city_district || result.name || estimatedArea(lat, lng);
    if (pendingVolunteerLocation && Math.abs(pendingVolunteerLocation.lat - lat) < .0001 && Math.abs(pendingVolunteerLocation.lng - lng) < .0001) pendingVolunteerLocation.name = place;
  } catch {}
  if (!pendingVolunteerLocation || Math.abs(pendingVolunteerLocation.lat - lat) >= .0001 || Math.abs(pendingVolunteerLocation.lng - lng) >= .0001) return;
  document.querySelector("#volunteer-location-label").innerHTML = `<span>⌖</span><div><strong>${escapeHtml(pendingVolunteerLocation.name)}</strong><small>${lat.toFixed(4)}, ${lng.toFixed(4)}</small></div>`;
}

function handleVolunteerAction(action, reportId) {
  const report = reports.find(item => item.id === reportId);
  if (!report || !volunteer) return;
  if (action === "claim") {
    report.volunteerId = volunteer.id;
    report.volunteerName = volunteer.name;
    report.volunteerStatus = "On the way";
    report.status = report.status === "New" ? "Acknowledged" : report.status;
    addCaseEvent(report, `${volunteer.name} offered to observe`);
    saveReports();
    renderVolunteerPortal();
    showToast(`You are now observing case ${report.id}. Travel safely.`);
  } else if (action === "arrive") {
    report.volunteerStatus = "Arrived";
    report.volunteerArrivedAt = Date.now();
    addCaseEvent(report, "Volunteer arrived nearby");
    saveReports();
    renderVolunteerPortal();
    showToast("Arrival shared with the rescue team. Keep a safe distance.");
  } else if (action === "assess") {
    volunteerAssessmentReportId = report.id;
    volunteerPhotoDataUrl = "";
    document.querySelector("#volunteer-assessment-form").reset();
    document.querySelector("#volunteer-photo-preview").hidden = true;
    document.querySelector("#assessment-case-id").textContent = `Case ${report.id}`;
    document.querySelector("#assessment-location").textContent = report.area;
    document.querySelector("#volunteer-assessment-dialog").showModal();
  }
}

function updateReportStatus(report, nextStatus) {
  report.status = nextStatus;
  addCaseEvent(report, `Status changed to ${statusLabel(nextStatus)}`);
  saveReports();
  drawReportMarkers();
  showToast(`Case ${report.id} updated to ${report.status}.`);
  renderDashboard();
}

function renderDetailMap(report) {
  if (!window.L || !document.querySelector("#detail-map")) return;
  if (detailMap) detailMap.remove();
  detailMap = L.map("detail-map", { zoomControl: true, attributionControl: true, dragging: true, scrollWheelZoom: false }).setView([report.lat, report.lng], 16);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community" }).addTo(detailMap);
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
document.querySelectorAll("[data-map-style]").forEach(button => button.addEventListener("click", () => setMapStyle(button.dataset.mapStyle)));
document.querySelector("#map-search-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = document.querySelector("#map-search-input");
  const button = event.currentTarget.querySelector("button");
  const query = input.value.trim();
  if (!query) return;
  button.disabled = true;
  button.textContent = "Searching…";
  renderSearchResults([], "Searching Singapore…");
  try {
    const results = await searchSingapore(query);
    results.length ? renderSearchResults(results) : renderSearchResults([], "No selectable Singapore locations found. Try a Singapore street, park, landmark, or postcode.");
  } catch (error) {
    renderSearchResults([], error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Search";
  }
});
const demoWarningDialog = document.querySelector("#demo-warning-dialog");
demoWarningDialog.addEventListener("cancel", event => event.preventDefault());
document.querySelector("#acknowledge-demo").addEventListener("click", () => {
  sessionStorage.setItem(DEMO_WARNING_KEY, "true");
  demoWarningDialog.close();
  if (isRescueEntry) setTimeout(() => switchView("worker"), 80);
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
const reopenDialog = document.querySelector("#reopen-dialog");
reopenDialog.addEventListener("cancel", () => { pendingReopen = null; });
document.querySelector("#keep-resolved").addEventListener("click", () => {
  pendingReopen = null;
  reopenDialog.close();
});
document.querySelector("#confirm-reopen").addEventListener("click", () => {
  if (pendingReopen) updateReportStatus(pendingReopen.report, pendingReopen.nextStatus);
  pendingReopen = null;
  reopenDialog.close();
});
document.querySelector("#close-login").addEventListener("click", () => document.querySelector("#login-dialog").close());
document.querySelector("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const pinInput = document.querySelector("#worker-pin");
  try {
    const result = await apiFetch("/auth/worker", { method: "POST", body: JSON.stringify({ pin: pinInput.value }) });
    workerToken = result.token;
  } catch {
    document.querySelector("#login-error").textContent = "That PIN is incorrect or the demo backend is unavailable.";
    pinInput.select();
    return;
  }
  workerAuthenticated = true;
  sessionStorage.setItem("wildcare-worker-auth", "true");
  sessionStorage.setItem("wildcare-worker-token", workerToken);
  await loadBackendReports();
  document.querySelector("#login-dialog").close();
  switchView("worker");
  showToast("Rescue Team Portal unlocked.");
});
document.querySelector("#worker-logout").addEventListener("click", logoutWorker);
document.querySelector("#new-report-worker").addEventListener("click", () => switchView("reporter"));
document.querySelector("#reset-demo").addEventListener("click", async () => {
  try {
    reports = await apiFetch("/reports/reset", { method: "POST" });
    selectedReportId = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
    drawReportMarkers();
    renderDashboard();
    renderVolunteerPortal();
    showToast("Shared demo reports have been reset.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#locate-button").addEventListener("click", () => {
  if (!navigator.geolocation) return showToast("Location is not available in this browser.");
  if (!map || !window.L) return showToast("The map is not ready yet.");
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    if (!isSingaporePoint(latitude, longitude)) {
      showToast("Your location appears to be outside Singapore and cannot be selected.");
      return;
    }
    const approximateLat = Number(latitude.toFixed(3));
    const approximateLng = Number(longitude.toFixed(3));
    const radius = Math.min(500, Math.max(150, Number(position.coords.accuracy) || 200));
    selectedLocation = null;
    if (locationMarker) {
      locationMarker.remove();
      locationMarker = null;
    }
    if (searchAreaMarker) searchAreaMarker.remove();
    searchAreaMarker = L.circle([approximateLat, approximateLng], {
      radius,
      color: "#173f35",
      weight: 3,
      fillColor: "#d7f36c",
      fillOpacity: .24,
      interactive: false
    }).addTo(map);
    map?.flyTo([approximateLat, approximateLng], 15, { duration: .8 });
    const hint = document.querySelector("#map-hint");
    hint.innerHTML = "<span>＋</span> Your nearby area is highlighted — tap the animal’s location";
    showToast("Nearby area found. Now tap the map where you saw the animal.");
  }, () => showToast("We could not access your location. Tap the map instead."), {
    enableHighAccuracy: false,
    maximumAge: 60000,
    timeout: 10000
  });
});

document.querySelector("#report-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!selectedLocation) return showToast("Please choose a location on the map first.");
  const error = document.querySelector("#report-form-error");
  const submitButton = document.querySelector("#send-report-button");
  if (submitButton.disabled) return;
  const selectedAnimal = event.currentTarget.querySelector('[name="animal"]:checked');
  const condition = event.currentTarget.elements.condition.value;
  const notes = event.currentTarget.elements.notes.value.trim();
  if (!selectedAnimal || !condition || !notes) {
    error.textContent = !selectedAnimal ? "Choose the animal type." : !condition ? "Select what seems to be wrong." : "Describe what you can safely observe.";
    error.hidden = false;
    const target = !selectedAnimal ? event.currentTarget.querySelector(".animal-options") : !condition ? event.currentTarget.elements.condition : event.currentTarget.elements.notes;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  error.hidden = true;
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.querySelector("span").textContent = "Sending…";
  const reportDialog = document.querySelector("#report-dialog");
  reportDialog.close();
  showToast("Sending your report…");
  const data = new FormData(event.currentTarget);
  const reportDraft = {
    clientRequestId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    animal: data.get("animal"),
    condition: data.get("condition"),
    notes: data.get("notes"),
    reporter: data.get("reporter") || "Anonymous",
    contact: data.get("contact") || "",
    lat: selectedLocation.lat,
    lng: selectedLocation.lng,
    area: selectedLocation.name || estimatedArea(selectedLocation.lat, selectedLocation.lng)
  };
  reportDraft.photo = selectedPhotoDataUrl;
  let report;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        report = await apiFetch("/reports", { method: "POST", body: JSON.stringify(reportDraft), signal: controller.signal });
        break;
      } catch (sendError) {
        if (sendError.name !== "AbortError" || attempt === 1) throw sendError;
        submitButton.querySelector("span").textContent = "Confirming…";
      } finally {
        clearTimeout(timeout);
      }
    }
    backendReady = true;
  } catch (backendError) {
    error.textContent = backendError.message;
    error.hidden = false;
    if (!reportDialog.open) reportDialog.showModal();
    error.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
    submitButton.querySelector("span").textContent = "Send report";
  }
  reports.unshift(report);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reports)); } catch {}
  try { drawReportMarkers(); } catch {}
  event.currentTarget.reset();
  clearSelectedPhoto();
  if (locationMarker) { locationMarker.remove(); locationMarker = null; }
  if (searchAreaMarker) { searchAreaMarker.remove(); searchAreaMarker = null; }
  selectedReportId = report.id;
  document.querySelector("#success-case-id").textContent = report.id;
  showToast(`Report ${report.id} sent successfully.`);
  const successDialog = document.querySelector("#success-dialog");
  setTimeout(() => {
    if (!successDialog.open) successDialog.showModal();
  }, 80);
});

document.querySelector("#photo-input").addEventListener("change", async event => {
  const label = event.target.closest("label");
  const helper = label.querySelector("small");
  const file = event.target.files[0];
  if (!file) return clearSelectedPhoto();
  helper.textContent = "Preparing photo preview…";
  try {
    selectedPhotoDataUrl = await compressPhoto(file);
    document.querySelector("#photo-preview-image").src = selectedPhotoDataUrl;
    document.querySelector("#photo-preview-name").textContent = file.name;
    document.querySelector("#photo-preview").hidden = false;
    helper.textContent = "Photo added — it will appear in the Rescue Team Portal";
  } catch (error) {
    clearSelectedPhoto();
    helper.textContent = "Optional — stored in the shared demo for the Rescue Team Portal";
    showToast(error.message);
  }
});
document.querySelector("#remove-photo").addEventListener("click", clearSelectedPhoto);

function setVolunteerAccountMode(mode) {
  const signingIn = mode === "signin";
  document.querySelector("#volunteer-signin-fields").hidden = !signingIn;
  document.querySelector("#volunteer-signup-fields").hidden = signingIn;
  document.querySelectorAll("[data-account-mode]").forEach(button => button.classList.toggle("active", button.dataset.accountMode === mode));
  document.querySelectorAll("#volunteer-signup-fields input").forEach(input => {
    if (input.dataset.wasRequired === "true") input.required = !signingIn;
  });
  const username = document.querySelector('[name="signinUsername"]');
  const password = document.querySelector('[name="signinPassword"]');
  username.required = signingIn;
  password.required = signingIn;
  document.querySelector("#volunteer-form-error").hidden = true;
  document.querySelector("#volunteer-signin-error").hidden = true;
  (signingIn ? username : document.querySelector('[name="name"]')).focus();
}

document.querySelectorAll("#volunteer-signup-fields input[required]").forEach(input => { input.dataset.wasRequired = "true"; });
document.querySelectorAll("[data-account-mode]").forEach(button => button.addEventListener("click", () => setVolunteerAccountMode(button.dataset.accountMode)));

document.querySelector("#volunteer-signin-button").addEventListener("click", async () => {
  const username = document.querySelector('[name="signinUsername"]');
  const password = document.querySelector('[name="signinPassword"]');
  const error = document.querySelector("#volunteer-signin-error");
  if (!username.value.trim() || !password.value) {
    error.textContent = "Enter your username and password.";
    error.hidden = false;
    return;
  }
  try {
    const result = await apiFetch("/auth/volunteer-signin", { method: "POST", body: JSON.stringify({ username: username.value.trim(), password: password.value }) });
    volunteer = result.volunteer;
    volunteerToken = result.token;
    localStorage.setItem("wildcare-volunteer-token", volunteerToken);
    saveVolunteer();
    renderVolunteerPortal();
    document.querySelector("#volunteer-form").reset();
    showToast(`Welcome back, ${volunteer.name}.`);
  } catch (signinError) {
    error.textContent = signinError.message;
    error.hidden = false;
  }
});

document.querySelector("#volunteer-form").addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const error = document.querySelector("#volunteer-form-error");
  if (!pendingVolunteerLocation) {
    error.textContent = "Tap the map to choose your approximate starting location.";
    error.hidden = false;
    document.querySelector("#volunteer-map").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (data.get("password") !== data.get("confirmPassword")) {
    error.textContent = "The passwords do not match.";
    error.hidden = false;
    event.currentTarget.elements.confirmPassword.focus();
    return;
  }
  error.hidden = true;
  const profile = {
    name: data.get("name").trim(),
    contact: data.get("contact").trim(),
    areaName: pendingVolunteerLocation.name,
    lat: pendingVolunteerLocation.lat,
    lng: pendingVolunteerLocation.lng,
    radius: Number(data.get("radius")),
    canTravelToIslands: data.get("canTravelToIslands") === "on",
    demoAgreementAcceptedAt: data.get("agreement") === "on" ? Date.now() : null,
    registeredAt: Date.now()
  };
  try {
    const result = await apiFetch("/auth/volunteer-signup", {
      method: "POST",
      body: JSON.stringify({ username: data.get("username").trim(), password: data.get("password"), profile })
    });
    volunteer = result.volunteer;
    volunteerToken = result.token;
    localStorage.setItem("wildcare-volunteer-token", volunteerToken);
  } catch (signupError) {
    error.textContent = signupError.message;
    error.hidden = false;
    return;
  }
  saveVolunteer();
  renderVolunteerPortal();
  showToast("Demo volunteer profile created. Nearby cases are ready.");
});

document.querySelector("#volunteer-reset").addEventListener("click", () => {
  volunteer = null;
  saveVolunteer();
  document.querySelector("#volunteer-form").reset();
  pendingVolunteerLocation = null;
  if (volunteerLocationMarker) { volunteerLocationMarker.remove(); volunteerLocationMarker = null; }
  if (volunteerRadiusCircle) { volunteerRadiusCircle.remove(); volunteerRadiusCircle = null; }
  document.querySelector("#volunteer-radius-output").textContent = "5 km";
  document.querySelector("#volunteer-location-label").innerHTML = '<span>⌖</span><div><strong>No location selected</strong><small>Tap anywhere within Singapore</small></div>';
  renderVolunteerPortal();
  volunteerToken = "";
  localStorage.removeItem("wildcare-volunteer-token");
  setVolunteerAccountMode("signin");
  showToast("Signed out of the volunteer account.");
});
const deleteVolunteerDialog = document.querySelector("#delete-volunteer-dialog");
document.querySelector("#volunteer-delete").addEventListener("click", () => deleteVolunteerDialog.showModal());
document.querySelector("#cancel-volunteer-delete").addEventListener("click", () => deleteVolunteerDialog.close());
document.querySelector("#confirm-volunteer-delete").addEventListener("click", async event => {
  if (!volunteer) return deleteVolunteerDialog.close();
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Deleting…";
  try {
    await apiFetch(`/volunteers/${encodeURIComponent(volunteer.id)}`, { method: "DELETE" });
    volunteer = null;
    volunteerToken = "";
    localStorage.removeItem(VOLUNTEER_KEY);
    localStorage.removeItem("wildcare-volunteer-token");
    deleteVolunteerDialog.close();
    document.querySelector("#volunteer-form").reset();
    setVolunteerAccountMode("signup");
    renderVolunteerPortal();
    showToast("Volunteer account deleted.");
  } catch (deleteError) {
    showToast(deleteError.message);
  } finally {
    button.disabled = false;
    button.textContent = "Delete account";
  }
});
document.querySelector("#volunteer-radius").addEventListener("input", updateVolunteerRadiusCircle);
document.querySelector("#volunteer-islands-toggle").addEventListener("change", event => {
  if (!volunteer) return;
  volunteer.canTravelToIslands = event.currentTarget.checked;
  saveVolunteer();
  renderVolunteerPortal();
  showToast(volunteer.canTravelToIslands ? "Offshore island cases are now included." : "Showing mainland cases only.");
});

document.querySelector("#close-volunteer-assessment").addEventListener("click", () => document.querySelector("#volunteer-assessment-dialog").close());

function clearVolunteerPhoto() {
  volunteerPhotoDataUrl = "";
  document.querySelector("#volunteer-photo-input").value = "";
  document.querySelector("#volunteer-photo-preview").hidden = true;
  document.querySelector("#volunteer-photo-preview-image").removeAttribute("src");
}

document.querySelector("#volunteer-photo-input").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return clearVolunteerPhoto();
  const helper = document.querySelector("#volunteer-photo-help");
  helper.textContent = "Preparing photo preview…";
  try {
    volunteerPhotoDataUrl = await compressPhoto(file);
    document.querySelector("#volunteer-photo-preview-image").src = volunteerPhotoDataUrl;
    document.querySelector("#volunteer-photo-preview-name").textContent = file.name;
    document.querySelector("#volunteer-photo-preview").hidden = false;
    helper.textContent = "Photo ready for the rescue team";
  } catch (error) {
    clearVolunteerPhoto();
    helper.textContent = "Required for serious or deceased reports";
    showToast(error.message);
  }
});
document.querySelector("#remove-volunteer-photo").addEventListener("click", clearVolunteerPhoto);

document.querySelector("#volunteer-assessment-form").addEventListener("submit", event => {
  event.preventDefault();
  const report = reports.find(item => item.id === volunteerAssessmentReportId);
  if (!report) return showToast("This demo case could not be found.");
  const data = new FormData(event.currentTarget);
  const outcome = data.get("outcome");
  if (["serious", "deceased"].includes(outcome) && !volunteerPhotoDataUrl) return showToast("Please add a photo for a serious or deceased report.");
  report.volunteerStatus = "Assessment sent";
  report.volunteerNotes = data.get("notes").trim();
  report.volunteerPhoto = volunteerPhotoDataUrl;
  report.volunteerUpdatedAt = Date.now();
  if (outcome === "deceased") {
    report.volunteerAssessment = "Animal appears deceased";
    report.status = "Reported deceased";
    addCaseEvent(report, "Volunteer reported a possible deceased animal");
  } else if (outcome === "serious") {
    report.volunteerAssessment = "Alive — serious condition reported";
    report.status = "Urgent";
    addCaseEvent(report, "Volunteer reported urgent attention needed");
  } else {
    report.volunteerAssessment = "Alive — currently stable";
    if (report.status === "New") report.status = "Acknowledged";
    addCaseEvent(report, "Volunteer reported the animal is currently stable");
  }
  try {
    saveReports();
  } catch {
    return showToast("That photo is too large for browser storage. Try a smaller image.");
  }
  document.querySelector("#volunteer-assessment-dialog").close();
  clearVolunteerPhoto();
  renderVolunteerPortal();
  drawReportMarkers();
  showToast(`Update for ${report.id} is now visible to the rescue team.`);
});

initMap();
renderDashboard();
renderVolunteerPortal();
loadBackendReports();
setInterval(() => {
  const livePortalOpen = document.querySelector("#volunteer-view.active, #worker-view.active");
  if (document.visibilityState === "visible" && livePortalOpen) loadBackendReports(true);
}, 10000);
document.addEventListener("visibilitychange", () => {
  const livePortalOpen = document.querySelector("#volunteer-view.active, #worker-view.active");
  if (document.visibilityState === "visible" && livePortalOpen) loadBackendReports(true);
});
if (sessionStorage.getItem(DEMO_WARNING_KEY) !== "true") demoWarningDialog.showModal();
else if (isRescueEntry) setTimeout(() => switchView("worker"), 80);
