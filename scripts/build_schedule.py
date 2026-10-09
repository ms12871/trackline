import csv
import io
import json
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


FEED_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "schedule.json"


def read_table(archive, filename):
    with archive.open(filename) as source:
        text = io.TextIOWrapper(source, encoding="utf-8-sig", newline="")
        return list(csv.DictReader(text))


def main():
    request = urllib.request.Request(FEED_URL, headers={"User-Agent": "Trackline schedule builder"})
    with urllib.request.urlopen(request, timeout=60) as response:
        archive_bytes = response.read()

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        trip_rows = read_table(archive, "trips.txt")
        stop_rows = read_table(archive, "stop_times.txt")
        calendar_rows = read_table(archive, "calendar_dates.txt")

    stop_times = defaultdict(list)
    for row in stop_rows:
        stop_times[row["trip_id"]].append([
            row["stop_id"],
            row["arrival_time"],
            row["departure_time"],
            int(row["stop_sequence"]),
        ])

    services_by_date = defaultdict(set)
    for row in calendar_rows:
        service_id = row["service_id"]
        if row["exception_type"] == "1":
            services_by_date[row["date"]].add(service_id)
        elif row["exception_type"] == "2":
            services_by_date[row["date"]].discard(service_id)

    trips = []
    for row in trip_rows:
        trip_stops = stop_times.get(row["trip_id"])
        if not trip_stops:
            continue
        trip_stops.sort(key=lambda stop: stop[3])
        trips.append([
            row["trip_id"],
            row["route_id"],
            row["service_id"],
            [stop[:3] for stop in trip_stops],
        ])

    schedule = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "servicesByDate": {
            service_date: sorted(service_ids)
            for service_date, service_ids in sorted(services_by_date.items())
        },
        "trips": trips,
    }
    OUTPUT_PATH.write_text(json.dumps(schedule, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(trips)} trips across {len(services_by_date)} service dates to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()