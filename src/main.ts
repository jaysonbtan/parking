import { initAddressAutocomplete } from "./autocomplete";
import { fetchParkingNear, resolveSearchQuery } from "./api";
import { getCachedStreet, reverseGeocodeStreet } from "./nominatim";
import type { Coordinates, ParkingMeterWithDistance } from "./types";
import {
  averageRates,
  enrichMeters,
  formatDistance,
  formatLocationLabel,
  formatRateAmount,
  LocationCancelledError,
  startAccuratePosition,
  parseRate,
  rateSummary,
  sortMeters,
  type RateView,
  type SortMode,
} from "./utils";

const searchSection = document.getElementById("search-section")!;
const resultsSection = document.getElementById("results-section")!;
const searchForm = document.getElementById("search-form") as HTMLFormElement;
const addressInput = document.getElementById("address-input") as HTMLInputElement;
const autocompleteList = document.getElementById("autocomplete-list") as HTMLUListElement;
const addressAutocomplete = initAddressAutocomplete(addressInput, autocompleteList);
const searchBtn = document.getElementById("search-btn") as HTMLButtonElement;
const locationBtn = document.getElementById("location-btn") as HTMLButtonElement;
const backBtn = document.getElementById("back-btn") as HTMLButtonElement;
const locationLabel = document.getElementById("location-label")!;
const resultsCount = document.getElementById("results-count")!;
const loadingEl = document.getElementById("loading")!;
const loadingText = loadingEl.querySelector(".loading__text")!;
const locationCancelBtn = document.getElementById("location-cancel-btn") as HTMLButtonElement;

let cancelLocation: (() => void) | null = null;
const errorEl = document.getElementById("error")!;
const tableWrap = document.getElementById("results-table-wrap")!;
const resultsBody = document.getElementById("results-body")!;
const sortSelect = document.getElementById("sort-select") as HTMLSelectElement;
const rateSelect = document.getElementById("rate-select") as HTMLSelectElement;
const rateHeader = document.getElementById("rate-header")!;
const rateTabsEl = document.querySelector(".rate-tabs")!;
const rateTabs = document.querySelectorAll<HTMLButtonElement>(".rate-tabs__btn");
const toastEl = document.getElementById("toast")!;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

let cachedSpots: ParkingMeterWithDistance[] = [];
let cachedLocationText = "";
let rateView: RateView = "day";

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
    hide(locationCancelBtn);
    loadingText.textContent = "Finding parking spots…";
  }
}

function setLocationLoading(active: boolean) {
  if (active) {
    loadingText.textContent = "Pinpointing your location";
    show(locationCancelBtn);
  } else {
    hide(locationCancelBtn);
    loadingText.textContent = "Finding parking spots…";
  }
  setLoading(active);
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

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const MAP_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;


function mapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

const LOADING_STREET_LABEL = "Loading Street...";

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

function rateClass(rate: string, average: number): string {
  return parseRate(rate) < average ? " results-table__rate--below-avg" : "";
}

function rateHeaderLabel(view: RateView): string {
  if (view === "day") return "Day Rate";
  if (view === "evening") return "Evening Rate";
  return "Rate";
}

function renderRateCell(
  spot: ParkingMeterWithDistance,
  avgDay: number,
  avgNight: number,
  view: RateView
): string {
  if (view === "day") {
    return `<span class="results-table__rate-day${rateClass(spot.rate_9am_6pm, avgDay)}">${spot.rate_9am_6pm}</span>`;
  }
  if (view === "evening") {
    return `<span class="results-table__rate-day${rateClass(spot.rate_6pm_10pm, avgNight)}">${spot.rate_6pm_10pm}</span>`;
  }
  return `
    <span class="results-table__rate-day${rateClass(spot.rate_9am_6pm, avgDay)}">${spot.rate_9am_6pm}</span>
    <span class="results-table__sub results-table__rate-night${rateClass(spot.rate_6pm_10pm, avgNight)}">${spot.rate_6pm_10pm}</span>
  `;
}

function syncRateViewUI() {
  rateSelect.value = rateView;
  rateTabsEl.classList.toggle("rate-tabs--evening", rateView === "evening");
  rateTabs.forEach((tab) => {
    const isDayOrEvening = tab.dataset.rate === rateView;
    tab.classList.toggle("rate-tabs__btn--active", isDayOrEvening);
    tab.setAttribute("aria-selected", String(isDayOrEvening));
  });
}

syncRateViewUI();

function setRateView(view: RateView) {
  rateView = view;
  syncRateViewUI();
  if (cachedSpots.length > 0) refreshResults();
}

function formatResultsSummary(spots: ParkingMeterWithDistance[], view: RateView): string {
  const countLabel = `${spots.length} spot${spots.length === 1 ? "" : "s"}`;
  const summary = rateSummary(spots, view);

  if (!summary) return countLabel;

  return `${countLabel}: ${formatRateAmount(summary.min)} to ${formatRateAmount(summary.max)} (Avg: ${formatRateAmount(summary.avg)})`;
}

function renderTable(spots: ParkingMeterWithDistance[], locationText: string) {
  resultsBody.replaceChildren();
  const { day: avgDay, night: avgNight } = averageRates(spots);
  rateHeader.textContent = rateHeaderLabel(rateView);

  for (const spot of spots) {
    const { lat, lon } = spot.geo_point_2d;
    const key = coordKey(lat, lon);
    const cachedStreet = getCachedStreet({ lat, lon });
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="results-table__pay">
        <button
          type="button"
          class="copy-group"
          aria-label="Copy PayByPhone ID ${spot.mobile_payment_number}"
          data-code="${spot.mobile_payment_number}"
        >
          <span class="copy-group__code">${spot.mobile_payment_number}</span>
          <span class="copy-group__icon">${COPY_ICON}</span>
        </button>
        <span
          class="results-table__sub street-label${cachedStreet ? "" : " street-label--loading"}"
          data-coord-key="${key}"
          ${cachedStreet ? `title="${cachedStreet}"` : ""}
        >${cachedStreet ?? LOADING_STREET_LABEL}</span>
      </td>
      <td class="results-table__rates">
        ${renderRateCell(spot, avgDay, avgNight, rateView)}
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
      </td>
    `;
    resultsBody.appendChild(row);
  }

  locationLabel.textContent = `Near ${locationText}`;
  resultsCount.textContent = formatResultsSummary(spots, rateView);
  show(tableWrap);
  loadAllStreets(spots);
}

function refreshResults() {
  const mode = sortSelect.value as SortMode;
  const sorted = sortMeters(cachedSpots, mode);
  renderTable(sorted, cachedLocationText);
}

function showToast(message: string) {
  toastEl.textContent = message;
  show(toastEl);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(toastEl), 2000);
}

async function copyPayByPhone(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    showToast("PayByPhone ID Copied");
  } catch {
    showToast("Copy failed");
  }
}

resultsBody.addEventListener("click", (e) => {
  const copyGroup = (e.target as HTMLElement).closest<HTMLButtonElement>(".copy-group");
  if (!copyGroup) return;
  const code = copyGroup.dataset.code;
  if (code) void copyPayByPhone(code);
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
  addressAutocomplete.close();

  const query = addressInput.value.trim();
  if (!query) {
    addressInput.focus();
    return;
  }

  setLoading(true);
  showResultsView();

  try {
    const picked = addressAutocomplete.getSelected();
    const hasCoords =
      picked &&
      picked.label === query &&
      Number.isFinite(picked.lat) &&
      Number.isFinite(picked.lon);
    const { lat, lon, label } = hasCoords
      ? { lat: picked.lat, lon: picked.lon, label: picked.label }
      : await resolveSearchQuery(picked?.label === query ? picked.label : query);
    setLoading(false);
    await loadParking({ lat, lon }, label);
  } catch (err) {
    setLoading(false);
    showError(err instanceof Error ? err.message : "Could not find that location.");
  }
});

locationBtn.addEventListener("click", async () => {
  if (!navigator.geolocation) {
    showResultsView();
    showError("Your browser does not support location sharing.");
    return;
  }

  showResultsView();
  setLocationLoading(true);

  const { promise, cancel } = startAccuratePosition();
  cancelLocation = cancel;

  try {
    const { lat, lon, accuracyMeters } = await promise;
    cancelLocation = null;
    setLocationLoading(false);
    setLoading(true);
    await loadParking({ lat, lon }, formatLocationLabel(accuracyMeters));
  } catch (err) {
    cancelLocation = null;
    setLocationLoading(false);

    if (err instanceof LocationCancelledError) {
      showSearchView();
      return;
    }

    showResultsView();
    const code = (err as GeolocationPositionError).code;
    const messages: Record<number, string> = {
      1: "Location permission denied. Allow location access or enter an address instead.",
      2: "Could not determine your location. Try again or enter an address.",
      3: "Location request timed out. Try again or enter an address.",
    };
    showError(messages[code] ?? "Could not get your location.");
  }
});

locationCancelBtn.addEventListener("click", () => {
  cancelLocation?.();
  cancelLocation = null;
});

backBtn.addEventListener("click", () => {
  showSearchView();
  addressInput.focus();
});

sortSelect.addEventListener("change", () => {
  if (cachedSpots.length > 0) refreshResults();
});

rateSelect.addEventListener("change", () => {
  setRateView(rateSelect.value as RateView);
});

rateTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const view = tab.dataset.rate as RateView;
    if (view === "day" || view === "evening") setRateView(view);
  });
});
