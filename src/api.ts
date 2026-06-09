import type { AddressSuggestion, ApiRecordsResponse, Coordinates } from "./types";
import { matchLocalPlaces } from "./vancouver-places";

const PARKING_API =
  "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/parking-meters/records";

const PHOTON_API = "https://photon.komoot.io/api/";
const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_EMAIL = "github.com/jaysonbtan/parking";

const VANCOUVER_LAT = "49.25";
const VANCOUVER_LON = "-123.12";
const VANCOUVER_BBOX = "-123.28,49.19,-123.0,49.35";

const PAGE_SIZE = 100;
const RADIUS_KM = 1;
const PHOTON_TIMEOUT_MS = 2500;

let lastNominatimSearchAt = 0;

function formatPhotonLabel(
  props: Record<string, string>,
  fallback = ""
): string {
  if (props.name) return props.name;

  const streetLine = [props.housenumber, props.street].filter(Boolean).join(" ");
  if (streetLine) {
    return [streetLine, props.district, props.city].filter(Boolean).join(", ");
  }

  return [props.district, props.city].filter(Boolean).join(", ") || fallback;
}

function formatNominatimLabel(displayName: string): string {
  const parts = displayName.split(",").map((part) => part.trim());
  return parts.slice(0, 2).join(", ") || displayName;
}

function isInVancouver(lat: number, lon: number): boolean {
  return lat >= 49.19 && lat <= 49.35 && lon >= -123.28 && lon <= -123.0;
}

function dedupeSuggestions(suggestions: AddressSuggestion[]): AddressSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = suggestion.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function photonParams(query: string, limit: string): URLSearchParams {
  return new URLSearchParams({
    q: query,
    limit,
    lat: VANCOUVER_LAT,
    lon: VANCOUVER_LON,
    bbox: VANCOUVER_BBOX,
    lang: "en",
  });
}

function featureToSuggestion(
  feature: {
    geometry: { coordinates: [number, number] };
    properties?: Record<string, string>;
  },
  fallback: string
): AddressSuggestion {
  const [lon, lat] = feature.geometry.coordinates;
  const props = feature.properties ?? {};
  return {
    label: formatPhotonLabel(props, fallback),
    lat,
    lon,
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchPhotonSuggestions(query: string): Promise<AddressSuggestion[]> {
  const res = await fetchWithTimeout(
    `${PHOTON_API}?${photonParams(query, "6")}`,
    PHOTON_TIMEOUT_MS
  );
  if (!res.ok) return [];

  const data = await res.json();
  return (data.features ?? [])
    .map((feature: { geometry: { coordinates: [number, number] }; properties?: Record<string, string> }) =>
      featureToSuggestion(feature, query)
    )
    .filter((suggestion: AddressSuggestion) =>
      isInVancouver(suggestion.lat, suggestion.lon)
    );
}

async function rateLimitedNominatimSearch(url: string): Promise<Response> {
  const elapsed = Date.now() - lastNominatimSearchAt;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastNominatimSearchAt = Date.now();
  return fetch(url);
}

async function searchNominatimSuggestions(
  query: string,
  limit = 6
): Promise<AddressSuggestion[]> {
  const params = new URLSearchParams({
    q: `${query}, Vancouver, BC`,
    format: "json",
    limit: String(limit),
    addressdetails: "1",
    countrycodes: "ca",
    viewbox: VANCOUVER_BBOX,
    bounded: "1",
    email: NOMINATIM_EMAIL,
  });

  const res = await rateLimitedNominatimSearch(`${NOMINATIM_SEARCH}?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  return (data as Array<{ display_name: string; lat: string; lon: string }>)
    .map((item) => ({
      label: formatNominatimLabel(item.display_name),
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
    }))
    .filter((suggestion) => isInVancouver(suggestion.lat, suggestion.lon));
}

function localPlaceSuggestions(query: string): AddressSuggestion[] {
  return matchLocalPlaces(query).map((label) => ({
    label,
    lat: NaN,
    lon: NaN,
  }));
}

function buildNominatimQueries(query: string): string[] {
  const base = `${query}, Vancouver, BC`;
  const queries = [base];
  const words = query.trim().split(/\s+/);

  if (words.length === 2) {
    queries.push(`${words[1]} ${words[0]}, Vancouver, BC`);
  }

  if (query.includes("&")) {
    queries.push(`${query.replace(/&/g, " and ")}, Vancouver, BC`);
  }

  return [...new Set(queries)];
}

async function searchNominatimWithVariants(query: string): Promise<AddressSuggestion[]> {
  for (const searchQuery of buildNominatimQueries(query)) {
    const bounded = dedupeSuggestions(await searchNominatimSuggestions(searchQuery));
    if (bounded.length > 0) return bounded;
  }

  const params = new URLSearchParams({
    q: `${query}, Vancouver, BC`,
    format: "json",
    limit: "6",
    addressdetails: "1",
    countrycodes: "ca",
    email: NOMINATIM_EMAIL,
  });
  const res = await rateLimitedNominatimSearch(`${NOMINATIM_SEARCH}?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  return dedupeSuggestions(
    (data as Array<{ display_name: string; lat: string; lon: string }>)
      .map((item) => ({
        label: formatNominatimLabel(item.display_name),
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
      }))
      .filter((suggestion) => isInVancouver(suggestion.lat, suggestion.lon))
  );
}

function mergeSuggestions(
  local: AddressSuggestion[],
  remote: AddressSuggestion[]
): AddressSuggestion[] {
  return dedupeSuggestions([...local, ...remote]).slice(0, 6);
}

export async function searchAddressSuggestions(
  query: string
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const local = localPlaceSuggestions(trimmed);

  let remote: AddressSuggestion[] = [];
  try {
    const photon = dedupeSuggestions(await searchPhotonSuggestions(trimmed));
    if (photon.length > 0) remote = photon;
  } catch {
    // Photon unavailable — fall through to Nominatim
  }

  if (remote.length === 0) {
    try {
      remote = await searchNominatimWithVariants(trimmed);
    } catch {
      remote = [];
    }
  }

  return mergeSuggestions(local, remote);
}

export async function geocodeAddress(query: string): Promise<Coordinates & { label: string }> {
  const suggestions = await searchAddressSuggestions(query);
  if (suggestions[0]) {
    return suggestions[0];
  }

  throw new Error("No results found in Vancouver. Try an intersection or street address.");
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
      `&select=service_status,mobile_payment_number,rate_9am_6pm,rate_6pm_10pm,geo_point_2d`;

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
