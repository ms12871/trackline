import bindings from "https://esm.sh/gtfs-realtime-bindings@1.1.1?bundle";
import { loadServiceAlerts } from "./service-alerts.js";

const REFRESH_INTERVAL = 30_000;
const STATIONS_URL = "./subway-stations.json";
const ALERTS_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts";
const HIDDEN_LINE_VARIANTS = new Set(["FX", "6X", "7X"]);
const DISPLAY_ROUTE_IDS = { FX: "F", "6X": "6", "7X": "7" };
const FEEDS = {
  ace: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
  bdfm: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
  g: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
  jz: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
  l: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
  nqrw: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  main: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  si: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si"
};
const DEFAULT_STATIONS = {
  A: "34 St-Penn Station", C: "34 St-Penn Station", F: "34 St-Herald Sq",
  E: "42 St-Port Authority Bus Terminal", B: "34 St-Herald Sq", D: "34 St-Herald Sq",
  G: "Court Sq-23 St", M: "34 St-Herald Sq", N: "34 St-Herald Sq",
  Q: "34 St-Herald Sq", R: "34 St-Herald Sq", W: "34 St-Herald Sq",
  1: "34 St-Penn Station", 2: "34 St-Penn Station", 3: "34 St-Penn Station",
  4: "14 St-Union Sq", 5: "14 St-Union Sq", 6: "14 St-Union Sq", 7: "Times Sq-42 St"
};
const SEARCH_ALIASES = new Map([
  ["union sq", "14 St-Union Sq"], ["union square", "14 St-Union Sq"],
  ["w 4th", "W 4 St-Wash Sq"], ["west 4th", "W 4 St-Wash Sq"],
  ["grand central", "Grand Central-42 St"], ["grand central terminal", "Grand Central-42 St"],
  ["port authority", "42 St-Port Authority Bus Terminal"], ["pabt", "42 St-Port Authority Bus Terminal"]
]);
const { transit_realtime: transitRealtime } = bindings;
const elements = {
  connection: document.querySelector("#connection-label"),
  time: document.querySelector("#current-time"),
  date: document.querySelector("#current-date"),
  line: document.querySelector("#line-select"),
  lineToken: document.querySelector("#selected-line-token"),
  station: document.querySelector("#station-select"),
  lineLabel: document.querySelector("#board-line"),
  stationLabel: document.querySelector("#board-station"),
  updated: document.querySelector("#updated-label"),
  arrivals: document.querySelector("#arrivals"),
  refresh: document.querySelector("#refresh-button"),
  error: document.querySelector("#subway-error"),
  template: document.querySelector("#arrival-template"),
  lineChips: document.querySelector("#line-chips"),
  search: document.querySelector("#station-search"),
  searchResults: document.querySelector("#station-search-results"),
  searchStatus: document.querySelector("#station-search-status"),
  nearest: document.querySelector("#nearest-stations"),
  shortcuts: document.querySelector("#station-shortcuts"),
  pin: document.querySelector("#pin-station"),
  alerts: document.querySelector("#service-alerts"),
  offline: document.querySelector("#offline-warning"),
  progress: document.querySelector("#refresh-progress")
};

let routesById = new Map();
let stationsByRoute = {};
let selectedLine = "F";
let selectedDirection = "N";
let currentArrivals = [];
let requestNumber = 0;
let lastSuccessfulUpdate = null;
let activeSearchIndex = -1;

function updateClock() {
  const now = new Date();
  elements.time.textContent = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit"
  }).format(now);
  elements.date.textContent = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric"
  }).format(now).toUpperCase();
}

function timestampSeconds(value) {
  if (typeof value?.toNumber === "function") return value.toNumber();
  return Number(value);
}

function formatTime(seconds) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit"
  }).format(new Date(seconds * 1000));
}

function normalize(value) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function getSelectedStation() {
  return (stationsByRoute[selectedLine] || []).find((station) => station.id === elements.station.value);
}

function lineTitle(route) {
  route = route && routesById.get(DISPLAY_ROUTE_IDS[route.id]) || route;
  if (route.shortName === "S") return route.name;
  if (route.shortName === "SIR") return "Staten Island Railway";
  return `${route.shortName} train`;
}

function contrastRatio(first, second) {
  const luminance = (color) => {
    const channels = color.match(/[a-f\d]{2}/gi)?.map((channel) => parseInt(channel, 16) / 255) || [0, 0, 0];
    const linear = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function badgeTextColor(route) {
  const background = route?.color || "#555555";
  const officialText = route?.textColor || "#ffffff";
  if (contrastRatio(background, officialText) >= 4.5) return officialText;
  return contrastRatio(background, "#000000") >= contrastRatio(background, "#ffffff")
    ? "#000000" : "#ffffff";
}

function applyRouteBadge(badge, line) {
  const route = routesById.get(DISPLAY_ROUTE_IDS[line] || line);
  badge.textContent = route?.shortName || line;
  badge.style.backgroundColor = route?.color || "#555";
  badge.style.color = badgeTextColor(route);
  badge.style.borderRadius = route?.shortName === "SIR" ? "14px" : "50%";
}

function populateLines() {
  const options = document.createDocumentFragment();
  for (const route of routesById.values()) {
    if (HIDDEN_LINE_VARIANTS.has(route.id)) continue;
    const option = document.createElement("option");
    option.value = route.id;
    option.textContent = `${route.shortName} · ${route.name}`;
    options.append(option);
  }
  elements.line.replaceChildren(options);
  elements.line.disabled = routesById.size === 0;
  if (routesById.has(selectedLine)) elements.line.value = selectedLine;
  renderLineChips();
}

function renderLineChips() {
  const fragment = document.createDocumentFragment();
  for (const route of routesById.values()) {
    if (HIDDEN_LINE_VARIANTS.has(route.id)) continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "line-chip";
    chip.textContent = route.shortName;
    chip.title = route.name;
    chip.setAttribute("aria-label", `${route.shortName}, ${route.name}`);
    chip.setAttribute("aria-pressed", String(route.id === selectedLine));
    chip.style.setProperty("--line-color", route.color || "#555");
    chip.style.setProperty("--badge-text", badgeTextColor(route));
    chip.addEventListener("click", () => setLine(route.id));
    fragment.append(chip);
  }
  elements.lineChips.replaceChildren(fragment);
}

function populateStations(line, preferredId = null) {
  const stations = stationsByRoute[line] || [];
  const savedStation = localStorage.getItem(`subway-station-${line}`);
  const preferredStation = stations.find((station) => station.name === DEFAULT_STATIONS[line]);
  const initialStation = stations.find((station) => station.id === preferredId)
    || stations.find((station) => station.id === savedStation)
    || preferredStation || stations[0];
  const options = document.createDocumentFragment();
  for (const station of stations) {
    const option = document.createElement("option");
    option.value = station.id;
    option.textContent = station.name;
    options.append(option);
  }
  elements.station.replaceChildren(options);
  elements.station.disabled = stations.length === 0;
  if (initialStation) elements.station.value = initialStation.id;
  updateBoardLabels();
}

function updateBoardLabels() {
  const route = routesById.get(selectedLine);
  elements.lineLabel.textContent = route ? lineTitle(route) : "Subway train";
  elements.lineToken.textContent = route?.shortName || "?";
  elements.lineToken.style.backgroundColor = route?.color || "#555";
  elements.lineToken.style.color = badgeTextColor(route);
  elements.lineToken.style.borderRadius = route?.shortName === "SIR" ? "14px" : "50%";
  elements.stationLabel.textContent = getSelectedStation()?.name || "Select a station";
  elements.pin.setAttribute("aria-pressed", String(isPinned(selectedLine, elements.station.value)));
  elements.pin.textContent = isPinned(selectedLine, elements.station.value) ? "★ PINNED STOP" : "☆ PIN THIS STOP";
  renderLineChips();
}

function setSelection(line, stationId, recordRecent = true) {
  if (!routesById.has(line)) return;
  selectedLine = line;
  localStorage.setItem("subway-line", line);
  elements.line.value = line;
  populateStations(line, stationId);
  if (!getSelectedStation()) return;
  if (recordRecent) recordRecentStation(line, elements.station.value);
  renderShortcuts();
  updateBoardLabels();
  loadArrivals();
  void loadAlerts();
}

function setLine(line) {
  if (!routesById.has(line)) return;
  if (selectedLine === line) {
    elements.line.value = line;
    return;
  }
  setSelection(line, null);
}

function getStationNames(line) {
  const names = new Map();
  for (const station of stationsByRoute[line] || []) {
    for (const stopId of station.stopIds) names.set(stopId, station.name);
  }
  return names;
}

function getArrivalDirection(stopId) {
  const match = String(stopId).match(/([NSEW])$/);
  return match?.[1] || "";
}

function getArrivals(feed, line, station) {
  const now = Date.now() / 1000;
  const platformIds = new Set(station.stopIds);
  const stopNames = getStationNames(line);
  const allowedRoutes = line === "F" ? new Set(["F", "FX"])
    : line === "6" ? new Set(["6", "6X"])
      : line === "7" ? new Set(["7", "7X"]) : new Set([line]);
  const arrivals = [];

  for (const entity of feed.entity || []) {
    const tripUpdate = entity.tripUpdate;
    const actualLine = tripUpdate?.trip?.routeId;
    if (!tripUpdate || !allowedRoutes.has(actualLine)) continue;
    const stopUpdates = tripUpdate.stopTimeUpdate || [];
    for (const stopUpdate of stopUpdates) {
      if (!platformIds.has(String(stopUpdate.stopId))) continue;
      const arrivalTime = timestampSeconds(stopUpdate.arrival?.time);
      const departureTime = timestampSeconds(stopUpdate.departure?.time);
      const hasArrival = Number.isFinite(arrivalTime) && arrivalTime >= now - 60;
      const eventTime = hasArrival ? arrivalTime : departureTime;
      if (!Number.isFinite(eventTime) || eventTime < now - 60 || eventTime > now + 90 * 60) continue;
      const lastStop = stopUpdates[stopUpdates.length - 1];
      const delay = hasArrival
        ? stopUpdate.arrival?.delay ?? stopUpdate.departure?.delay
        : stopUpdate.departure?.delay ?? stopUpdate.arrival?.delay;
      arrivals.push({
        id: tripUpdate.trip?.tripId || entity.id,
        line: actualLine,
        eventTime,
        eventType: hasArrival ? "ARRIVES" : "DEPARTS",
        arrivalTime: Number.isFinite(arrivalTime) ? arrivalTime : null,
        departureTime: Number.isFinite(departureTime) ? departureTime : null,
        delay: Number.isFinite(Number(delay)) ? Number(delay) : null,
        destination: stopNames.get(String(lastStop?.stopId)) || "",
        direction: getArrivalDirection(stopUpdate.stopId)
      });
      break;
    }
  }

  const uniqueArrivals = new Map();
  for (const arrival of arrivals.sort((first, second) => first.eventTime - second.eventTime)) {
    if (!uniqueArrivals.has(arrival.id)) uniqueArrivals.set(arrival.id, arrival);
  }
  return [...uniqueArrivals.values()].slice(0, 12);
}

function showMessage(className, headingText, messageText, linkText, linkHref, retryAction = () => elements.refresh.click()) {
  const state = document.createElement("div");
  state.className = className;
  const heading = document.createElement("strong");
  heading.textContent = headingText;
  const message = document.createElement("span");
  message.textContent = messageText;
  state.append(heading, message);
  if (linkText && linkHref) {
    const link = document.createElement("a");
    link.href = linkHref;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = linkText;
    state.append(link);
  }
  if (className === "error-state") {
    const retry = document.createElement("button");
    retry.className = "retry-button";
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", retryAction);
    state.append(retry);
  }
  elements.arrivals.replaceChildren(state);
}

function selectedDirectionLabel() {
  return selectedDirection === "N" ? "Uptown / Northbound" : "Downtown / Southbound";
}

function renderArrivals(arrivals, line) {
  const route = routesById.get(line);
  const title = route ? lineTitle(route) : `${line} train`;
  const directionalArrivals = arrivals.filter((arrival) =>
    !arrival.direction || arrival.direction === selectedDirection);
  if (directionalArrivals.length === 0) {
    const directionName = selectedDirectionLabel();
    showMessage("empty-state", `No ${title} arrivals for this direction`, `No upcoming trains are posted for ${directionName.toLowerCase()}. Try the other direction or refresh.`);
    return;
  }

  const fragment = document.createDocumentFragment();
  const now = Date.now() / 1000;
  for (const [index, arrival] of directionalArrivals.entries()) {
    const row = elements.template.content.firstElementChild.cloneNode(true);
    row.style.animationDelay = `${index * 40}ms`;
    const secondsAway = arrival.eventTime - now;
    const minutesAway = Math.max(0, Math.round(secondsAway / 60));
    const relative = row.querySelector(".departure-relative");
    relative.textContent = secondsAway < 60 ? "Arriving now" : `${minutesAway} min`;
    if (secondsAway < 120) relative.classList.add("urgent");
    row.querySelector(".departure-time").textContent = formatTime(arrival.eventTime);
    row.querySelector(".departure-time").dateTime = new Date(arrival.eventTime * 1000).toISOString();
    row.querySelector(".event-label").textContent = arrival.eventType;

    const badge = row.querySelector(".train-line-badge");
    applyRouteBadge(badge, arrival.line);
    badge.dataset.line = arrival.line;
    row.querySelector(".train-name").textContent = lineTitle(routesById.get(arrival.line) || route);
    row.querySelector(".train-direction").textContent = arrival.destination
      ? `To ${arrival.destination}`
      : "Terminal unavailable";
    const serviceType = row.querySelector(".service-type");
    const actualRoute = routesById.get(arrival.line) || route;
    const pattern = actualRoute?.name || "";
    if (/express/i.test(pattern) && /local/i.test(pattern)) {
      serviceType.textContent = "Express / local";
      serviceType.classList.add("mixed");
    } else if (/express/i.test(pattern)) {
      serviceType.textContent = "Express";
      serviceType.classList.add("express");
    } else if (/local/i.test(pattern)) {
      serviceType.textContent = "Local";
    } else {
      serviceType.hidden = true;
    }

    const platformDeparture = row.querySelector(".platform-departure");
    if (arrival.eventType === "ARRIVES" && arrival.departureTime !== null
      && formatTime(arrival.departureTime) !== formatTime(arrival.eventTime)) {
      platformDeparture.textContent = `Departs platform at ${formatTime(arrival.departureTime)}`;
      platformDeparture.hidden = false;
    }

    const status = document.createElement("span");
    status.className = "status-pill";
    if (arrival.delay === null) {
      status.classList.add("unknown");
      status.textContent = "LIVE UPDATE";
    } else if (arrival.delay >= 60) {
      status.classList.add("delayed");
      status.textContent = `${Math.round(arrival.delay / 60)} MIN LATE`;
    } else if (arrival.delay <= -60) {
      status.classList.add("unknown");
      status.textContent = `${Math.round(Math.abs(arrival.delay) / 60)} MIN EARLY`;
    } else {
      status.textContent = "ON TIME";
    }
    row.querySelector(".status-block").append(status);
    fragment.append(row);
  }
  elements.arrivals.replaceChildren(fragment);
}

function cacheKey() {
  return `subway-arrivals-${selectedLine}-${elements.station.value}`;
}

function readCachedArrivals() {
  const cached = localStorage.getItem(cacheKey());
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached);
    if (!Array.isArray(parsed.arrivals) || !Number.isFinite(parsed.savedAt)) return null;
    return parsed;
  } catch (error) {
    console.error("Unable to read cached subway arrivals:", error);
    return null;
  }
}

function setOfflineWarning(message) {
  elements.offline.replaceChildren(document.createTextNode(message));
  const retry = document.createElement("button");
  retry.className = "retry-button";
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", loadArrivals);
  elements.offline.append(retry);
  elements.offline.hidden = false;
}

function formatDataAge(updatedAt) {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  if (ageSeconds < 60) return "just now";
  return `${Math.floor(ageSeconds / 60)} min ago`;
}

function recordRecentStation(line, stationId) {
  const station = (stationsByRoute[line] || []).find((item) => item.id === stationId);
  if (!station) return;
  const recent = readStoredList("subway-recent-stations")
    .filter((item) => !(item.line === line && item.stationId === stationId));
  recent.unshift({ line, stationId, name: station.name });
  localStorage.setItem("subway-recent-stations", JSON.stringify(recent.slice(0, 5)));
}

function readStoredList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch (error) {
    console.error(`Unable to read ${key}:`, error);
    return [];
  }
}

function getPinned() {
  return readStoredList("subway-pinned-stations");
}

function isPinned(line, stationId) {
  return getPinned().some((item) => item.line === line && item.stationId === stationId);
}

function renderShortcuts() {
  const pinned = getPinned();
  const recent = readStoredList("subway-recent-stations")
    .filter((item) => !pinned.some((favorite) => favorite.line === item.line && favorite.stationId === item.stationId));
  const fragment = document.createDocumentFragment();
  for (const [label, items] of [["★", pinned], ["RECENT", recent]]) {
    for (const item of items.slice(0, 5)) {
      const route = routesById.get(item.line);
      const station = (stationsByRoute[item.line] || []).find((entry) => entry.id === item.stationId);
      if (!route || !station) continue;
      const button = document.createElement("button");
      button.className = "station-shortcut";
      button.type = "button";
      const token = document.createElement("span");
      token.className = "shortcut-line";
      token.textContent = `${label === "★" ? "★ " : ""}${route.shortName}`;
      token.style.color = route.color;
      const name = document.createElement("span");
      name.textContent = station.name;
      button.append(token, name);
      button.addEventListener("click", () => setSelection(item.line, item.stationId));
      fragment.append(button);
    }
  }
  if (fragment.childNodes.length === 0) {
    const empty = document.createElement("span");
    empty.className = "saved-trip-label";
    empty.textContent = "No pinned or recent stops yet";
    fragment.append(empty);
  }
  elements.shortcuts.replaceChildren(fragment);
}

function searchStations(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const alias = SEARCH_ALIASES.get(normalizedQuery);
  const normalizedAlias = alias ? normalize(alias) : normalizedQuery;
  const matches = [];
  for (const [line, stations] of Object.entries(stationsByRoute)) {
    const route = routesById.get(line);
    if (!route || HIDDEN_LINE_VARIANTS.has(line)) continue;
    for (const station of stations) {
      const name = normalize(station.name);
      const searchableName = normalize(SEARCH_ALIASES.get(normalizedQuery) || station.name);
      const words = name.split(" ");
      if (name.includes(normalizedQuery) || searchableName.includes(normalizedQuery)
        || name.includes(normalizedAlias) || words.some((word) => word.startsWith(normalizedQuery))) {
        matches.push({ line, station, route, score: name.startsWith(normalizedAlias) ? 0 : name.includes(normalizedAlias) ? 1 : 2 });
      }
    }
  }
  return matches.sort((a, b) => a.score - b.score || a.station.name.localeCompare(b.station.name) || a.route.sortOrder - b.route.sortOrder).slice(0, 8);
}

function renderSearchResults(query) {
  const matches = searchStations(query);
  activeSearchIndex = -1;
  if (!query.trim()) {
    elements.searchResults.hidden = true;
    elements.search.setAttribute("aria-expanded", "false");
    elements.searchStatus.textContent = "";
    return matches;
  }
  const fragment = document.createDocumentFragment();
  for (const [index, match] of matches.entries()) {
    const button = document.createElement("button");
    button.id = `subway-search-option-${index}`;
    button.className = "station-search-result";
    button.type = "button";
    button.role = "option";
    button.setAttribute("aria-selected", "false");
    const badge = document.createElement("span");
    badge.className = "line-token";
    applyRouteBadge(badge, match.line);
    const name = document.createElement("span");
    name.className = "station-search-name";
    name.textContent = match.station.name;
    const lines = document.createElement("span");
    lines.className = "station-search-lines";
    lines.textContent = `${match.route.shortName} train`;
    button.append(badge, name, lines);
    button.addEventListener("click", () => {
      setSelection(match.line, match.station.id);
      elements.search.value = "";
      elements.searchResults.hidden = true;
      elements.search.setAttribute("aria-expanded", "false");
      elements.searchStatus.textContent = "";
    });
    fragment.append(button);
  }
  elements.searchResults.replaceChildren(fragment);
  elements.searchResults.hidden = matches.length === 0;
  elements.search.setAttribute("aria-expanded", String(matches.length > 0));
  elements.search.removeAttribute("aria-activedescendant");
  elements.searchStatus.textContent = matches.length ? "" : "No station found. Try a line name, station, or landmark.";
  return matches;
}

function distanceMiles(firstLat, firstLon, secondLat, secondLon) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(secondLat - firstLat);
  const longitudeDelta = radians(secondLon - firstLon);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(firstLat)) * Math.cos(radians(secondLat)) * Math.sin(longitudeDelta / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function findNearbyStations(latitude, longitude) {
  const nearby = [];
  for (const [line, stations] of Object.entries(stationsByRoute)) {
    const route = routesById.get(line);
    if (HIDDEN_LINE_VARIANTS.has(line)) continue;
    for (const station of stations) {
      if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) continue;
      nearby.push({
        line, station, route,
        distance: distanceMiles(latitude, longitude, station.latitude, station.longitude)
      });
    }
  }
  return nearby.sort((a, b) => a.distance - b.distance || a.route.sortOrder - b.route.sortOrder).slice(0, 6);
}

function locateNearestStations() {
  elements.searchStatus.textContent = "Finding stations near you…";
  if (!navigator.geolocation) {
    elements.searchStatus.textContent = "Location is not available in this browser.";
    return;
  }
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    const nearby = findNearbyStations(coords.latitude, coords.longitude);
    if (nearby.length === 0) {
      elements.searchStatus.textContent = "Station coordinates are not available. Refresh the station catalog and try again.";
      return;
    }
    const [nearest, ...others] = nearby;
    setSelection(nearest.line, nearest.station.id);
    elements.searchStatus.textContent = `Nearest: ${nearest.station.name} · ${nearest.distance.toFixed(1)} mi away`;
    const suggestions = document.createDocumentFragment();
    for (const item of others) {
      const button = document.createElement("button");
      button.className = "station-shortcut";
      button.type = "button";
      const line = document.createElement("span");
      line.className = "shortcut-line";
      line.textContent = item.route.shortName;
      line.style.color = item.route.color;
      const text = document.createElement("span");
      text.textContent = `${item.station.name} · ${item.distance.toFixed(1)} mi`;
      button.append(line, text);
      button.addEventListener("click", () => {
        setSelection(item.line, item.station.id);
        elements.searchStatus.textContent = `${item.station.name} · ${item.distance.toFixed(1)} mi away`;
      });
      suggestions.append(button);
    }
    elements.shortcuts.replaceChildren(suggestions);
  }, (error) => {
    const reason = error.code === error.PERMISSION_DENIED
      ? "Location access was denied. You can still search for a station."
      : error.code === error.TIMEOUT
        ? "Location took too long. Try again or search for a station."
        : "Your location could not be determined. Try again or search for a station.";
    elements.searchStatus.textContent = reason;
  }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
}

function loadAlerts() {
  const line = selectedLine;
  const route = routesById.get(line);
  const station = getSelectedStation();
  return loadServiceAlerts(elements.alerts, ALERTS_URL, {
    matches: (alert) => {
      const entities = alert.informedEntity || [];
      if (entities.length === 0 || entities.some((informed) => !informed.routeId && !informed.stopId)) return true;
      return entities.some((informed) =>
        informed.routeId === line
        || (line === "F" && informed.routeId === "FX")
        || (informed.stopId && station?.stopIds.includes(informed.stopId)));
    },
    decorateSummary: (summary) => {
      const badge = document.createElement("span");
      badge.className = "alert-line-badge";
      badge.textContent = route?.shortName || line;
      badge.style.setProperty("--line-color", route?.color || "#555");
      badge.style.setProperty("--badge-text", badgeTextColor(route));
      summary.prepend(badge);
    }
  });
}

async function loadArrivals() {
  const station = getSelectedStation();
  if (!station) return;
  const route = routesById.get(selectedLine);
  const feedUrl = FEEDS[route?.feedGroup];
  if (!feedUrl) return;

  localStorage.setItem(`subway-station-${selectedLine}`, station.id);
  updateBoardLabels();
  const thisRequest = ++requestNumber;
  elements.refresh.classList.add("is-spinning");
  elements.arrivals.setAttribute("aria-busy", "true");
  elements.updated.textContent = "FETCHING LIVE DATA";
  if (elements.arrivals.children.length === 0 || elements.arrivals.querySelector(".empty-state, .error-state, .loading-state")) {
    const loading = document.createElement("div");
    loading.className = "loading-state";
    loading.innerHTML = '<span class="loading-bar"></span><span>Checking subway arrivals</span>';
    elements.arrivals.replaceChildren(loading);
  }

  try {
    const response = await fetch(feedUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`MTA feed returned ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const feed = transitRealtime.FeedMessage.decode(bytes);
    if (thisRequest !== requestNumber) return;

    currentArrivals = getArrivals(feed, selectedLine, station);
    lastSuccessfulUpdate = Date.now();
    localStorage.setItem(cacheKey(), JSON.stringify({ savedAt: lastSuccessfulUpdate, arrivals: currentArrivals }));
    renderArrivals(currentArrivals, selectedLine);
    elements.connection.textContent = "LIVE FEED";
    elements.updated.textContent = `UPDATED ${new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit"
    }).format(new Date()).toUpperCase()}`;
    elements.offline.hidden = true;
    if (navigator.onLine) {
      elements.connection.textContent = "LIVE FEED";
    }
  } catch (error) {
    if (thisRequest !== requestNumber) return;
    console.error("Unable to load the MTA subway feed:", error);
    elements.connection.textContent = navigator.onLine ? "FEED UNAVAILABLE" : "OFFLINE";
    elements.updated.textContent = "LIVE DATA UNAVAILABLE";
    const cached = readCachedArrivals();
    if (cached) {
      currentArrivals = cached.arrivals;
      renderArrivals(currentArrivals, selectedLine);
      setOfflineWarning(`Connection lost — showing data updated ${formatDataAge(cached.savedAt)}.`);
    } else {
      elements.offline.hidden = true;
      showMessage("error-state", "Could not reach subway arrivals", "Check your connection and try again. MTA subway feeds require no API key.", "MTA real-time feeds", "https://api.mta.info/");
    }
  } finally {
    if (thisRequest === requestNumber) {
      elements.refresh.classList.remove("is-spinning");
      elements.arrivals.setAttribute("aria-busy", "false");
    }
  }
}

async function initialize() {
  try {
    const response = await fetch(STATIONS_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Station lookup returned ${response.status}`);
    const catalog = await response.json();
    routesById = new Map(catalog.routes.map((route) => [route.id, route]));
    stationsByRoute = catalog.stationsByRoute || {};
    if (routesById.size === 0) throw new Error("No subway lines found in station data.");
    const savedLine = localStorage.getItem("subway-line");
    selectedLine = routesById.has(savedLine) && !HIDDEN_LINE_VARIANTS.has(savedLine)
      ? savedLine : routesById.has("F") ? "F" : routesById.keys().next().value;
    populateLines();
    elements.line.addEventListener("change", () => setLine(elements.line.value));
    elements.station.addEventListener("change", () => {
      recordRecentStation(selectedLine, elements.station.value);
      renderShortcuts();
      loadArrivals();
      void loadAlerts();
    });
    elements.refresh.addEventListener("click", () => {
      loadArrivals();
      void loadAlerts();
    });
    elements.nearest.addEventListener("click", locateNearestStations);
    elements.pin.addEventListener("click", () => {
      const station = getSelectedStation();
      if (!station) return;
      const pinned = getPinned();
      const existingIndex = pinned.findIndex((item) => item.line === selectedLine && item.stationId === station.id);
      if (existingIndex >= 0) pinned.splice(existingIndex, 1);
      else pinned.unshift({ line: selectedLine, stationId: station.id, name: station.name });
      localStorage.setItem("subway-pinned-stations", JSON.stringify(pinned.slice(0, 8)));
      updateBoardLabels();
      renderShortcuts();
    });
    for (const tab of document.querySelectorAll(".direction-tab")) {
      tab.addEventListener("click", () => {
        selectedDirection = tab.dataset.direction;
        for (const directionTab of document.querySelectorAll(".direction-tab")) {
          const isSelected = directionTab.dataset.direction === selectedDirection;
          if (directionTab.closest('[role="tablist"]')) {
            directionTab.setAttribute("aria-selected", String(isSelected));
          } else {
            directionTab.setAttribute("aria-pressed", String(isSelected));
          }
        }
        renderArrivals(currentArrivals, selectedLine);
      });
    }
    elements.search.addEventListener("input", () => renderSearchResults(elements.search.value));
    elements.search.addEventListener("keydown", (event) => {
      const options = [...elements.searchResults.querySelectorAll(".station-search-result")];
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length > 0) {
        event.preventDefault();
        const offset = event.key === "ArrowDown" ? 1 : -1;
        activeSearchIndex = (activeSearchIndex + offset + options.length) % options.length;
        options.forEach((option, index) => option.setAttribute("aria-selected", String(index === activeSearchIndex)));
        elements.search.setAttribute("aria-activedescendant", options[activeSearchIndex].id);
        return;
      }
      if (event.key === "Enter") {
        const result = options[activeSearchIndex] || options[0];
        if (result) {
          event.preventDefault();
          result.click();
        }
      } else if (event.key === "Escape") {
        elements.searchResults.hidden = true;
        elements.search.setAttribute("aria-expanded", "false");
        elements.search.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (!elements.searchResults.contains(event.target) && event.target !== elements.search) {
        elements.searchResults.hidden = true;
        elements.search.setAttribute("aria-expanded", "false");
      }
    });
    window.addEventListener("offline", () => {
      elements.connection.textContent = "OFFLINE";
      if (lastSuccessfulUpdate) {
        setOfflineWarning(`Connection lost — showing data updated ${formatDataAge(lastSuccessfulUpdate)}.`);
      }
    });
    window.addEventListener("online", () => {
      elements.connection.textContent = "RECONNECTING";
      loadArrivals();
    });
    populateStations(selectedLine);
    renderShortcuts();
    recordRecentStation(selectedLine, elements.station.value);
    renderShortcuts();
    await loadArrivals();
    void loadAlerts();
    setInterval(() => { void loadAlerts(); }, 60_000);
    setInterval(loadArrivals, REFRESH_INTERVAL);
  } catch (error) {
    console.error("Unable to load subway stations:", error);
    elements.connection.textContent = "STATIONS UNAVAILABLE";
    elements.updated.textContent = "STATION DATA UNAVAILABLE";
    showMessage("error-state", "Could not load subway stations", "Refresh the page to try again.", null, null, () => location.reload());
    elements.arrivals.setAttribute("aria-busy", "false");
  }
}

updateClock();
setInterval(updateClock, 15_000);
initialize();
