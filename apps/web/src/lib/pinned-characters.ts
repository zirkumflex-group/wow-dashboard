import { useCallback, useMemo, useSyncExternalStore } from "react";

const PINNED_CHARACTERS_KEY = "wow_dashboard_quick_access_pins";
const PINNED_CHARACTERS_EVENT = "wow-dashboard:pinned-characters";
const EMPTY_PINNED_CHARACTER_IDS: string[] = [];

let cachedPinnedCharacterIds: string[] = EMPTY_PINNED_CHARACTER_IDS;
let cachedPinnedCharacterIdsRaw = "";

function normalizePinnedCharacterIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const pinnedCharacterIds: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmedItem = item.trim();
    if (trimmedItem === "" || seen.has(trimmedItem)) continue;
    seen.add(trimmedItem);
    pinnedCharacterIds.push(trimmedItem);
  }

  return pinnedCharacterIds;
}

function readPinnedCharacterIds(): string[] {
  if (typeof window === "undefined") return EMPTY_PINNED_CHARACTER_IDS;

  try {
    const storedValue = window.localStorage.getItem(PINNED_CHARACTERS_KEY);
    const normalizedStoredValue = storedValue ?? "";

    if (normalizedStoredValue === cachedPinnedCharacterIdsRaw) {
      return cachedPinnedCharacterIds;
    }

    if (!storedValue) {
      cachedPinnedCharacterIdsRaw = "";
      cachedPinnedCharacterIds = EMPTY_PINNED_CHARACTER_IDS;
      return cachedPinnedCharacterIds;
    }

    cachedPinnedCharacterIdsRaw = storedValue;
    cachedPinnedCharacterIds = normalizePinnedCharacterIds(JSON.parse(storedValue) as unknown);
    return cachedPinnedCharacterIds;
  } catch {
    cachedPinnedCharacterIdsRaw = "";
    cachedPinnedCharacterIds = EMPTY_PINNED_CHARACTER_IDS;
    return cachedPinnedCharacterIds;
  }
}

function writePinnedCharacterIds(pinnedCharacterIds: string[]) {
  if (typeof window === "undefined") return;

  const normalizedPinnedCharacterIds = normalizePinnedCharacterIds(pinnedCharacterIds);
  const nextRawValue = JSON.stringify(normalizedPinnedCharacterIds);

  cachedPinnedCharacterIdsRaw = nextRawValue;
  cachedPinnedCharacterIds =
    normalizedPinnedCharacterIds.length > 0 ? normalizedPinnedCharacterIds : EMPTY_PINNED_CHARACTER_IDS;

  window.localStorage.setItem(PINNED_CHARACTERS_KEY, nextRawValue);
  window.dispatchEvent(new Event(PINNED_CHARACTERS_EVENT));
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  if (movedItem === undefined) {
    return items;
  }
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function subscribeToPinnedCharacters(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PINNED_CHARACTERS_KEY) return;
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(PINNED_CHARACTERS_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(PINNED_CHARACTERS_EVENT, onStoreChange);
  };
}

export function usePinnedCharacters() {
  const pinnedCharacterIds = useSyncExternalStore(
    subscribeToPinnedCharacters,
    readPinnedCharacterIds,
    () => [],
  );

  const pinnedCharacterIdSet = useMemo(
    () => new Set(pinnedCharacterIds),
    [pinnedCharacterIds],
  );

  const togglePinnedCharacter = useCallback((characterId: string) => {
    const currentPinnedCharacterIds = readPinnedCharacterIds();
    const nextPinnedCharacterIds = currentPinnedCharacterIds.includes(characterId)
      ? currentPinnedCharacterIds.filter((id) => id !== characterId)
      : [...currentPinnedCharacterIds, characterId];

    writePinnedCharacterIds(nextPinnedCharacterIds);
  }, []);

  const movePinnedCharacter = useCallback(
    (characterId: string, direction: "up" | "down") => {
      const currentPinnedCharacterIds = readPinnedCharacterIds();
      const currentIndex = currentPinnedCharacterIds.indexOf(characterId);
      if (currentIndex < 0) return;

      const targetIndex =
        direction === "up"
          ? Math.max(0, currentIndex - 1)
          : Math.min(currentPinnedCharacterIds.length - 1, currentIndex + 1);
      if (targetIndex === currentIndex) return;

      writePinnedCharacterIds(moveArrayItem(currentPinnedCharacterIds, currentIndex, targetIndex));
    },
    [],
  );

  return {
    pinnedCharacterIds,
    pinnedCharacterIdSet,
    togglePinnedCharacter,
    movePinnedCharacter,
  };
}
