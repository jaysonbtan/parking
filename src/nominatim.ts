import type { Coordinates } from "./types";

const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";
const PHOTON_REVERSE = "https://photon.komoot.io/reverse";
const NOMINATIM_EMAIL = "github.com/jaysonbtan/parking";

const streetCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

let lastNominatimAt = 0;

function normalizeCoords({ lat, lon }: Coordinates): Coordinates {
  return {
    lat: Math.round(lat * 10000) / 10000,
    lon: Math.round(lon * 10000) / 10000,
  };
}

function coordKey(coords: Coordinates): string {
  const { lat, lon } = normalizeCoords(coords);
  return `${lat},${lon}`;
}

function formatRoadName(road: string, number?: string): string {
  return number ? `${number} ${road}` : road;
}

function formatNominatim(data: {
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
}): string | null {
  const addr = data.address;
  if (addr) {
    const road =
      addr.road ??
      addr.pedestrian ??
      addr.footway ??
      addr.street ??
      addr.cycleway ??
      addr.path;
    if (road) return formatRoadName(road, addr.house_number);
  }

  if (data.name) return data.name;

  if (data.display_name) {
    const first = data.display_name.split(",")[0]?.trim();
    if (first && !/^\d+$/.test(first)) return first;
  }

  return null;
}

function formatPhotonProperties(
  properties: Record<string, string> | undefined
): string | null {
  if (!properties) return null;

  const road =
    properties.street ??
    properties.name ??
    properties.road ??
    properties.pedestrian;

  if (road) return formatRoadName(road, properties.housenumber);

  if (properties.osm_key === "highway" && properties.name) {
    return properties.name;
  }

  if (properties.type === "street" && properties.name) {
    return properties.name;
  }

  return null;
}

function pickStreetFromPhotonFeatures(
  features: Array<{ properties?: Record<string, string> }> | undefined
): string | null {
  if (!features?.length) return null;

  for (const feature of features) {
    const street = formatPhotonProperties(feature.properties);
    if (street) return street;
  }

  return null;
}

async function rateLimitedNominatimFetch(url: string): Promise<Response> {
  const elapsed = Date.now() - lastNominatimAt;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastNominatimAt = Date.now();
  return fetch(url);
}

async function fetchNominatimStreet(coords: Coordinates): Promise<string | null> {
  const params = new URLSearchParams({
    lat: String(coords.lat),
    lon: String(coords.lon),
    format: "json",
    addressdetails: "1",
    zoom: "18",
    email: NOMINATIM_EMAIL,
  });

  const res = await rateLimitedNominatimFetch(`${NOMINATIM_REVERSE}?${params}`);
  if (!res.ok) return null;

  const data = await res.json();
  return formatNominatim(data);
}

async function fetchPhotonStreet(coords: Coordinates): Promise<string | null> {
  const base = new URLSearchParams({
    lat: String(coords.lat),
    lon: String(coords.lon),
    limit: "8",
    radius: "0.15",
    lang: "en",
  });

  const queries = [
    `${PHOTON_REVERSE}?${base}`,
    `${PHOTON_REVERSE}?${base}&layer=street`,
    `${PHOTON_REVERSE}?${new URLSearchParams({ ...Object.fromEntries(base), osm_tag: "highway" })}`,
  ];

  for (const url of queries) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const street = pickStreetFromPhotonFeatures(data.features);
      if (street) return street;
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveStreet(coords: Coordinates): Promise<string> {
  const normalized = normalizeCoords(coords);
  const nominatim = await fetchNominatimStreet(normalized);
  if (nominatim) return nominatim;

  const photon = await fetchPhotonStreet(normalized);
  if (photon) return photon;

  return "Unknown street";
}

export async function reverseGeocodeStreet(coords: Coordinates): Promise<string> {
  const key = coordKey(coords);
  const cached = streetCache.get(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = resolveStreet(coords)
    .then((street) => {
      if (street !== "Unknown street") {
        streetCache.set(key, street);
      }
      return street;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export function getCachedStreet(coords: Coordinates): string | undefined {
  return streetCache.get(coordKey(coords));
}
