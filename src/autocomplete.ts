import { searchAddressSuggestions } from "./api";
import { matchLocalPlaces } from "./vancouver-places";
import type { AddressSuggestion } from "./types";

const DEBOUNCE_MS = 350;

export function initAddressAutocomplete(
  input: HTMLInputElement,
  list: HTMLUListElement
): {
  getSelected: () => AddressSuggestion | null;
  clearSelected: () => void;
  close: () => void;
} {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let activeIndex = -1;
  let suggestions: AddressSuggestion[] = [];
  let selected: AddressSuggestion | null = null;
  let requestId = 0;

  function close() {
    list.classList.add("hidden");
    list.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
    suggestions = [];
  }

  function select(suggestion: AddressSuggestion) {
    selected = suggestion;
    input.value = suggestion.label;
    close();
  }

  function render() {
    list.replaceChildren();
    if (suggestions.length === 0) {
      close();
      return;
    }

    for (let i = 0; i < suggestions.length; i++) {
      const item = document.createElement("li");
      item.className = "autocomplete__item";
      item.role = "option";
      item.id = `autocomplete-option-${i}`;
      item.textContent = suggestions[i].label;
      if (i === activeIndex) {
        item.classList.add("autocomplete__item--active");
        item.setAttribute("aria-selected", "true");
      }
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        select(suggestions[i]);
      });
      list.appendChild(item);
    }

    list.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  }

  function showLoading() {
    list.replaceChildren();
    const item = document.createElement("li");
    item.className = "autocomplete__item autocomplete__item--loading";
    item.textContent = "Searching…";
    list.appendChild(item);
    list.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  }

  async function fetchSuggestions(query: string) {
    const id = ++requestId;

    try {
      const results = await searchAddressSuggestions(query);
      if (id !== requestId) return;

      suggestions = results;
      activeIndex = results.length > 0 ? 0 : -1;
      render();
    } catch {
      if (id !== requestId) return;
      close();
    }
  }

  function showLocalSuggestions(query: string) {
    const local = matchLocalPlaces(query).map((label) => ({
      label,
      lat: NaN,
      lon: NaN,
    }));

    if (local.length === 0) {
      showLoading();
      return;
    }

    suggestions = local;
    activeIndex = 0;
    render();
  }

  function scheduleFetch() {
    clearTimeout(debounceTimer);
    const query = input.value.trim();

    if (query.length < 2) {
      close();
      return;
    }

    if (selected && query !== selected.label) {
      selected = null;
    }

    showLocalSuggestions(query);
    debounceTimer = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
  }

  function moveActive(delta: number) {
    if (suggestions.length === 0) return;
    activeIndex = (activeIndex + delta + suggestions.length) % suggestions.length;
    render();
    const active = list.querySelector<HTMLElement>(".autocomplete__item--active");
    active?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", scheduleFetch);

  input.addEventListener("keydown", (e) => {
    if (list.classList.contains("hidden")) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      select(suggestions[activeIndex]);
      input.form?.requestSubmit();
    } else if (e.key === "Escape") {
      close();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(close, 150);
  });

  return {
    getSelected: () => selected,
    clearSelected: () => {
      selected = null;
    },
    close,
  };
}
