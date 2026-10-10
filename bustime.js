import { loadServiceAlerts } from "./service-alerts.js";

const BUS_TIME_ORIGIN = "https://bustime.mta.info";
const PUBLIC_API_KEY = "OBANYC";
const REFRESH_INTERVAL = 30_000;
const ALERTS_REFRESH_INTERVAL = 60_000;
const MAX_LOOKAHEAD = 90 * 60;
const ALERTS_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fbus-alerts";
const elements = {
  connection: document.querySelector("#connection-label"),
  time: document.querySelector("#current-time"),
  date: document.querySelector("#current-date"),
  searchForm: document.querySelector("#bus-search-form"),
  query: document.querySelector("#route-query"),
  searchButton: document.querySelector("#search-routes"),
  route: document.querySelector("#bus-route"),
  direction: document.querySelector("#bus-direction"),
  stop: document.querySelector("#bus-stop"),
  routeLabel: document.querySelector("#board-route-label"),
  stopLabel: document.querySelector("#board-stop-label"),
  updated: document.querySelector("#updated-label"),
  arrivals: document.querySelector("#bus-arrivals"),
  alerts: document.querySelector("#service-alerts"),
  refresh: document.querySelector("#refresh-button"),
  error: document.querySelector("#bus-error"),
  template: document.querySelector("#bus-arrival-template")
};

let routeOptions = new Map();
let selectedRoute = null;
let selectedDirection = null;
let selectedStop = null;
let requestNumber = 0;
let routeCatalogPromise = null;

function routeCode(route) {
  return String(route.shortName || route.id || "").replace(/^MTA\s+[^_]+_/, "").replace(/^MTABC_/, "");
}

function normalizeRouteCode(value) {
  return String(value).toUpperCase().replace(/\s+/g, "").replace(/^([A-Z]+)0+(\d+)(.*)$/, "$1$2$3");
}

async function getRouteCatalog() {
  if (!routeCatalogPromise) {
    routeCatalogPromise = fetchApi("routes")
      .then((response) => {
        if (!Array.isArray(response.routes)) throw new Error("BusTime did not return its route catalog.");
        return response.routes;
      })
      .catch((error) => {
        routeCatalogPromise = null;
        throw error;
      });
  }
  return routeCatalogPromise;
}

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

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function buildApiUrl(endpoint, params = {}) {
  const url = new URL(`/api/${endpoint}`, BUS_TIME_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function fetchApi(endpoint, params) {
  const response = await fetch(buildApiUrl(endpoint, params), { cache: "no-store" });
  if (!response.ok) throw new Error(`BusTime returned ${response.status}`);
  return response.json();
}

function fillSelect(select, items, getValue, getLabel) {
  const options = document.createDocumentFragment();
  for (const item of items) {
    const option = document.createElement("option");
    option.value = getValue(item);
    option.textContent = getLabel(item);
    options.append(option);
  }
  select.replaceChildren(options);
  select.disabled = items.length === 0;
}

function showMessage(className, titleText, messageText, linkText, linkHref) {
  const state = document.createElement("div");
  state.className = className;
  const title = document.createElement("strong");
  title.textContent = titleText;
  const message = document.createElement("span");
  message.textContent = messageText;
  state.append(title, message);

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
    retry.addEventListener("click", () => elements.refresh.click());
    state.append(retry);
  }

  elements.arrivals.replaceChildren(state);
}

async function enrichRoute(route) {
  if (Array.isArray(route.directions)
    && route.directions.length > 0
    && route.directions.every((direction) => Array.isArray(direction.stops) && direction.stops.length > 0)) return route;

  const directionResults = await Promise.all(["0", "1"].map(async (directionId) => {
    try {
      const response = await fetchApi("stops-on-route-for-direction", { routeId: route.id, directionId });
      const stops = response.stops || [];
      return {
        directionId,
        destination: stops.at(-1)?.name || stops[0]?.name || `Direction ${directionId}`,
        stops
      };
    } catch {
      return null;
    }
  }));
  const activeDirections = directionResults.filter((direction) => direction?.stops.length > 0);
  if (activeDirections.length === 0) throw new Error("BusTime has no stop list for this route.");
  return { ...route, directions: activeDirections };
}

async function findDirectRoute(query) {
  const normalized = normalizeRouteCode(query);
  if (!/^(?:B|BX|M|Q|S|X|BM|QM|SIM)\d{1,3}(?:\+)?$/.test(normalized)) return null;

  const route = (await getRouteCatalog())
    .find((candidate) => normalizeRouteCode(routeCode(candidate)) === normalized);
  if (!route) return null;

  try {
    return await enrichRoute(route);
  } catch (error) {
    console.error(`BusTime could not load stops for ${routeCode(route)}:`, error);
    return { ...route, directions: [], stopsUnavailable: true };
  }
}

function updateBoardLabels() {
  elements.routeLabel.textContent = selectedRoute ? routeCode(selectedRoute) : "Bus route";
  elements.stopLabel.textContent = selectedStop?.name || "Choose a stop";
}

function populateStops(direction) {
  const stops = direction.stops || [];
  fillSelect(elements.stop, stops, (stop) => stop.id, (stop) => `${stop.name}${stop.stopDirection ? ` · ${stop.stopDirection}` : ""}`);
  selectedStop = stops[0] || null;
  updateBoardLabels();
  if (selectedStop) loadArrivals();
}

function populateDirections(route) {
  const directions = route.directions || [];
  fillSelect(elements.direction, directions, (direction) => direction.directionId, (direction) => direction.destination);
  selectedDirection = directions[0] || null;
  if (!selectedDirection || !selectedDirection.stops?.length) {
    selectedStop = null;
    fillSelect(elements.stop, [], () => "", () => "");
    updateBoardLabels();
    showMessage(
      "empty-state",
      `${routeCode(route)} found · live stops unavailable`,
      "MTA BusTime recognizes this route, but is not publishing a stop list right now. Try again later.",
      "Open MTA BusTime",
      "https://bustime.mta.info/"
    );
    return;
  }

  populateStops(selectedDirection);
}

async function applyRoute(route) {
  if (!route?.id || !Array.isArray(route.directions)) throw new Error("The selected route has no stop directions.");
  selectedRoute = route;
  routeOptions.set(route.id, route);
  elements.route.value = route.id;
  localStorage.setItem("bustime-route", route.id);
  populateDirections(route);
  void loadBusAlerts();
}

async function loadRouteById(routeId) {
  const route = routeOptions.get(routeId) || { id: routeId };
  let resolvedRoute = route;

  try {
    resolvedRoute = await enrichRoute(route);
  } catch (error) {
    console.error(`BusTime could not load stops for ${routeCode(route)}:`, error);
    resolvedRoute = { ...route, directions: [], stopsUnavailable: true };
  }

  await applyRoute(resolvedRoute);
}

function loadBusAlerts() {
  if (!selectedRoute) return;
  const selectedCode = normalizeRouteCode(routeCode(selectedRoute));
  return loadServiceAlerts(elements.alerts, ALERTS_URL, {
    matches: (alert) => {
      const routeIds = (alert.informedEntity || []).map((entity) => entity.routeId).filter(Boolean);
      if (routeIds.length === 0 || !selectedCode) return true;
      return routeIds.some((routeId) => (
        routeId === selectedRoute?.id
        || normalizeRouteCode(routeCode({ id: routeId })) === selectedCode
      ));
    },
    emptyMessage: "No active MTA bus service changes are reported for this route."
  });
}

async function searchRoutes(query) {
  const searchText = query.trim();
  if (!searchText) {
    elements.error.textContent = "Enter a bus route such as M15, B63, or Q60.";
    elements.error.hidden = false;
    return;
  }

  elements.error.hidden = true;
  elements.searchButton.disabled = true;
  elements.updated.textContent = "SEARCHING BUS ROUTES";
  try {
    let response = await fetchApi("search-v2", { q: searchText });
    let results = response.searchResults;
    let suggestions = [...(results?.matches || []), ...(results?.suggestions || [])]
      .filter((suggestion) => suggestion.type === 3 && suggestion.id);
    let firstRoute = results?.firstSuggestion;
    const numericQuery = searchText.match(/\d+/)?.[0];
    if (suggestions.length === 0 && numericQuery && numericQuery !== searchText) {
      response = await fetchApi("search-v2", { q: numericQuery });
      results = response.searchResults;
      suggestions = [...(results?.matches || []), ...(results?.suggestions || [])]
        .filter((suggestion) => suggestion.type === 3 && suggestion.id);
      firstRoute = results?.firstSuggestion;
    }
    if (firstRoute?.type !== 3) firstRoute = null;

    if (firstRoute?.id) suggestions.push(firstRoute);
    if (suggestions.length === 0) {
      const directRoute = await findDirectRoute(searchText);
      if (directRoute) {
        firstRoute = directRoute;
        suggestions.push(directRoute);
      }
    }
    const uniqueSuggestions = [...new Map(suggestions.map((suggestion) => [suggestion.id, suggestion])).values()];
    if (uniqueSuggestions.length === 0) throw new Error("No MTA bus route matched that search.");

    routeOptions = new Map();
    if (firstRoute?.id && Array.isArray(firstRoute.directions)) routeOptions.set(firstRoute.id, firstRoute);
    for (const suggestion of uniqueSuggestions) {
      if (suggestion.directions) routeOptions.set(suggestion.id, suggestion);
    }
    fillSelect(elements.route, uniqueSuggestions, (suggestion) => suggestion.id, (suggestion) => {
      const code = routeCode(suggestion);
      return suggestion.description ? `${code} · ${suggestion.description}` : code;
    });

    const preferredRouteId = localStorage.getItem("bustime-route");
    const normalizedQuery = normalizeRouteCode(searchText);
    const matchingRoute = uniqueSuggestions.find((route) => normalizeRouteCode(routeCode(route)) === normalizedQuery);
    const chosenRouteId = matchingRoute?.id || (uniqueSuggestions.some((route) => route.id === preferredRouteId)
      ? preferredRouteId
      : firstRoute?.id || uniqueSuggestions[0].id);
    elements.route.value = chosenRouteId;
    await loadRouteById(chosenRouteId);
  } catch (error) {
    elements.updated.textContent = "BUS ROUTE SEARCH FAILED";
    elements.error.textContent = error.message || "Could not search MTA bus routes.";
    elements.error.hidden = false;
  } finally {
    elements.searchButton.disabled = false;
  }
}

function getArrivalRecords(payload) {
  const visits = payload?.Siri?.ServiceDelivery?.StopMonitoringDelivery || [];
  return visits.flatMap((delivery) => delivery.MonitoredStopVisit || []);
}

function getArrivals(payload) {
  const now = Date.now();
  const results = [];

  for (const visit of getArrivalRecords(payload)) {
    const journey = visit.MonitoredVehicleJourney;
    if (!journey || journey.LineRef !== selectedRoute.id) continue;
    if (String(journey.DirectionRef) !== String(selectedDirection.directionId)) continue;

    const call = journey.MonitoredCall;
    const expected = Date.parse(call?.ExpectedArrivalTime || call?.ExpectedDepartureTime || "");
    if (!Number.isFinite(expected) || expected < now - 60_000 || expected > now + MAX_LOOKAHEAD * 1000) continue;

    const aimed = Date.parse(call.AimedArrivalTime || call.AimedDepartureTime || "");
    const delay = Number.isFinite(aimed) ? Math.round((expected - aimed) / 1000) : null;
    const distance = call.Extensions?.Distances || {};
    const vehicleRef = String(journey.VehicleRef || "");
    results.push({
      id: vehicleRef.split(/[ _]/).at(-1) || journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef || "",
      line: journey.PublishedLineName || routeCode({ id: journey.LineRef }),
      destination: journey.DestinationName || selectedDirection.destination,
      arrival: expected,
      delay,
      distance: distance.PresentableDistance || "",
      stopsAway: distance.StopsFromCall
    });
  }

  const unique = new Map();
  for (const arrival of results.sort((first, second) => first.arrival - second.arrival)) {
    const id = arrival.id || `${arrival.line}-${arrival.arrival}`;
    if (!unique.has(id)) unique.set(id, arrival);
  }
  return [...unique.values()].slice(0, 8);
}

function renderArrivals(arrivals) {
  if (arrivals.length === 0) {
    showMessage("empty-state", "No buses approaching this stop", "Try another stop or check back shortly.");
    return;
  }

  const fragment = document.createDocumentFragment();
  const now = Date.now();
  for (const [index, arrival] of arrivals.entries()) {
    const row = elements.template.content.firstElementChild.cloneNode(true);
    row.style.animationDelay = `${index * 40}ms`;
    const time = row.querySelector(".departure-time");
    time.textContent = formatTime(arrival.arrival);
    time.dateTime = new Date(arrival.arrival).toISOString();
    const minutes = Math.max(0, Math.round((arrival.arrival - now) / 60_000));
    row.querySelector(".departure-relative").textContent = minutes < 1 ? "Due" : `in ${minutes} min`;
    row.querySelector(".bus-route-badge").textContent = routeCode(selectedRoute);
    row.querySelector(".train-name").textContent = arrival.line;
    row.querySelector(".train-direction").textContent = `Toward ${arrival.destination}`;
    row.querySelector(".train-id").textContent = arrival.id ? `Bus ${arrival.id}` : "Live trip";

    const stopsAway = Number(arrival.stopsAway);
    const stopCount = Number.isFinite(stopsAway) ? `${stopsAway} ${stopsAway === 1 ? "stop" : "stops"}` : "";
    const includesStopCount = /\bstops?\b/i.test(arrival.distance);
    const distance = [arrival.distance, includesStopCount ? "" : stopCount]
      .filter(Boolean)
      .join(" · ");
    row.querySelector(".bus-distance").textContent = distance;

    const status = document.createElement("span");
    status.className = "status-pill";
    if (arrival.delay === null) {
      status.classList.add("unknown");
      status.textContent = "LIVE ETA";
    } else if (arrival.delay >= 60) {
      status.classList.add("delayed");
      status.textContent = `${Math.round(arrival.delay / 60)} MIN LATE`;
    } else {
      status.textContent = "ON TIME";
    }
    row.querySelector(".status-block").append(status);
    fragment.append(row);
  }

  elements.arrivals.replaceChildren(fragment);
}

async function loadArrivals() {
  if (!selectedRoute || !selectedDirection || !selectedStop) return;
  const thisRequest = ++requestNumber;
  const stopId = selectedStop.id;
  elements.refresh.classList.add("is-spinning");
  elements.arrivals.setAttribute("aria-busy", "true");
  elements.updated.textContent = "FETCHING LIVE BUS TIMES";
  if (elements.arrivals.children.length === 0 || elements.arrivals.querySelector(".empty-state, .error-state, .loading-state")) {
    const loading = document.createElement("div");
    loading.className = "loading-state";
    loading.innerHTML = '<span class="loading-bar"></span><span>Checking BusTime predictions</span>';
    elements.arrivals.replaceChildren(loading);
  }

  try {
    const payload = await fetchApi("siri/stop-monitoring.json", {
      key: PUBLIC_API_KEY,
      MonitoringRef: stopId,
      MaximumStopVisits: "20"
    });
    if (thisRequest !== requestNumber) return;
    renderArrivals(getArrivals(payload));
    elements.connection.textContent = "LIVE FEED";
    elements.updated.textContent = `UPDATED ${new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date()).toUpperCase()}`;
  } catch (error) {
    if (thisRequest !== requestNumber) return;
    console.error("Unable to load BusTime arrivals:", error);
    elements.connection.textContent = "FEED UNAVAILABLE";
    elements.updated.textContent = "BUS TIMES UNAVAILABLE";
    showMessage("error-state", "Could not reach MTA BusTime", "Check your connection and try again.", "Open BusTime", "https://bustime.mta.info/");
  } finally {
    if (thisRequest === requestNumber) {
      elements.refresh.classList.remove("is-spinning");
      elements.arrivals.setAttribute("aria-busy", "false");
    }
  }
}

function updateDirection() {
  selectedDirection = (selectedRoute?.directions || []).find((direction) => direction.directionId === elements.direction.value) || null;
  if (selectedDirection) populateStops(selectedDirection);
}

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchRoutes(elements.query.value);
});
elements.route.addEventListener("change", () => {
  loadRouteById(elements.route.value).catch((error) => {
    elements.error.textContent = error.message || "Could not load that bus route.";
    elements.error.hidden = false;
  });
});
elements.direction.addEventListener("change", updateDirection);
elements.stop.addEventListener("change", () => {
  selectedStop = (selectedDirection?.stops || []).find((stop) => stop.id === elements.stop.value) || null;
  updateBoardLabels();
  loadArrivals();
});
elements.refresh.addEventListener("click", () => {
  loadArrivals();
  void loadBusAlerts();
});
updateClock();
setInterval(updateClock, 15_000);
setInterval(() => { void loadBusAlerts(); }, ALERTS_REFRESH_INTERVAL);
setInterval(() => {
  if (selectedStop) loadArrivals();
}, REFRESH_INTERVAL);
searchRoutes(elements.query.value);