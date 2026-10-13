# Trackline

Trackline is a static transit board for GitHub Pages with LIRR, subway, and MTA BusTime pages. LIRR and subway use MTA GTFS-Realtime feeds. The BusTime page searches the full BusTime route matches and catalog, resolves canonical route IDs, and shows live arrival predictions through MTA's public SIRI API using the public `OBANYC` key exposed by the official site. This includes routes whose IDs have leading zeroes or the `MTABC_` prefix, such as Q6 (`MTABC_Q06`), Q8, and Q9. If BusTime recognizes a route but cannot provide its stop list, the board explains that live stop data is unavailable instead of presenting invented stops.

All three boards show expandable, live MTA service alerts: subway alerts are scoped to the selected line and station, bus alerts to the selected route, and LIRR alerts to the rail network. Alerts refresh every minute and distinguish major service impacts from other changes.

Each board keeps only the most recent selection for quick reopening. The subway board supports fuzzy station and landmark search, MTA-color line shortcuts, nearby stations, recent stops, directional arrival filters, expandable service alerts, and cached arrivals with an offline warning. Subway station coordinates and route order are included in the generated station catalog.

All three boards support a persistent high-contrast board theme, a refresh countdown, pull-to-refresh on mobile, and keyboard shortcuts: `/` focuses the station or route selector, `R` refreshes, and `X` swaps LIRR stations. Feed errors include a retry action.

LIRR results include Jamaica transfer itineraries alongside direct trains. Transfers require at least 6 minutes and allow up to 25 minutes; departure and arrival track/platform assignments are shown when supplied by MTA, without exposing internal trip IDs. Missing track assignments are omitted. When live data cannot form a connection, the static timetable is used and those legs are explicitly labeled scheduled. For Penn Station and Grand Central Madison searches, the other Manhattan terminal is shown as an alternate transfer destination when a connection is available.

## Live URL 

https://ms12871.github.io/trackline/

## Made with Love by Zafar

MTA data is subject to the [MTA terms and conditions](https://new.mta.info/developers/terms-and-conditions).
