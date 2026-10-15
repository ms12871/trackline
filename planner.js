import { loadServiceAlerts } from "./service-alerts.js";

const STATIONS_URL = "./subway-stations.json";
const ALERTS_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts";
const ROUTER_CONFIG = window.TRACKLINE_ROUTER_CONFIG || {};
const elements = {
  form: document.querySelector("#planner-form"), origin: document.querySelector("#origin-input"),
  destination: document.querySelector("#destination-input"), originResults: document.querySelector("#origin-results"),
  destinationResults: document.querySelector("#destination-results"), locate: document.querySelector("#locate-button"),
  status: document.querySelector("#location-status"), error: document.querySelector("#planner-error"),
  itinerary: document.querySelector("#itinerary"), title: document.querySelector("#itinerary-title"),
  meta: document.querySelector("#planner-meta"), alerts: document.querySelector("#planner-alerts"),
  refresh: document.querySelector("#refresh-trip"), mapProvider: document.querySelector("#map-provider"),
  openMaps: document.querySelector("#open-maps"), geoapifyCredit: document.querySelector("#geoapify-credit")
};
let stationCatalog = [];
let origin = null;
let destination = null;
let map;
let mapLayers = [];
let userMarker;
let lastRequest;
const suggestionRequests = new WeakMap();
const recentLocationsKey = "trackline-recent-locations";
const savedPlacesKey = "trackline-saved-places";

const demoPlaces = [
  { name: "Penn Station", label: "Penn Station · Manhattan", lat: 40.7505, lon: -73.9934 },
  { name: "Jamaica Station", label: "Jamaica Station · Queens", lat: 40.7003, lon: -73.8081 },
  { name: "Woodside–61 St", label: "Woodside–61 St · Queens", lat: 40.7456, lon: -73.9029 },
  { name: "Times Square", label: "Times Square · Manhattan", lat: 40.758, lon: -73.9855 },
  { name: "Grand Central Madison", label: "Grand Central Madison · Manhattan", lat: 40.7527, lon: -73.9772 }
];

function setStatus(message) { elements.status.textContent = message; }
function showError(message) { elements.error.textContent = message; elements.error.hidden = !message; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
function minutes(value) { return `${Math.max(1, Math.round(value))} min`; }
function point(place) { return { lat: Number(place.lat ?? place.latitude), lon: Number(place.lon ?? place.longitude), name: place.name || place.label }; }

function recentLocations() {
  try {
    const saved = JSON.parse(localStorage.getItem(recentLocationsKey) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    console.error("Unable to read saved locations:", error);
    return [];
  }
}

function rememberLocation(place) {
  const locations = [place, ...recentLocations().filter((saved) => saved.name !== place.name)].slice(0, 6);
  localStorage.setItem(recentLocationsKey, JSON.stringify(locations));
}

function savedPlaces() {
  try { return JSON.parse(localStorage.getItem(savedPlacesKey) || "{}"); }
  catch (error) { console.error("Unable to read saved places:", error); return {}; }
}

function savePlace(name, place) {
  const places = savedPlaces();
  places[name] = { ...point(place), label: place.label || place.name };
  localStorage.setItem(savedPlacesKey, JSON.stringify(places));
  setStatus(`${name[0].toUpperCase()}${name.slice(1)} saved on this device.`);
}

function searchPlaces(query) {
  const normalized = query.trim().toLowerCase();
  const saved = Object.values(savedPlaces());
  if (!normalized) return [...saved, ...recentLocations()];
  return [...saved, ...recentLocations(), ...stationCatalog, ...demoPlaces]
    .filter((place, index, all) => all.findIndex((item) => item.lat === place.lat && item.lon === place.lon) === index)
    .filter((place) => `${place.name} ${place.label || ""}`.toLowerCase().includes(normalized))
    .slice(0, 6);
}

function renderSuggestionButtons(input, container, matches) {
  container.replaceChildren(...matches.map((place) => {
    const button = document.createElement("button");
    button.type = "button"; button.setAttribute("role", "option"); button.textContent = place.label || place.name;
    button.addEventListener("click", () => {
      const selected = point(place);
      input.value = place.label || place.name;
      if (input === elements.origin) origin = selected; else destination = selected;
      rememberLocation({ ...selected, label: place.label || place.name });
      container.hidden = true;
    });
    return button;
  }));
  container.hidden = matches.length === 0;
}

async function geocodePlaces(query, input, container) {
  const requestId = (suggestionRequests.get(input) || 0) + 1;
  suggestionRequests.set(input, requestId);
  try {
    if (!ROUTER_CONFIG.geoapifyKey) return;
    const params = new URLSearchParams({
      text: query, apiKey: ROUTER_CONFIG.geoapifyKey,
      filter: "rect:-74.3,40.95,-73.65,40.45", limit: "5"
    });
    const response = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params}`);
    if (!response.ok) throw new Error(`Address search returned ${response.status}`);
    const data = await response.json();
    if (suggestionRequests.get(input) !== requestId) return;
    const places = (data.features || []).map((feature) => ({
      name: feature.properties.address_line1 || feature.properties.formatted,
      label: feature.properties.formatted,
      lat: feature.properties.lat,
      lon: feature.properties.lon
    }));
    renderSuggestionButtons(input, container, [...searchPlaces(query), ...places].slice(0, 8));
  } catch (error) {
    if (suggestionRequests.get(input) === requestId) {
      console.error("Unable to search addresses:", error);
      renderSuggestionButtons(input, container, searchPlaces(query));
    }
  }
}

async function nominatimPlace(query) {
  const params = new URLSearchParams({
      format: "jsonv2", addressdetails: "1", limit: "5", countrycodes: "us",
      viewbox: "-74.3,40.95,-73.65,40.45", bounded: "1", q: query
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Address search returned ${response.status}`);
    const results = await response.json();
    return results.find((candidate) => candidate.address?.house_number) || results[0];
}

async function resolvePlace(query) {
  if (ROUTER_CONFIG.geoapifyKey) {
    const params = new URLSearchParams({ text: query, apiKey: ROUTER_CONFIG.geoapifyKey, filter: "rect:-74.3,40.95,-73.65,40.45", limit: "1" });
    const response = await fetch(`https://api.geoapify.com/v1/geocode/search?${params}`);
    if (!response.ok) throw new Error(`Address search returned ${response.status}`);
    const result = (await response.json()).features?.[0]?.properties;
    if (!result) throw new Error(`Could not find “${query}”.`);
    return { lat: result.lat, lon: result.lon, name: result.address_line1 || result.formatted, label: result.formatted };
  }
  const result = await nominatimPlace(query);
  if (!result) throw new Error(`Could not find “${query}”.`);
  return { lat: Number(result.lat), lon: Number(result.lon), name: result.display_name.split(",")[0], label: result.display_name };
}

function renderSuggestions(input, container) {
  const query = input.value.trim();
  const matches = searchPlaces(query);
  renderSuggestionButtons(input, container, matches);
  if (query.length >= 3) {
    window.clearTimeout(input.addressSearchTimer);
    input.addressSearchTimer = window.setTimeout(() => void geocodePlaces(query, input, container), 350);
  }
}

async function useLocation() {
  if (!navigator.geolocation) { setStatus("Location is not supported by this browser."); return; }
  setStatus("Requesting your location…"); elements.locate.disabled = true;
  navigator.geolocation.getCurrentPosition((position) => {
    origin = { lat: position.coords.latitude, lon: position.coords.longitude, name: "Current location" };
    elements.origin.value = "Current location"; setStatus("Using your live location."); elements.locate.disabled = false;
    elements.destination.focus();
    drawUserLocation(); if (destination) planTrip();
  }, (error) => {
    elements.locate.disabled = false;
    setStatus(error.code === error.PERMISSION_DENIED ? "Location permission was denied. You can search for a station instead." : "Could not determine your location.");
  }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
}

function initMap() {
  map = L.map("planner-map", { zoomControl: false }).setView([40.735, -73.94], 11);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
}
function drawUserLocation() {
  if (!origin || !map) return;
  if (userMarker) userMarker.setLatLng([origin.lat, origin.lon]);
  else userMarker = L.circleMarker([origin.lat, origin.lon], { radius: 8, color: "#fffefa", weight: 3, fillColor: "#3678e8", fillOpacity: 1 }).addTo(map).bindTooltip("You");
}
function drawMap(legs) {
  mapLayers.forEach((layer) => map.removeLayer(layer)); mapLayers = [];
  const bounds = [];
  legs.forEach((leg) => {
    const points = leg.geometry.map(([lat, lon]) => [lat, lon]); bounds.push(...points);
    mapLayers.push(L.polyline(points, { color: leg.mode === "WALK" ? "#80967e" : (leg.color || "#cf5a38"), weight: leg.mode === "WALK" ? 4 : 6, dashArray: leg.mode === "WALK" ? "7 8" : null, opacity: .9 }).addTo(map));
  });
  if (destination) { mapLayers.push(L.marker([destination.lat, destination.lon]).addTo(map).bindTooltip(destination.name)); bounds.push([destination.lat, destination.lon]); }
  drawUserLocation(); if (bounds.length) map.fitBounds(bounds, { padding: [25, 25] });
}

function demoRoute(from, to) {
  const midpoint = { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 };
  const distance = Math.hypot((to.lat - from.lat) * 69, (to.lon - from.lon) * 53);
  const longTrip = distance > 5;
  const transitName = longTrip ? "LIRR · Jamaica Branch" : "7 train · Flushing Local";
  const transitColor = longTrip ? "#cf5a38" : "#9a38a1";
  const transitStart = longTrip ? { lat: 40.7505, lon: -73.9934 } : { lat: 40.7456, lon: -73.9029 };
  const transitEnd = longTrip ? { lat: 40.7003, lon: -73.8081 } : { lat: 40.7527, lon: -73.9772 };
  return {
    source: "demo", duration: longTrip ? 48 : 27, transfers: longTrip ? 0 : 1,
    legs: [
      { mode: "WALK", name: "Walk to transit", from: from.name, to: transitStart.name || "station", duration: longTrip ? 7 : 5, geometry: [[from.lat, from.lon], [transitStart.lat, transitStart.lon]] },
      { mode: "TRANSIT", name: transitName, from: transitStart.name || "Transit station", to: transitEnd.name || "Transit station", duration: longTrip ? 34 : 15, color: transitColor, status: "Scheduled · live MTA updates below", geometry: [[transitStart.lat, transitStart.lon], [midpoint.lat, midpoint.lon], [transitEnd.lat, transitEnd.lon]] },
      { mode: "WALK", name: "Walk to destination", from: transitEnd.name || "station", to: to.name, duration: longTrip ? 7 : 7, geometry: [[transitEnd.lat, transitEnd.lon], [to.lat, to.lon]] }
    ]
  };
}

async function routeWithOtp(from, to, options) {
  const base = ROUTER_CONFIG.otpUrl.replace(/\/$/, "");
  const params = new URLSearchParams({ fromPlace: `${from.lat},${from.lon}`, toPlace: `${to.lat},${to.lon}`, mode: "WALK,TRANSIT", numItineraries: "5" });
  const response = await fetch(`${base}/otp/routers/${ROUTER_CONFIG.otpRouter || "default"}/plan?${params}`);
  if (!response.ok) throw new Error(`OpenTripPlanner returned ${response.status}`);
  const data = await response.json();
  const itineraries = data.plan?.itineraries || [];
  itineraries.sort((a, b) => options.priority === "fewest-transfers"
    ? a.transfers - b.transfers || a.duration - b.duration
    : options.priority === "fastest"
      ? a.duration - b.duration
      : a.transfers * 900 + a.duration - (b.transfers * 900 + b.duration));
  const itinerary = itineraries[0];
  if (!itinerary) throw new Error("OpenTripPlanner returned no itinerary.");
  return { source: "otp", duration: itinerary.duration / 60, transfers: itinerary.transfers, legs: itinerary.legs.map((leg) => ({ mode: leg.mode === "WALK" ? "WALK" : "TRANSIT", name: leg.routeLongName || leg.route || leg.mode, from: leg.from.name, to: leg.to.name, duration: leg.duration / 60, color: leg.routeColor ? `#${leg.routeColor}` : "#cf5a38", status: leg.realTime ? "Live" : "Scheduled", geometry: decodePolyline(leg.legGeometry?.points) })) };
}

function decodePolyline(encoded = "") {
  const points = []; let index = 0; let lat = 0; let lon = 0;
  while (index < encoded.length) { let shift = 0, result = 0, byte; do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 31) << shift; shift += 5; } while (byte >= 32); lat += (result & 1) ? ~(result >> 1) : result >> 1; shift = 0; result = 0; do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 31) << shift; shift += 5; } while (byte >= 32); lon += (result & 1) ? ~(result >> 1) : result >> 1; points.push([lat / 1e5, lon / 1e5]); }
  return points;
}

function renderItinerary(route) {
  elements.title.textContent = `${Math.round(route.duration)} min trip`;
  elements.meta.hidden = false; elements.meta.textContent = `${route.transfers} transfer${route.transfers === 1 ? "" : "s"} · ${route.source === "demo" ? "Demo route — configure OpenTripPlanner for live planning" : "Powered by OpenTripPlanner"}`;
  elements.mapProvider.textContent = route.source === "demo" ? "DEMO ROUTE" : "OPENSTREETMAP";
  if (elements.openMaps) {
    elements.openMaps.href = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${origin.lat}%2C${origin.lon}%3B${destination.lat}%2C${destination.lon}`;
    elements.openMaps.hidden = false;
  }
  elements.itinerary.replaceChildren(...route.legs.map((leg, index) => {
    const article = document.createElement("article"); article.className = `planner-leg planner-leg-${leg.mode.toLowerCase()}`;
    const icon = leg.mode === "WALK" ? "↗" : "●";
    article.innerHTML = `<div class="leg-icon">${icon}</div><div class="leg-content"><div class="leg-heading"><strong>${escapeHtml(leg.name)}</strong><span>${minutes(leg.duration)}</span></div><div class="leg-stops">${escapeHtml(leg.from)} <span>→</span> ${escapeHtml(leg.to)}</div><div class="leg-status">${escapeHtml(leg.status || (index === 0 ? "Start here" : "Continue"))}</div></div>`;
    return article;
  }));
  drawMap(route.legs);
}

async function planTrip() {
  if (!origin || !destination) {
    try {
      if (!origin && elements.origin.value.trim()) {
        origin = await resolvePlace(elements.origin.value);
        elements.origin.value = origin.label || origin.name;
        rememberLocation({ ...origin, label: elements.origin.value });
      }
      if (!destination && elements.destination.value.trim()) {
        destination = await resolvePlace(elements.destination.value);
        elements.destination.value = destination.label || destination.name;
        rememberLocation({ ...destination, label: elements.destination.value });
      }
    } catch (error) { showError(error.message); return; }
  }
  if (!origin || !destination) { showError("Choose a starting point and destination first."); return; }
  lastRequest = { origin, destination }; showError(""); elements.form.querySelector("button[type=submit]").disabled = true; setStatus("Finding the best combination of walking and transit…");
  try {
    const options = { priority: document.querySelector("#route-priority").value };
    let route;
    if (ROUTER_CONFIG.otpUrl) route = await routeWithOtp(origin, destination, options);
    else route = demoRoute(origin, destination);
    renderItinerary(route); setStatus(route.source === "demo" ? "Demo itinerary shown. Add OpenTripPlanner for production routes." : "Route updated.");
    await loadServiceAlerts(elements.alerts, ALERTS_URL, { emptyMessage: "No active subway alerts were found." });
  } catch (error) {
    console.error("Unable to plan trip:", error); showError(`Trip planning failed: ${error.message}`); setStatus("");
  } finally { elements.form.querySelector("button[type=submit]").disabled = false; }
}

function bind() {
  [elements.origin, elements.destination].forEach((input) => input.addEventListener("input", () => {
    if (input === elements.origin) origin = null; else destination = null;
    renderSuggestions(input, input === elements.origin ? elements.originResults : elements.destinationResults);
  }));
  document.addEventListener("click", (event) => { if (!event.target.closest(".station-field")) { elements.originResults.hidden = true; elements.destinationResults.hidden = true; } });
  elements.locate.addEventListener("click", useLocation); elements.form.addEventListener("submit", (event) => { event.preventDefault(); void planTrip(); });
  elements.refresh.addEventListener("click", () => { if (lastRequest) void planTrip(); }); document.querySelector("#planner-swap").addEventListener("click", () => { [elements.origin.value, elements.destination.value] = [elements.destination.value, elements.origin.value]; [origin, destination] = [destination, origin]; });
  document.querySelectorAll("[data-place-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.placeAction;
    if (action === "current") { void useLocation(); return; }
    const saved = savedPlaces()[action];
    const input = action === "home" ? elements.origin : elements.destination;
    if (saved) {
      input.value = saved.label || saved.name;
      if (action === "home") origin = point(saved); else destination = point(saved);
      setStatus(`${action[0].toUpperCase()}${action.slice(1)} selected.`);
      return;
    }
    if (!input.value.trim()) { input.focus(); setStatus(`Enter an address in ${action === "home" ? "FROM" : "TO"} first, then tap ${action}.`); return; }
    const place = action === "home" ? origin : destination;
    if (place) savePlace(action, place);
    else void resolvePlace(input.value.trim()).then((resolved) => {
      if (action === "home") origin = resolved; else destination = resolved;
      input.value = resolved.label || resolved.name;
      savePlace(action, resolved);
    }).catch((error) => showError(error.message));
  }));
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker.js").catch((error) => console.error("Unable to register app shell:", error));
  document.querySelector("#current-time")?.replaceChildren(); setInterval(() => { const now = new Date(); document.querySelector("#current-time").textContent = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }); document.querySelector("#current-date").textContent = now.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase(); }, 1000);
}

if (ROUTER_CONFIG.geoapifyKey && elements.geoapifyCredit) elements.geoapifyCredit.hidden = false;
initMap(); bind();
fetch(STATIONS_URL).then((response) => response.json()).then((data) => { stationCatalog = Object.values(data.stationsByRoute || {}).flat().map((station) => ({ name: station.name, label: `${station.name} · Subway`, lat: station.latitude, lon: station.longitude })); }).catch((error) => console.error("Unable to load station catalog:", error));
