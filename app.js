import bindings from "https://esm.sh/gtfs-realtime-bindings@1.1.1?bundle";
import { loadServiceAlerts } from "./service-alerts.js";

const FEED_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr";
const ALERTS_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Flirr-alerts";
const SCHEDULE_URL = "./schedule.json";
const REFRESH_INTERVAL = 30_000;
const MAX_LOOKAHEAD = 2 * 60 * 60;
const JAMAICA_STATION_ID = "102";
const MANHATTAN_TERMINALS = ["237", "349"];
const MIN_TRANSFER_SECONDS = 6 * 60;
const MAX_TRANSFER_SECONDS = 25 * 60;
const STATIONS = [
  ["1", "Albertson"], ["100", "Islip"], ["101", "Inwood"], ["102", "Jamaica"],
  ["107", "Kew Gardens"], ["11", "Broadway"], ["111", "Kings Park"], ["113", "Long Beach"],
  ["114", "Lawrence"], ["117", "Lindenhurst"], ["118", "Long Island City"], ["119", "Locust Manor"],
  ["120", "Little Neck"], ["122", "Laurelton"], ["123", "Locust Valley"], ["124", "Lakeview"],
  ["125", "Lynbrook"], ["126", "Mattituck"], ["127", "Merillon Avenue"], ["129", "Medford"],
  ["13", "Bridgehampton"], ["130", "Murray Hill"], ["131", "Manhasset"], ["132", "Mineola"],
  ["135", "Massapequa Park"], ["136", "Massapequa"], ["14", "Stony Brook"], ["140", "Mastic-Shirley"],
  ["141", "Montauk"], ["142", "Malverne"], ["148", "Nostrand Avenue"], ["149", "Nassau Boulevard"],
  ["152", "New Hyde Park"], ["153", "Northport"], ["154", "Oyster Bay"], ["155", "Oceanside"],
  ["157", "Oakdale"], ["16", "Bellmore"], ["162", "Plandome"], ["163", "Patchogue"],
  ["164", "Port Jefferson"], ["165", "Pinelawn"], ["171", "Port Washington"], ["175", "Queens Village"],
  ["176", "Riverhead"], ["179", "Ronkonkoma"], ["180", "Rosedale"], ["182", "Roslyn"],
  ["183", "Rockville Centre"], ["184", "St. Albans"], ["185", "Sea Cliff"], ["187", "Seaford"],
  ["190", "Southold"], ["191", "Southampton"], ["193", "St. James"], ["195", "Stewart Manor"],
  ["198", "Speonk"], ["199", "Mets-Willets Point"], ["2", "Auburndale"], ["20", "Bethpage"],
  ["202", "Smithtown"], ["204", "Sayville"], ["205", "Syosset"], ["21", "Bellport"],
  ["211", "Valley Stream"], ["213", "Westbury"], ["214", "Woodside"], ["215", "Wantagh"],
  ["216", "West Hempstead"], ["217", "Woodmere"], ["219", "Westwood"], ["220", "Wyandanch"],
  ["223", "Yaphank-BNL"], ["225", "Baldwin"], ["226", "Merrick"], ["23", "Bellerose"],
  ["233", "Westhampton"], ["237", "Penn Station"], ["24", "Belmont Park"], ["241", "Atlantic Terminal"],
  ["25", "Bayside"], ["26", "Bay Shore"], ["27", "Babylon"], ["29", "Brentwood"],
  ["31", "Centre Avenue"], ["32", "Cedarhurst"], ["33", "Central Islip"], ["349", "Grand Central"],
  ["359", "Elmont-UBS Arena"], ["36", "Country Life Press"], ["38", "Copiague"], ["39", "Carle Place"],
  ["4", "Amagansett"], ["40", "Cold Spring Harbor"], ["42", "Douglaston"], ["44", "Deer Park"],
  ["48", "East Hampton"], ["50", "East New York"], ["51", "East Rockaway"], ["52", "East Williston"],
  ["55", "Forest Hills"], ["56", "Flushing Main Street"], ["59", "Farmingdale"], ["63", "Floral Park"],
  ["64", "Freeport"], ["65", "Far Rockaway"], ["66", "Gibson"], ["67", "Glen Cove"],
  ["68", "Garden City"], ["71", "Glen Head"], ["72", "Great Neck"], ["73", "Greenport"],
  ["74", "Great River"], ["76", "Glen Street"], ["77", "Greenvale"], ["78", "Greenlawn"],
  ["8", "Amityville"], ["83", "Hampton Bays"], ["84", "Hempstead"], ["85", "Hempstead Gardens"],
  ["86", "Hillside Facility"], ["89", "Hollis"], ["90", "Hunterspoint Avenue"], ["91", "Huntington"],
  ["92", "Hicksville"], ["94", "Hewlett"], ["99", "Island Park"]
].map(([id, name]) => ({ id, name })).sort((first, second) => first.name.localeCompare(second.name));

const { transit_realtime: transitRealtime } = bindings;
const elements = {
  connection: document.querySelector("#connection-label"),
  time: document.querySelector("#current-time"),
  date: document.querySelector("#current-date"),
  form: document.querySelector("#route-form"),
  from: document.querySelector("#from-station"),
  to: document.querySelector("#to-station"),
  swap: document.querySelector("#swap-stations"),
  find: document.querySelector("#find-trains"),
  routeError: document.querySelector("#route-error"),
  originLabel: document.querySelector("#board-origin"),
  destinationLabel: document.querySelector("#board-destination"),
  updated: document.querySelector("#updated-label"),
  departures: document.querySelector("#departures"),
  alerts: document.querySelector("#service-alerts"),
  refresh: document.querySelector("#refresh-button"),
  favorite: document.querySelector("#favorite-route"),
  savedTrips: document.querySelector("#saved-trips"),
  template: document.querySelector("#departure-template")
};

const stationNames = new Map(STATIONS.map((station) => [station.id, station.name]));
const TRAIN_TIME_STATION_CODES = new Map([
  ["1", "ABT"], ["100", "ISP"], ["101", "IWD"], ["102", "JAM"], ["107", "KGN"],
  ["11", "BDY"], ["111", "KPK"], ["113", "LBH"], ["114", "LCE"], ["117", "LHT"],
  ["118", "LIC"], ["119", "LMR"], ["120", "LNK"], ["122", "LTN"], ["123", "LVL"],
  ["124", "LVW"], ["125", "LYN"], ["126", "MAK"], ["127", "MAV"], ["129", "MFD"],
  ["13", "BHN"], ["130", "MHL"], ["131", "MHT"], ["132", "MIN"], ["135", "MPK"],
  ["136", "MQA"], ["14", "BK"], ["140", "MSY"], ["141", "MTK"], ["142", "MVN"],
  ["148", "NAV"], ["149", "NBD"], ["152", "NHP"], ["153", "NPT"], ["154", "OBY"],
  ["155", "ODE"], ["157", "ODL"], ["16", "BMR"], ["162", "PDM"], ["163", "PGE"],
  ["164", "PJN"], ["165", "PLN"], ["171", "PWS"], ["175", "QVG"], ["176", "RHD"],
  ["179", "RON"], ["180", "ROS"], ["182", "RSN"], ["183", "RVC"], ["184", "SAB"],
  ["185", "SCF"], ["187", "SFD"], ["190", "SHD"], ["191", "SHN"], ["193", "SJM"],
  ["195", "SMR"], ["198", "SPK"], ["199", "SSM"], ["2", "ADL"], ["20", "BPG"],
  ["202", "STN"], ["204", "SVL"], ["205", "SYT"], ["21", "BPT"], ["211", "VSM"],
  ["213", "WBY"], ["214", "WDD"], ["215", "WGH"], ["216", "WHD"], ["217", "WMR"],
  ["219", "WWD"], ["220", "WYD"], ["223", "YPK"], ["225", "BWN"], ["226", "MRK"],
  ["23", "BRS"], ["233", "WHN"], ["237", "NYK"], ["24", "BRT"], ["241", "ATL"],
  ["25", "BSD"], ["26", "BSR"], ["27", "BTA"], ["29", "BWD"], ["31", "CAV"],
  ["32", "CHT"], ["33", "CI"], ["349", "GCT"], ["359", "EMT"], ["36", "CLP"],
  ["38", "CPG"], ["39", "CPL"], ["4", "AGT"], ["40", "CSH"], ["42", "DGL"],
  ["44", "DPK"], ["48", "EHN"], ["50", "ENY"], ["51", "ERY"], ["52", "EWN"],
  ["55", "FHL"], ["56", "FLS"], ["59", "FMD"], ["63", "FPK"], ["64", "FPT"],
  ["65", "FRY"], ["66", "GBN"], ["67", "GCV"], ["68", "GCY"], ["71", "GHD"],
  ["72", "GNK"], ["73", "GPT"], ["74", "GRV"], ["76", "GST"], ["77", "GVL"],
  ["78", "GWN"], ["8", "AVL"], ["83", "HBY"], ["84", "HEM"], ["85", "HGN"],
  ["86", "HIL"], ["89", "HOL"], ["90", "HPA"], ["91", "HUN"], ["92", "HVL"],
  ["94", "HWT"], ["99", "IPK"]
]);
const TRAIN_TIME_ARRIVALS_URL = "https://backend-unified.mylirr.org/arrivals/";
let requestNumber = 0;
let schedulePromise;
let renderedRouteKey = null;
const FAVORITES_KEY = "trackline-favorite-routes";
const RECENTS_KEY = "trackline-recent-routes";

function readSavedRoutes(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(saved) ? saved.filter((route) => (
      route && stationNames.has(route.from) && stationNames.has(route.to) && route.from !== route.to
    )) : [];
  } catch (error) {
    console.error(`Unable to read saved trips from ${key}:`, error);
    return [];
  }
}

function currentRoute() {
  return { from: elements.from.value, to: elements.to.value };
}

function routeKey(route) {
  return `${route.from}:${route.to}`;
}

function renderSavedTrips() {
  const favorites = readSavedRoutes(FAVORITES_KEY);
  const recents = readSavedRoutes(RECENTS_KEY);
  const currentKey = routeKey(currentRoute());
  const isFavorite = favorites.some((route) => routeKey(route) === currentKey);
  elements.favorite.setAttribute("aria-pressed", String(isFavorite));
  elements.favorite.textContent = isFavorite ? "★ Saved trip" : "☆ Save this trip";

  const fragment = document.createDocumentFragment();
  for (const [label, routes] of [["FAVORITES", favorites], ["RECENT", recents]]) {
    if (routes.length === 0) continue;
    const group = document.createElement("div");
    group.className = "saved-trip-group";
    const heading = document.createElement("span");
    heading.className = "saved-trip-label";
    heading.textContent = label;
    group.append(heading);
    for (const route of routes) {
      const button = document.createElement("button");
      button.className = "saved-trip";
      button.type = "button";
      button.textContent = `${stationNames.get(route.from)} → ${stationNames.get(route.to)}`;
      button.setAttribute("aria-label", `Show trains from ${stationNames.get(route.from)} to ${stationNames.get(route.to)}`);
      button.addEventListener("click", () => {
        elements.from.value = route.from;
        elements.to.value = route.to;
        loadDepartures();
      });
      group.append(button);
    }
    fragment.append(group);
  }
  elements.savedTrips.replaceChildren(fragment);
  renderedRouteKey = currentKey;
}

function rememberRoute(route, key, limit) {
  const saved = readSavedRoutes(key);
  if (saved[0] && routeKey(saved[0]) === routeKey(route)) return;
  const filtered = saved.filter((item) => routeKey(item) !== routeKey(route));
  filtered.unshift(route);
  localStorage.setItem(key, JSON.stringify(filtered.slice(0, limit)));
}

function populateStations() {
  const savedFrom = localStorage.getItem("trackline-from") || "237";
  const savedTo = localStorage.getItem("trackline-to") || "102";

  for (const select of [elements.from, elements.to]) {
    const fragment = document.createDocumentFragment();
    for (const station of STATIONS) {
      const option = document.createElement("option");
      option.value = station.id;
      option.textContent = station.name;
      fragment.append(option);
    }
    select.append(fragment);
  }

  elements.from.value = stationNames.has(savedFrom) ? savedFrom : "237";
  elements.to.value = stationNames.has(savedTo) ? savedTo : "102";
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

function timestampSeconds(value) {
  if (typeof value?.toNumber === "function") return value.toNumber();
  return Number(value);
}

function getTrackNumber(stopUpdate) {
  const stopProperties = stopUpdate.stopTimeProperties || stopUpdate.stop_time_properties || {};
  const containers = [
    stopUpdate,
    stopProperties,
    stopUpdate.extensions,
    stopProperties.extensions,
    stopUpdate.arrival,
    stopUpdate.departure,
    stopUpdate.arrival?.extensions,
    stopUpdate.departure?.extensions
  ];
  function findTrack(value, depth = 0, trackContext = false) {
    if (!value || typeof value !== "object" || depth > 4) return null;

    for (const [field, item] of Object.entries(value)) {
      const isTrackField = trackContext || /track|platform/i.test(field);
      if (typeof item === "number" && isTrackField && Number.isFinite(item)) return String(item);
      if (typeof item === "string") {
        const text = item.trim();
        const labeledTrack = text.match(/^(?:track|platform)\s*(?:no\.?|number|#)?\s*:?\s*([a-z0-9-]+)$/i);
        if (labeledTrack) return labeledTrack[1];
        if (isTrackField && /^(?:[a-z]?\d+[a-z]?)$/i.test(text)) return text;
      } else if (item && typeof item === "object") {
        const nestedTrack = findTrack(item, depth + 1, isTrackField);
        if (nestedTrack) return nestedTrack;
      }
    }

    return null;
  }

  for (const container of containers) {
    const track = findTrack(container);
    if (track) return track;
  }

  return null;
}

function formatTime(seconds) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(seconds * 1000));
}

function relativeDeparture(seconds, nowSeconds) {
  const minutes = Math.max(0, Math.round((seconds - nowSeconds) / 60));
  return minutes < 1 ? "Due" : `in ${minutes} min`;
}

function currentServiceDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function scheduledTimestamp(serviceDate, timeText) {
  const [year, month, day] = [
    Number(serviceDate.slice(0, 4)),
    Number(serviceDate.slice(4, 6)),
    Number(serviceDate.slice(6, 8))
  ];
  const [hours, minutes, seconds] = timeText.split(":").map(Number);
  if (![year, month, day, hours, minutes, seconds].every(Number.isFinite)) return NaN;

  const wallClock = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  let timestamp = wallClock;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
    const representedTime = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute), Number(values.second)
    );
    timestamp = wallClock - (representedTime - timestamp);
  }

  return timestamp / 1000;
}

async function loadSchedule() {
  if (!schedulePromise) {
    schedulePromise = fetch(SCHEDULE_URL, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Schedule returned ${response.status}`);
        return response.json();
      })
      .catch((error) => {
        schedulePromise = undefined;
        throw error;
      });
  }
  return schedulePromise;
}

function getNextScheduledTrip(schedule, fromId, toId) {
  const nowSeconds = Date.now() / 1000;
  const today = currentServiceDate();
  let nextTrip = null;

  for (const [serviceDate, serviceIds] of Object.entries(schedule.servicesByDate || {})) {
    if (serviceDate < today) continue;
    const activeServices = new Set(serviceIds);

    for (const [tripId, routeId, serviceId, stops] of schedule.trips || []) {
      if (!activeServices.has(serviceId)) continue;
      const fromIndex = stops.findIndex((stop) => String(stop[0]) === fromId);
      if (fromIndex < 0) continue;
      const toIndex = stops.findIndex((stop, index) => index > fromIndex && String(stop[0]) === toId);
      if (toIndex < 0) continue;

      const departure = scheduledTimestamp(serviceDate, stops[fromIndex][2] || stops[fromIndex][1]);
      const arrival = scheduledTimestamp(serviceDate, stops[toIndex][1] || stops[toIndex][2]);
      if (!Number.isFinite(departure) || !Number.isFinite(arrival) || departure < nowSeconds - 60) continue;
      if (!nextTrip || departure < nextTrip.departure) {
        nextTrip = { id: tripId, route: routeId || "LIRR", departure, arrival, delay: null };
      }
    }
  }

  return nextTrip;
}

function getRouteTrips(feed, fromId, toId) {
  const nowSeconds = Date.now() / 1000;
  const results = [];

  for (const entity of feed.entity || []) {
    const update = entity.tripUpdate;
    if (!update || update.trip?.scheduleRelationship === 3) continue;

    const stops = update.stopTimeUpdate || [];
    const fromIndex = stops.findIndex((stop) => String(stop.stopId) === fromId);
    if (fromIndex < 0) continue;

    const toIndex = stops.findIndex((stop, index) => index > fromIndex && String(stop.stopId) === toId);
    if (toIndex < 0) continue;

    const fromStop = stops[fromIndex];
    const toStop = stops[toIndex];
    const departure = timestampSeconds(fromStop.departure?.time ?? fromStop.arrival?.time);
    const arrival = timestampSeconds(toStop.arrival?.time ?? toStop.departure?.time);
    if (!Number.isFinite(departure) || !Number.isFinite(arrival)) continue;
    if (departure < nowSeconds - 90 || departure > nowSeconds + MAX_LOOKAHEAD) continue;

    const delay = fromStop.departure?.delay ?? fromStop.arrival?.delay;
    results.push({
      id: update.trip?.tripId || entity.id,
      departure,
      arrival,
      departureTrack: getTrackNumber(fromStop),
      arrivalTrack: getTrackNumber(toStop),
      delay: Number.isFinite(Number(delay)) ? Number(delay) : null,
      route: update.trip?.routeId || "LIRR"
    });
  }

  return results.sort((first, second) => first.departure - second.departure).slice(0, 8);
}

function matchTransferLegs(firstLegs, secondLegs, toId) {
  const itineraries = [];
  for (const firstLeg of firstLegs) {
    const connections = secondLegs.filter((secondLeg) => {
      const transferTime = secondLeg.departure - firstLeg.arrival;
      return secondLeg.id !== firstLeg.id
        && transferTime >= MIN_TRANSFER_SECONDS
        && transferTime <= MAX_TRANSFER_SECONDS;
    }).sort((first, second) => first.arrival - second.arrival);
    if (connections.length === 0) continue;
    itineraries.push({
      departure: firstLeg.departure,
      arrival: connections[0].arrival,
      firstLeg,
      secondLeg: connections[0],
      layover: connections[0].departure - firstLeg.arrival,
      destinationId: toId
    });
  }

  const uniqueItineraries = new Map();
  for (const itinerary of itineraries.sort((first, second) => first.departure - second.departure)) {
    if (!uniqueItineraries.has(itinerary.firstLeg.id)) {
      uniqueItineraries.set(itinerary.firstLeg.id, itinerary);
    }
  }
  return [...uniqueItineraries.values()].slice(0, 8);
}

function getTransferTrips(feed, fromId, toId) {
  const nowSeconds = Date.now() / 1000;
  const firstLegs = [];
  const secondLegs = [];

  for (const entity of feed.entity || []) {
    const update = entity.tripUpdate;
    if (!update || update.trip?.scheduleRelationship === 3) continue;

    const stops = update.stopTimeUpdate || [];
    const tripId = update.trip?.tripId || entity.id;
    const route = update.trip?.routeId || "LIRR";
    const originIndex = stops.findIndex((stop) => String(stop.stopId) === fromId);
    const destinationIndex = stops.findIndex((stop) => String(stop.stopId) === toId);
    const jamaicaIndex = stops.findIndex((stop) => String(stop.stopId) === JAMAICA_STATION_ID);

    if (originIndex >= 0 && jamaicaIndex > originIndex) {
      const originStop = stops[originIndex];
      const jamaicaStop = stops[jamaicaIndex];
      const departure = timestampSeconds(originStop.departure?.time ?? originStop.arrival?.time);
      const arrival = timestampSeconds(jamaicaStop.arrival?.time ?? jamaicaStop.departure?.time);
      if (Number.isFinite(departure) && Number.isFinite(arrival)
        && departure >= nowSeconds - 90 && departure <= nowSeconds + MAX_LOOKAHEAD
        && arrival > departure) {
        firstLegs.push({
          id: tripId,
          route,
          departure,
          arrival,
          departureTrack: getTrackNumber(originStop),
          arrivalTrack: getTrackNumber(jamaicaStop)
        });
      }
    }

    if (jamaicaIndex >= 0 && destinationIndex > jamaicaIndex) {
      const jamaicaStop = stops[jamaicaIndex];
      const destinationStop = stops[destinationIndex];
      const departure = timestampSeconds(jamaicaStop.departure?.time ?? jamaicaStop.arrival?.time);
      const arrival = timestampSeconds(destinationStop.arrival?.time ?? destinationStop.departure?.time);
      if (Number.isFinite(departure) && Number.isFinite(arrival)
        && departure <= nowSeconds + MAX_LOOKAHEAD && arrival > departure) {
        secondLegs.push({
          id: tripId,
          route,
          departure,
          arrival,
          departureTrack: getTrackNumber(jamaicaStop),
          arrivalTrack: getTrackNumber(destinationStop)
        });
      }
    }
  }

  return matchTransferLegs(firstLegs, secondLegs, toId);
}

function getScheduledTransferTrips(schedule, fromId, toId) {
  const nowSeconds = Date.now() / 1000;
  const firstLegs = [];
  const secondLegs = [];
  const today = currentServiceDate();

  for (const [serviceDate, serviceIds] of Object.entries(schedule.servicesByDate || {})) {
    if (serviceDate < today) continue;
    const activeServices = new Set(serviceIds);
    for (const [tripId, routeId, serviceId, stops] of schedule.trips || []) {
      if (!activeServices.has(serviceId)) continue;
      const jamaicaIndex = stops.findIndex((stop) => String(stop[0]) === JAMAICA_STATION_ID);
      if (jamaicaIndex < 0) continue;
      const originIndex = stops.findIndex((stop, index) => index < jamaicaIndex && String(stop[0]) === fromId);
      if (originIndex >= 0) {
        const departure = scheduledTimestamp(serviceDate, stops[originIndex][2] || stops[originIndex][1]);
        const arrival = scheduledTimestamp(serviceDate, stops[jamaicaIndex][1] || stops[jamaicaIndex][2]);
        if (Number.isFinite(departure) && Number.isFinite(arrival)
          && departure >= nowSeconds && departure <= nowSeconds + MAX_LOOKAHEAD && arrival > departure) {
          firstLegs.push({
            id: tripId,
            route: routeId || "LIRR",
            departure,
            arrival,
            scheduled: true
          });
        }
      }

      const destinationIndex = stops.findIndex((stop, index) => index > jamaicaIndex && String(stop[0]) === toId);
      if (destinationIndex > jamaicaIndex) {
        const departure = scheduledTimestamp(serviceDate, stops[jamaicaIndex][2] || stops[jamaicaIndex][1]);
        const arrival = scheduledTimestamp(serviceDate, stops[destinationIndex][1] || stops[destinationIndex][2]);
        if (Number.isFinite(departure) && Number.isFinite(arrival)
          && departure >= nowSeconds && departure <= nowSeconds + MAX_LOOKAHEAD && arrival > departure) {
          secondLegs.push({
            id: tripId,
            route: routeId || "LIRR",
            departure,
            arrival,
            scheduled: true
          });
        }
      }
    }
  }

  return matchTransferLegs(firstLegs, secondLegs, toId);
}

function showMessage(kind, heading, message, linkLabel, linkHref) {
  const state = document.createElement("div");
  state.className = `${kind}-state`;
  const title = document.createElement("strong");
  title.textContent = heading;
  const body = document.createElement("span");
  body.textContent = message;
  state.append(title, body);

  if (linkLabel && linkHref) {
    const link = document.createElement("a");
    link.href = linkHref;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = linkLabel;
    state.append(link);
  }

  if (kind === "error") {
    const retry = document.createElement("button");
    retry.className = "retry-button";
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => elements.refresh.click());
    state.append(retry);
  }

  elements.departures.replaceChildren(state);
}

function appendItineraryStop(timeline, timestamp, station, track, event, endpoint = false) {
  const stop = document.createElement("div");
  stop.className = `itinerary-stop${endpoint ? " itinerary-endpoint" : ""}`;
  const time = document.createElement("time");
  time.dateTime = new Date(timestamp * 1000).toISOString();
  time.textContent = formatTime(timestamp);
  const name = document.createElement("strong");
  name.textContent = station;
  stop.append(time, name);
  if (track) {
    const description = document.createElement("span");
    description.textContent = `${event} · Track ${track}`;
    stop.append(description);
  }
  timeline.append(stop);
}

function renderTransferDepartures(itineraries, append = false) {
  if (itineraries.length === 0) return false;

  const fragment = document.createDocumentFragment();
  const groups = new Map();
  for (const itinerary of itineraries) {
    if (!groups.has(itinerary.destinationId)) groups.set(itinerary.destinationId, []);
    groups.get(itinerary.destinationId).push(itinerary);
  }

  for (const [destinationId, group] of groups) {
    const section = document.createElement("section");
    section.className = "transfer-options";
    const sectionHeading = document.createElement("h3");
    sectionHeading.className = "transfer-options-heading";
    sectionHeading.textContent = destinationId === elements.to.value
      ? `Transfer options to ${stationNames.get(destinationId)}`
      : `Alternative transfer to ${stationNames.get(destinationId)}`;
    section.append(sectionHeading);

    for (const [index, itinerary] of group.entries()) {
      const { firstLeg, secondLeg, layover } = itinerary;
      const card = document.createElement("article");
      card.className = "itinerary-card";
      card.style.animationDelay = `${index * 45}ms`;

      const heading = document.createElement("div");
      heading.className = "itinerary-heading";
      const title = document.createElement("strong");
      title.textContent = `${stationNames.get(elements.from.value)} → ${stationNames.get(destinationId)}`;
      const summary = document.createElement("span");
      const totalMinutes = Math.round((itinerary.arrival - itinerary.departure) / 60);
      summary.textContent = `${totalMinutes} min · 1 transfer at Jamaica`;
      heading.append(title, summary);

      const timeline = document.createElement("div");
      timeline.className = "itinerary-timeline";
      appendItineraryStop(timeline, firstLeg.departure, stationNames.get(elements.from.value), firstLeg.departureTrack, "Departs", true);
      appendItineraryStop(timeline, firstLeg.arrival, "Jamaica", firstLeg.arrivalTrack, "Arrives");

      const transfer = document.createElement("div");
      transfer.className = "transfer-wait";
      transfer.textContent = `${Math.round(layover / 60)} MIN TRANSFER`;
      timeline.append(transfer);

      appendItineraryStop(timeline, secondLeg.departure, "Jamaica", secondLeg.departureTrack, "Departs");
      appendItineraryStop(timeline, secondLeg.arrival, stationNames.get(destinationId), secondLeg.arrivalTrack, "Arrives", true);
      card.append(heading, timeline);
      section.append(card);
    }
    fragment.append(section);
  }

  if (append) elements.departures.append(fragment);
  else elements.departures.replaceChildren(fragment);
  return true;
}

function renderDepartures(trips, scheduled = false) {
  if (trips.length === 0) {
    showMessage("empty", "No upcoming trains on this route", "Try another station pair or check back shortly.");
    return;
  }

  const fragment = document.createDocumentFragment();
  const nowSeconds = Date.now() / 1000;

  for (const [index, trip] of trips.entries()) {
    const row = elements.template.content.firstElementChild.cloneNode(true);
    row.style.animationDelay = `${index * 45}ms`;
    row.querySelector(".departure-time").textContent = formatTime(trip.departure);
    row.querySelector(".departure-time").dateTime = new Date(trip.departure * 1000).toISOString();
    row.querySelector(".departure-relative").textContent = relativeDeparture(trip.departure, nowSeconds);
    row.querySelector(".train-name").textContent = trip.route === "LIRR" ? "Long Island Rail Road" : `LIRR · ${trip.route}`;
    row.querySelector(".train-summary").textContent = scheduled ? "Scheduled service" : "Live service";
    const trackInfo = row.querySelector(".track-info");
    const trackAssignments = [];
    if (trip.departureTrack) trackAssignments.push([".departure-track-info", `DEP TRACK ${trip.departureTrack}`]);
    if (trip.arrivalTrack) trackAssignments.push([".arrival-track-info", `ARR TRACK ${trip.arrivalTrack}`]);
    for (const [selector, text] of trackAssignments) {
      const detail = row.querySelector(selector);
      detail.textContent = text;
      detail.hidden = false;
    }
    trackInfo.hidden = trackAssignments.length === 0;
    row.querySelector(".arrival-time").textContent = formatTime(trip.arrival);
    row.querySelector(".arrival-time").dateTime = new Date(trip.arrival * 1000).toISOString();

    const status = document.createElement("span");
    status.className = "status-pill";
    if (scheduled) {
      status.classList.add("scheduled");
      status.textContent = "SCHEDULED";
    } else if (trip.delay === null) {
      status.classList.add("unknown");
      status.textContent = "LIVE UPDATE";
    } else if (trip.delay >= 60) {
      status.classList.add("delayed");
      status.textContent = `${Math.round(trip.delay / 60)} MIN LATE`;
    } else if (trip.delay <= -60) {
      status.classList.add("unknown");
      status.textContent = `${Math.round(Math.abs(trip.delay) / 60)} MIN EARLY`;
    } else {
      status.textContent = "ON TIME";
    }
    row.querySelector(".status-block").append(status);
    fragment.append(row);
  }

  elements.departures.replaceChildren(fragment);
}

function updateRouteLabels() {
  elements.originLabel.textContent = stationNames.get(elements.from.value);
  elements.destinationLabel.textContent = stationNames.get(elements.to.value);
  if (routeKey(currentRoute()) !== renderedRouteKey) renderSavedTrips();
  elements.routeError.hidden = true;
}

async function loadDepartures() {
  const fromId = elements.from.value;
  const toId = elements.to.value;
  if (fromId === toId) {
    elements.routeError.textContent = "Choose two different stations to find trains.";
    elements.routeError.hidden = false;
    return;
  }

  localStorage.setItem("trackline-from", fromId);
  localStorage.setItem("trackline-to", toId);
  rememberRoute({ from: fromId, to: toId }, RECENTS_KEY, 5);
  updateRouteLabels();

  const thisRequest = ++requestNumber;
  elements.find.disabled = true;
  elements.refresh.classList.add("is-spinning");
  elements.departures.setAttribute("aria-busy", "true");
  elements.updated.textContent = "FETCHING LIVE DATA";
  if (elements.departures.children.length === 0 || elements.departures.querySelector(".empty-state, .error-state, .loading-state")) {
    elements.departures.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "loading-state";
    loading.innerHTML = '<span class="loading-bar"></span><span>Checking live departures</span>';
    elements.departures.append(loading);
  }

  try {
    const response = await fetch(FEED_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`MTA feed returned ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const feed = transitRealtime.FeedMessage.decode(bytes);
    if (thisRequest !== requestNumber) return;

    const realtimeTrips = getRouteTrips(feed, fromId, toId);
    const transferDestinations = MANHATTAN_TERMINALS.includes(toId)
      ? MANHATTAN_TERMINALS.filter((terminalId) => terminalId !== fromId)
      : [toId];
    const transferTrips = [];
    const hasDirectTrips = realtimeTrips.length > 0;
    if (hasDirectTrips) renderDepartures(realtimeTrips);

    let scheduleData;
    for (const destinationId of transferDestinations) {
      const liveTrips = getTransferTrips(feed, fromId, destinationId);
      if (liveTrips.length > 0) {
        transferTrips.push(...liveTrips);
        continue;
      }

      try {
        scheduleData ||= await loadSchedule();
        transferTrips.push(...getScheduledTransferTrips(scheduleData, fromId, destinationId));
      } catch (scheduleError) {
        console.error(`Unable to load scheduled transfer options to ${stationNames.get(destinationId)}:`, scheduleError);
      }
    }
    if (thisRequest !== requestNumber) return;
    const hasTransferTrips = transferTrips.length > 0;
    const hasLiveTransferTrips = transferTrips.some((itinerary) => (
      !itinerary.firstLeg.scheduled && !itinerary.secondLeg.scheduled
    ));
    const hasScheduledTransferTrips = transferTrips.some((itinerary) => (
      itinerary.firstLeg.scheduled || itinerary.secondLeg.scheduled
    ));

    if (hasTransferTrips) {
      if (hasDirectTrips) {
        const directHeading = document.createElement("h3");
        directHeading.className = "transfer-options-heading direct-options-heading";
        directHeading.textContent = "Direct trains";
        elements.departures.prepend(directHeading);
      }
      renderTransferDepartures(transferTrips, hasDirectTrips);
    }

    if (!hasDirectTrips && !hasTransferTrips) {
      try {
        const scheduledTrip = getNextScheduledTrip(scheduleData || await loadSchedule(), fromId, toId);
        if (thisRequest !== requestNumber) return;
        if (scheduledTrip) {
          renderDepartures([scheduledTrip], true);
          elements.updated.textContent = "NEXT SCHEDULED DEPARTURE · NO LIVE TRAINS";
        } else {
          showMessage("empty", "No upcoming train found", "There is no scheduled train for this route in the current timetable.");
        }
      } catch (scheduleError) {
        console.error("Unable to load the LIRR schedule:", scheduleError);
        showMessage("empty", "No live train found", "The scheduled timetable is unavailable right now. Try refreshing shortly.");
      }
    }
    elements.connection.textContent = "LIVE FEED";
    if (hasDirectTrips && hasTransferTrips) {
      elements.updated.textContent = hasLiveTransferTrips && hasScheduledTransferTrips
        ? "LIVE DIRECT TRAINS · LIVE AND TIMETABLE TRANSFERS"
        : hasScheduledTransferTrips
          ? "LIVE DIRECT TRAINS · TIMETABLE TRANSFERS AVAILABLE"
          : "LIVE DIRECT TRAINS · TRANSFER OPTIONS AVAILABLE";
    } else if (hasTransferTrips) {
      elements.updated.textContent = hasLiveTransferTrips
        ? "LIVE CONNECTIONS · TRANSFER AT JAMAICA"
        : "SCHEDULED CONNECTIONS · TRANSFER AT JAMAICA";
    } else if (hasDirectTrips) {
      elements.updated.textContent = `UPDATED ${new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date()).toUpperCase()}`;
    }
  } catch (error) {
    if (thisRequest !== requestNumber) return;
    console.error("Unable to load the MTA LIRR feed:", error);
    elements.connection.textContent = "FEED UNAVAILABLE";
    elements.updated.textContent = "LIVE DATA UNAVAILABLE";
    showMessage("error", "Could not reach live departures", "Check your connection and try again. The MTA feed is public and requires no API key.", "MTA feed status", "https://api.mta.info/");
  } finally {
    if (thisRequest === requestNumber) {
      elements.find.disabled = false;
      elements.refresh.classList.remove("is-spinning");
      elements.departures.setAttribute("aria-busy", "false");
    }
  }
}

populateStations();
updateClock();
updateRouteLabels();
setInterval(updateClock, 15_000);
void loadServiceAlerts(elements.alerts, ALERTS_URL, {
  emptyMessage: "No active LIRR service changes are reported by the MTA."
});
setInterval(() => {
  void loadServiceAlerts(elements.alerts, ALERTS_URL, {
    emptyMessage: "No active LIRR service changes are reported by the MTA."
  });
}, 60_000);
elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadDepartures();
});
elements.refresh.addEventListener("click", () => {
  loadDepartures();
  void loadServiceAlerts(elements.alerts, ALERTS_URL, {
    emptyMessage: "No active LIRR service changes are reported by the MTA."
  });
});
elements.favorite.addEventListener("click", () => {
  const route = currentRoute();
  if (route.from === route.to) return;
  const favorites = readSavedRoutes(FAVORITES_KEY);
  const matchingRoute = favorites.find((item) => routeKey(item) === routeKey(route));
  const updated = matchingRoute
    ? favorites.filter((item) => routeKey(item) !== routeKey(route))
    : [route, ...favorites].slice(0, 8);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
  renderSavedTrips();
});
elements.swap.addEventListener("click", () => {
  const previousFrom = elements.from.value;
  elements.from.value = elements.to.value;
  elements.to.value = previousFrom;
  renderSavedTrips();
  loadDepartures();
});

loadDepartures();
setInterval(loadDepartures, REFRESH_INTERVAL);