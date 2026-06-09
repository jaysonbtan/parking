import type { ParkingMeter, ParkingMeterWithDistance, Coordinates } from "./types";

const EARTH_RADIUS_M = 6_371_000;

export function parseRate(rate: string | null | undefined): number {
  if (!rate) return Infinity;
  const match = rate.replace(/,/g, "").match(/[\d.]+/);
  return match ? parseFloat(match[0]) : Infinity;
}

export function haversineDistance(
  a: Coordinates,
  b: Coordinates
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function vancouverHour(): number {
  return parseInt(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
    10
  );
}

export function currentSortRate(meter: ParkingMeter): number {
  const hour = vancouverHour();
  if (hour >= 9 && hour < 18) return parseRate(meter.rate_9am_6pm);
  if (hour >= 18 && hour < 22) return parseRate(meter.rate_6pm_10pm);
  return 0;
}

export type SortMode = "cheapest" | "closest";
export type RateView = "day" | "evening" | "all";

export function enrichMeters(
  meters: ParkingMeter[],
  origin: Coordinates
): ParkingMeterWithDistance[] {
  return meters.map((meter) => ({
    ...meter,
    distanceMeters: haversineDistance(origin, meter.geo_point_2d),
    sortRate: currentSortRate(meter),
  }));
}

export function sortMeters(
  meters: ParkingMeterWithDistance[],
  mode: SortMode
): ParkingMeterWithDistance[] {
  const sorted = [...meters];
  if (mode === "closest") {
    sorted.sort((a, b) => {
      if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
      return a.sortRate - b.sortRate;
    });
  } else {
    sorted.sort((a, b) => {
      if (a.sortRate !== b.sortRate) return a.sortRate - b.sortRate;
      return a.distanceMeters - b.distanceMeters;
    });
  }
  return sorted;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export interface AccuratePosition extends Coordinates {
  accuracyMeters: number;
}

const TARGET_ACCURACY_M = 35;
const MAX_LOCATION_WAIT_MS = 25_000;

function toAccuratePosition(pos: GeolocationPosition): AccuratePosition {
  return {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracyMeters: pos.coords.accuracy,
  };
}

export function formatLocationLabel(accuracyMeters: number): string {
  if (accuracyMeters <= 20) return "your current location";
  return `your current location (±${Math.round(accuracyMeters)} m)`;
}

export function getAccuratePosition(
  onProgress?: (accuracyMeters: number) => void
): Promise<AccuratePosition> {
  return new Promise((resolve, reject) => {
    let best: GeolocationPosition | null = null;
    let settled = false;
    let watchId = 0;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      finish(() => {
        if (best) resolve(toAccuratePosition(best));
        else reject(Object.assign(new Error("Location request timed out"), { code: 3 }));
      });
    }, MAX_LOCATION_WAIT_MS);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) {
          best = pos;
        }
        onProgress?.(pos.coords.accuracy);

        if (pos.coords.accuracy <= TARGET_ACCURACY_M) {
          finish(() => resolve(toAccuratePosition(pos)));
        }
      },
      (err) => {
        finish(() => {
          if (best) resolve(toAccuratePosition(best));
          else reject(err);
        });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: MAX_LOCATION_WAIT_MS }
    );
  });
}

function finiteRates(rates: number[]): number[] {
  return rates.filter((r) => Number.isFinite(r));
}

export function averageRates(spots: ParkingMeter[]): { day: number; night: number } {
  const dayRates = finiteRates(spots.map((s) => parseRate(s.rate_9am_6pm)));
  const nightRates = finiteRates(spots.map((s) => parseRate(s.rate_6pm_10pm)));

  return {
    day: dayRates.length ? dayRates.reduce((sum, r) => sum + r, 0) / dayRates.length : 0,
    night: nightRates.length ? nightRates.reduce((sum, r) => sum + r, 0) / nightRates.length : 0,
  };
}
