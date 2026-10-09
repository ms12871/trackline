import csv
import io
import json
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path


FEED_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "subway-stations.json"
FEED_GROUPS = {
    "ace": {"A", "C", "E", "H"},
    "bdfm": {"B", "D", "F", "FX", "FS", "M"},
    "g": {"G"},
    "jz": {"J", "Z"},
    "l": {"L"},
    "nqrw": {"N", "Q", "R", "W"},
    "main": {"1", "2", "3", "4", "5", "6", "6X", "7", "7X", "GS"},
    "si": {"SI"},
}
FEED_FOR_ROUTE = {
    route_id: feed_group
    for feed_group, route_ids in FEED_GROUPS.items()
    for route_id in route_ids
}


def read_table(archive, filename):
    with archive.open(filename) as source:
        text = io.TextIOWrapper(source, encoding="utf-8-sig", newline="")
        yield from csv.DictReader(text)


def main():
    request = urllib.request.Request(FEED_URL, headers={"User-Agent": "Trackline subway station builder"})
    with urllib.request.urlopen(request, timeout=60) as response:
        archive_bytes = response.read()

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        routes = list(read_table(archive, "routes.txt"))
        stops = list(read_table(archive, "stops.txt"))
        trips = list(read_table(archive, "trips.txt"))
        stop_by_id = {stop["stop_id"]: stop for stop in stops}
        route_ids = {route["route_id"] for route in routes}
        unmapped_routes = route_ids - FEED_FOR_ROUTE.keys()
        if unmapped_routes:
            raise ValueError(f"No realtime feed group configured for: {', '.join(sorted(unmapped_routes))}")

        trip_lines = {}
        for trip in trips:
            if trip["route_id"] in FEED_FOR_ROUTE:
                trip_lines[trip["trip_id"]] = trip["route_id"]

        platforms_by_line = {route_id: defaultdict(set) for route_id in route_ids}
        for stop_time in read_table(archive, "stop_times.txt"):
            route_id = trip_lines.get(stop_time["trip_id"])
            stop = stop_by_id.get(stop_time["stop_id"])
            if not route_id or not stop:
                continue

            station_id = stop["parent_station"] or stop["stop_id"]
            platforms_by_line[route_id][station_id].add(stop["stop_id"])

    stations_by_route = {}
    for route_id, stations in platforms_by_line.items():
        station_rows = []
        for station_id, platform_ids in stations.items():
            station = stop_by_id.get(station_id, {})
            station_rows.append({
                "id": station_id,
                "name": station.get("stop_name") or station_id,
                "stopIds": sorted(platform_ids),
            })
        stations_by_route[route_id] = sorted(station_rows, key=lambda station: station["name"].casefold())

    route_info = [
        {
            "id": route["route_id"],
            "shortName": route["route_short_name"],
            "name": route["route_long_name"],
            "color": f"#{route['route_color']}",
            "textColor": f"#{route['route_text_color']}",
            "sortOrder": int(route["route_sort_order"]),
            "feedGroup": FEED_FOR_ROUTE[route["route_id"]],
        }
        for route in routes
    ]
    route_info.sort(key=lambda route: route["sortOrder"])

    payload = {"routes": route_info, "stationsByRoute": stations_by_route}
    OUTPUT_PATH.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(route_info)} subway routes to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()