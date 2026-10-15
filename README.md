# Trackline

Trackline is a static transit board for GitHub Pages with LIRR, subway, and MTA BusTime pages. LIRR and subway use MTA GTFS-Realtime feeds. The BusTime page searches the full BusTime route matches and catalog, resolves canonical route IDs, and shows live arrival predictions through MTA's public SIRI API using the public `OBANYC` key exposed by the official site. This includes routes whose IDs have leading zeroes or the `MTABC_` prefix, such as Q6 (`MTABC_Q06`), Q8, and Q9. If BusTime recognizes a route but cannot provide its stop list, the board explains that live stop data is unavailable instead of presenting invented stops.

All three boards show expandable, live MTA service alerts: subway alerts are scoped to the selected line and station, bus alerts to the selected route, and LIRR alerts to the rail network. Alerts refresh every minute and distinguish major service impacts from other changes.

Each board keeps only the most recent selection for quick reopening. The subway board supports fuzzy station and landmark search, MTA-color line shortcuts, nearby stations, recent stops, directional arrival filters, expandable service alerts, and cached arrivals with an offline warning. Subway station coordinates and route order are included in the generated station catalog.

All three boards support a persistent high-contrast board theme, a refresh countdown, pull-to-refresh on mobile, and keyboard shortcuts: `/` focuses the station or route selector, `R` refreshes, and `X` swaps LIRR stations. Feed errors include a retry action.

## Trip planner

`planner.html` adds a mobile-friendly multimodal planner with browser GPS, station/address search, a Leaflet map, step-by-step walking and transit legs, and live subway service alerts. It is safe to deploy to GitHub Pages without credentials: when no routing backend is configured, it clearly labels the result as a demo itinerary.

Origin and destination fields accept NYC street addresses, ZIP codes, landmarks, and transit stations. Add an optional `geoapifyKey` in `router-config.js` for Google-like search-as-you-type suggestions backed by OpenStreetMap data. Without it, the app avoids unsupported public Nominatim autocomplete and geocodes only after the user submits. Recent selections are kept in the browser's local storage; no saved address is sent to Trackline. Trips depart as soon as possible; the planner does not currently support an arrive-by time.

Address search and map tiles use OpenStreetMap services. OpenTripPlanner remains an optional production routing backend through `window.TRACKLINE_ROUTER_CONFIG.otpUrl`; load MTA static GTFS feeds and OpenStreetMap data into OTP, and configure CORS for the Trackline origin.

The planner continues to use the existing MTA alert feed for live disruption context; provider-specific real-time trip matching depends on the configured OTP feed and is labeled as scheduled when the provider does not mark a leg real-time.

On phones, the planner uses a map-first layout, focuses the destination after GPS permission, supports Home/Work shortcuts, stores recent locations locally, can open the endpoint in OpenStreetMap directions, and can be installed from the browser's Add to Home Screen action. Geoapify autocomplete requires adding its key to `router-config.js`; the key is optional.

LIRR results include Jamaica transfer itineraries alongside direct trains. Transfers require at least 6 minutes and allow up to 25 minutes; departure and arrival track/platform assignments are shown when supplied by MTA, without exposing internal trip IDs. Missing track assignments are omitted. When live data cannot form a connection, the static timetable is used and those legs are explicitly labeled scheduled. For Penn Station and Grand Central Madison searches, the other Manhattan terminal is shown as an alternate transfer destination when a connection is available.

## Live URL 

https://ms12871.github.io/trackline/

## Made with Love by Zafar

MTA data is subject to the [MTA terms and conditions](https://new.mta.info/developers/terms-and-conditions).
