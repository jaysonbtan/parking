import type { ApiRecordsResponse, Coordinates } from "./types";

const PARKING_API =
  "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/parking-meters/records";

const PHOTON_API = "https://photon.komoot.io/api/";

const PAGE_SIZE = 100;
const RADIUS_KM = 1;

export async function geocodeAddress(query: string): Promise<Coordinates & { label: string }> {
  const params = new URLSearchParams({
    q: `${query}, Vancouver, BC, Canada`,
    limit: "1",
    lat: "49.25",
    lon: "-123.12",
  });

  const res = await fetch(`${PHOTON_API}?${params}`);
  if (!res.ok) throw new Error("Could not look up that address. Try a different search.");

  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) {
    throw new Error("No results found in Vancouver. Try an intersection or street address.");
  }

  const [lon, lat] = feature.geometry.coordinates;
  const props = feature.properties ?? {};
  const label =
    props.name ??
    [props.housenumber, props.street, props.city].filter(Boolean).join(" ") ??
    query;

  return { lat, lon, label };
}

export async function fetchParkingNear(
  origin: Coordinates
): Promise<ApiRecordsResponse["results"]> {
  const point = `POINT(${origin.lon} ${origin.lat})`;
  const where = encodeURIComponent(
    `within_distance(geo_point_2d, geom'${point}', ${RADIUS_KM}km) AND service_status = 'In Service'`
  );

  const all: ApiRecordsResponse["results"] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const url =
      `${PARKING_API}?where=${where}` +
      `&limit=${PAGE_SIZE}&offset=${offset}` +
      `&select=meter_id,service_status,mobile_payment_number,rate_9am_6pm,rate_6pm_10pm,sector,direction,geo_point_2d`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("Failed to load parking data from the City of Vancouver.");
    }

    const page: ApiRecordsResponse = await res.json();
    total = page.total_count;
    all.push(...page.results);
    offset += PAGE_SIZE;

    if (page.results.length === 0) break;
  }

  return all;
}
