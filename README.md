# Trackline

Trackline is a static transit board for GitHub Pages with LIRR, subway, and MTA BusTime pages. LIRR and subway use MTA GTFS-Realtime feeds. The BusTime page searches routes, directions, and stops, then shows live arrival predictions through MTA's public SIRI API using the public `OBANYC` key exposed by the official site. If the LIRR feed has no matching trip for the selected stations, it shows the single next scheduled train from the bundled timetable.

## Refresh MTA data

GitHub Pages cannot download the MTA static GTFS archives directly from the browser, so the timetable and subway station lookup are generated locally and served with the site. Refresh them before publishing MTA data updates:

```sh
python3 scripts/build_schedule.py
python3 scripts/build_subway_stations.py
```

Commit the updated `schedule.json` and `subway-stations.json` with the site files. The builders download the current GTFS data from MTA. Live predictions and scheduled departures are labeled separately; scheduled times are not represented as real-time predictions.

MTA data is subject to the [MTA terms and conditions](https://new.mta.info/developers/terms-and-conditions).