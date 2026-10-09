import bindings from "https://esm.sh/gtfs-realtime-bindings@1.1.1?bundle";

const REFRESH_INTERVAL = 30_000;
const STATIONS_URL = "./subway-stations.json";
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
  A: "34 St-Penn Station",
  C: "34 St-Penn Station",
  F: "34 St-Herald Sq",
  E: "42 St-Port Authority Bus Terminal",
  B: "34 St-Herald Sq",
  D: "34 St-Herald Sq",
  G: "Court Sq-23 St",
  M: "34 St-Herald Sq",
  N: "34 St-Herald Sq",
  Q: "34 St-Herald Sq",
  R: "34 St-Herald Sq",
  W: "34 St-Herald Sq",
  1: "34 St-Penn Station",
  2: "34 St-Penn Station",
  3: "34 St-Penn Station",
  4: "14 St-Union Sq",
  5: "14 St-Union Sq",
  6: "14 St-Union Sq",
  7: "Times Sq-42 St"
};
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
  template: document.querySelector("#arrival-template")
};

let routesById = new Map();
let stationsByRoute = {};
let selectedLine = "F";
let requestNumber = 0;

function updateClock() {
  const now = new Date();
  elements.time.textContent = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit"
  }).format(now);
  elements.date.textContent = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(now).toUpperCase();
}

function timestampSeconds(value) {
  if (typeof value?.toNumber === "function") return value.toNumber();
  return Number(value);
}

function formatTime(seconds) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(seconds * 1000));
}

function getSelectedStation() {
  return (stationsByRoute[selectedLine] || []).find((station) => station.id === elements.station.value);
}

function lineTitle(route) {
  if (route.shortName === "S") return route.name;
  if (route.shortName === "SIR") return "Staten Island Railway";
  return `${route.shortName} train`;
}

function populateLines() {
  const options = document.createDocumentFragment();
  for (const route of routesById.values()) {
    const option = document.createElement("option");
    option.value = route.id;
    option.textContent = `${route.shortName} · ${route.name}`;
    options.append(option);
  }
  elements.line.replaceChildren(options);
  elements.line.disabled = routesById.size === 0;
  if (routesById.has(selectedLine)) elements.line.value = selectedLine;
}

function populateStations(line) {
  const stations = stationsByRoute[line] || [];
  const savedStation = localStorage.getItem(`subway-station-${line}`);
  const preferredStation = stations.find((station) => station.name === DEFAULT_STATIONS[line]);
  const initialStation = stations.find((station) => station.id === savedStation) || preferredStation || stations[0];
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
  elements.lineToken.style.color = route?.textColor || "#fff";
  elements.lineToken.style.borderRadius = route?.shortName === "SIR" ? "14px" : "50%";
  elements.stationLabel.textContent = getSelectedStation()?.name || "Select a station";
}

function setLine(line) {
  if (!routesById.has(line) || selectedLine === line) return;
  selectedLine = line;
  localStorage.setItem("subway-line", line);
  populateStations(line);
  loadArrivals();
}

function getStationNames(line) {
  const names = new Map();
  for (const station of stationsByRoute[line] || []) {
    for (const stopId of station.stopIds) names.set(stopId, station.name);
  }
  return names;
}

function getArrivals(feed, line, station) {
  const now = Date.now() / 1000;
  const platformIds = new Set(station.stopIds);
  const stopNames = getStationNames(line);
  const arrivals = [];

  for (const entity of feed.entity || []) {
    const tripUpdate = entity.tripUpdate;
    const routeId = tripUpdate?.trip?.routeId;
    if (!tripUpdate || routeId !== line) continue;

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
        line,
        eventTime,
        eventType: hasArrival ? "ARRIVES" : "DEPARTS",
        arrivalTime: Number.isFinite(arrivalTime) ? arrivalTime : null,
        departureTime: Number.isFinite(departureTime) ? departureTime : null,
        delay: Number.isFinite(Number(delay)) ? Number(delay) : null,
        destination: stopNames.get(String(lastStop?.stopId)) || ""
      });
      break;
    }
  }

  const uniqueArrivals = new Map();
  for (const arrival of arrivals.sort((first, second) => first.eventTime - second.eventTime)) {
    if (!uniqueArrivals.has(arrival.id)) uniqueArrivals.set(arrival.id, arrival);
  }
  return [...uniqueArrivals.values()].slice(0, 8);
}

function showMessage(className, headingText, messageText, linkText, linkHref) {
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

  elements.arrivals.replaceChildren(state);
}

function renderArrivals(arrivals, line) {
  const route = routesById.get(line);
  const title = route ? lineTitle(route) : `${line} train`;
  if (arrivals.length === 0) {
    showMessage("empty-state", `No upcoming ${title} arrivals here`, "Try another station or check back shortly.");
    return;
  }

  const fragment = document.createDocumentFragment();
  const now = Date.now() / 1000;
  for (const [index, arrival] of arrivals.entries()) {
    const row = elements.template.content.firstElementChild.cloneNode(true);
    row.style.animationDelay = `${index * 40}ms`;
    const time = row.querySelector(".departure-time");
    time.textContent = formatTime(arrival.eventTime);
    time.dateTime = new Date(arrival.eventTime * 1000).toISOString();
    row.querySelector(".event-label").textContent = arrival.eventType;
    row.querySelector(".departure-relative").textContent = Math.max(0, Math.round((arrival.eventTime - now) / 60)) < 1
      ? "Due"
      : `in ${Math.max(0, Math.round((arrival.eventTime - now) / 60))} min`;

    const badge = row.querySelector(".train-line-badge");
    badge.textContent = route?.shortName || line;
    badge.dataset.line = line;
    badge.style.backgroundColor = route?.color || "#555";
    badge.style.color = route?.textColor || "#fff";
    badge.style.borderRadius = route?.shortName === "SIR" ? "14px" : "50%";
    row.querySelector(".train-name").textContent = title;
    row.querySelector(".train-direction").textContent = arrival.destination
      ? `Departs toward ${arrival.destination}`
      : "Departure direction unavailable";
    row.querySelector(".train-id").textContent = `Train ${arrival.id}`;
    const platformDeparture = row.querySelector(".platform-departure");
    if (arrival.eventType === "ARRIVES" && arrival.departureTime !== null
      && formatTime(arrival.departureTime) !== formatTime(arrival.eventTime)) {
      platformDeparture.textContent = `Departs station at ${formatTime(arrival.departureTime)}`;
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

    renderArrivals(getArrivals(feed, selectedLine, station), selectedLine);
    elements.connection.textContent = "LIVE FEED";
    elements.updated.textContent = `UPDATED ${new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date()).toUpperCase()}`;
  } catch (error) {
    if (thisRequest !== requestNumber) return;
    console.error("Unable to load the MTA subway feed:", error);
    elements.connection.textContent = "FEED UNAVAILABLE";
    elements.updated.textContent = "LIVE DATA UNAVAILABLE";
    showMessage("error-state", "Could not reach subway arrivals", "Check your connection and try again. MTA subway feeds require no API key.", "MTA real-time feeds", "https://api.mta.info/");
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
    selectedLine = routesById.has(savedLine) ? savedLine : routesById.has("F") ? "F" : routesById.keys().next().value;
    populateLines();
    elements.line.addEventListener("change", () => setLine(elements.line.value));
    elements.station.addEventListener("change", loadArrivals);
    elements.refresh.addEventListener("click", loadArrivals);
    populateStations(selectedLine);
    await loadArrivals();
    setInterval(loadArrivals, REFRESH_INTERVAL);
  } catch (error) {
    console.error("Unable to load subway stations:", error);
    elements.connection.textContent = "STATIONS UNAVAILABLE";
    elements.updated.textContent = "STATION DATA UNAVAILABLE";
    showMessage("error-state", "Could not load subway stations", "Refresh the page to try again.");
    elements.arrivals.setAttribute("aria-busy", "false");
  }
}

updateClock();
setInterval(updateClock, 15_000);
initialize();