import { fetchParkingNear, geocodeAddress } from "./api";
import { getCachedStreet, reverseGeocodeStreet } from "./nominatim";
import type { Coordinates, ParkingMeterWithDistance } from "./types";
import { enrichMeters, formatDistance, sortMeters, type SortMode } from "./utils";

const searchSection = document.getElementById("search-section")!;
const resultsSection = document.getElementById("results-section")!;
const searchForm = document.getElementById("search-form") as HTMLFormElement;
const addressInput = document.getElementById("address-input") as HTMLInputElement;
const searchBtn = document.getElementById("search-btn") as HTMLButtonElement;
const locationBtn = document.getElementById("location-btn") as HTMLButtonElement;
const backBtn = document.getElementById("back-btn") as HTMLButtonElement;
const locationLabel = document.getElementById("location-label")!;
const resultsCount = document.getElementById("results-count")!;
const loadingEl = document.getElementById("loading")!;
const errorEl = document.getElementById("error")!;
const tableWrap = document.getElementById("results-table-wrap")!;
const resultsBody = document.getElementById("results-body")!;
const sortSelect = document.getElementById("sort-select") as HTMLSelectElement;

let cachedSpots: ParkingMeterWithDistance[] = [];
let cachedLocationText = "";

function show(el: HTMLElement) {
  el.classList.remove("hidden");
}

function hide(el: HTMLElement) {
  el.classList.add("hidden");
}

function setLoading(active: boolean) {
  searchBtn.disabled = active;
  locationBtn.disabled = active;
  if (active) {
    show(loadingEl);
    hide(errorEl);
    hide(tableWrap);
  } else {
    hide(loadingEl);
  }
}

function showError(message: string) {
  errorEl.textContent = message;
  show(errorEl);
  hide(tableWrap);
}

function showResultsView() {
  hide(searchSection);
  show(resultsSection);
}

function showSearchView() {
  show(searchSection);
  hide(resultsSection);
  hide(errorEl);
  hide(tableWrap);
  hide(loadingEl);
}

const COPY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const MAP_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;


function mapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

function sortLabel(mode: SortMode): string {
  return mode === "closest" ? "distance" : "current rate";
}

function coordKey(lat: number, lon: number): string {
  return `${lat},${lon}`;
}

function applyStreetLabel(key: string, street: string) {
  resultsBody.querySelectorAll<HTMLElement>(`.street-label[data-coord-key="${key}"]`).forEach((el) => {
    el.textContent = street;
    el.title = street;
    el.classList.remove("street-label--loading");
  });
}

async function loadAllStreets(spots: ParkingMeterWithDistance[]) {
  const keyOrder: string[] = [];
  const unique = new Map<string, Coordinates>();

  for (const spot of spots) {
    const { lat, lon } = spot.geo_point_2d;
    const key = coordKey(lat, lon);
    if (!unique.has(key)) {
      unique.set(key, { lat, lon });
      keyOrder.push(key);
    }
  }

  for (const key of keyOrder) {
    const coords = unique.get(key)!;
    const cached = getCachedStreet(coords);
    if (cached) {
      applyStreetLabel(key, cached);
      continue;
    }
    const street = await reverseGeocodeStreet(coords);
    applyStreetLabel(key, street);
  }
}

function renderTable(spots: ParkingMeterWithDistance[], locationText: string, mode: SortMode) {
  resultsBody.replaceChildren();

  for (const spot of spots) {
    const { lat, lon } = spot.geo_point_2d;
    const key = coordKey(lat, lon);
    const cachedStreet = getCachedStreet({ lat, lon });
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="results-table__pay">
        <div class="results-table__pay-row">
          <span class="results-table__code">${spot.mobile_payment_number}</span>
          <button
            type="button"
            class="icon-btn copy-btn"
            aria-label="Copy PayByPhone code ${spot.mobile_payment_number}"
            data-code="${spot.mobile_payment_number}"
          >${COPY_ICON}</button>
        </div>
        <span
          class="results-table__sub street-label${cachedStreet ? "" : " street-label--loading"}"
          data-coord-key="${key}"
          ${cachedStreet ? `title="${cachedStreet}"` : ""}
        >${cachedStreet ?? "…"}</span>
      </td>
      <td class="results-table__rates">
        <span class="results-table__rate-day">${spot.rate_9am_6pm}</span>
        <span class="results-table__sub">${spot.rate_6pm_10pm}</span>
      </td>
      <td class="results-table__actions">
        <div class="results-table__actions-row">
          <span class="results-table__dist">${formatDistance(spot.distanceMeters)}</span>
          <a
            href="${mapsUrl(lat, lon)}"
            class="icon-btn map-btn"
            aria-label="Open in maps"
            target="_blank"
            rel="noopener noreferrer"
          >${MAP_ICON}</a>
        </div>
        <span class="results-table__sub results-table__row-spacer" aria-hidden="true">&nbsp;</span>
      </td>
    `;
    resultsBody.appendChild(row);
  }

  locationLabel.textContent = `Near ${locationText}`;
  resultsCount.textContent = `${spots.length} spot${spots.length === 1 ? "" : "s"} within 1 km · sorted by ${sortLabel(mode)}`;
  show(tableWrap);
  loadAllStreets(spots);
}

function refreshResults() {
  const mode = sortSelect.value as SortMode;
  const sorted = sortMeters(cachedSpots, mode);
  renderTable(sorted, cachedLocationText, mode);
}

async function copyToClipboard(code: string, btn: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(code);
    btn.classList.add("icon-btn--success");
    btn.setAttribute("aria-label", "Copied!");
    setTimeout(() => {
      btn.classList.remove("icon-btn--success");
      btn.setAttribute("aria-label", `Copy PayByPhone code ${code}`);
    }, 1500);
  } catch {
    btn.setAttribute("aria-label", "Copy failed");
  }
}

resultsBody.addEventListener("click", (e) => {
  const copyBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".copy-btn");
  if (!copyBtn) return;
  const code = copyBtn.dataset.code;
  if (code) copyToClipboard(code, copyBtn);
});

async function loadParking(
  coords: Coordinates,
  locationText: string
) {
  setLoading(true);
  showResultsView();

  try {
    const meters = await fetchParkingNear(coords);
    cachedSpots = enrichMeters(meters, coords);
    cachedLocationText = locationText;

    if (cachedSpots.length === 0) {
      showError("No in-service parking meters found within 1 km of this location.");
      return;
    }

    refreshResults();
  } catch (err) {
    showError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
  } finally {
    setLoading(false);
  }
}

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = addressInput.value.trim();
  if (!query) {
    addressInput.focus();
    return;
  }

  setLoading(true);
  showResultsView();

  try {
    const { lat, lon, label } = await geocodeAddress(query);
    setLoading(false);
    await loadParking({ lat, lon }, label);
  } catch (err) {
    setLoading(false);
    showError(err instanceof Error ? err.message : "Could not find that location.");
  }
});

locationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showResultsView();
    showError("Your browser does not support location sharing.");
    return;
  }

  setLoading(true);
  showResultsView();

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const coords = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      };
      setLoading(false);
      await loadParking(coords, "your current location");
    },
    (err) => {
      setLoading(false);
      const messages: Record<number, string> = {
        1: "Location permission denied. Allow location access or enter an address instead.",
        2: "Could not determine your location. Try again or enter an address.",
        3: "Location request timed out. Try again or enter an address.",
      };
      showError(messages[err.code] ?? "Could not get your location.");
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
  );
});

backBtn.addEventListener("click", () => {
  showSearchView();
  addressInput.focus();
});

sortSelect.addEventListener("change", () => {
  if (cachedSpots.length > 0) refreshResults();
});
