# Trackline

Trackline is a static transit board for GitHub Pages with LIRR, subway, and MTA BusTime pages. LIRR and subway use MTA GTFS-Realtime feeds. The BusTime page searches routes, directions, and stops, then shows live arrival predictions through MTA's public SIRI API using the public `OBANYC` key exposed by the official site. If the LIRR feed has no matching trip for the selected stations, it shows the single next scheduled train from the bundled timetable.

On LIRR, save favorite station pairs and reopen recent trips from the route controls. All three boards support a persistent high-contrast board theme, a refresh countdown, pull-to-refresh on mobile, and keyboard shortcuts: `/` focuses the station or route selector, `R` refreshes, and `X` swaps LIRR stations. Feed errors include a retry action.

LIRR results include Jamaica transfer itineraries alongside direct trains. Transfers require at least 6 minutes and allow up to 25 minutes; each card shows arrival/departure track assignments when posted by MTA, without exposing internal trip IDs. When live data cannot form a connection, the static timetable is used and those legs are explicitly labeled scheduled. For Penn Station and Grand Central Madison searches, the other Manhattan terminal is shown as an alternate transfer destination when a connection is available.

## Live URL 

https://ms12871.github.io/trackline/

## Made with Love by Zafar

MTA data is subject to the [MTA terms and conditions](https://new.mta.info/developers/terms-and-conditions).
