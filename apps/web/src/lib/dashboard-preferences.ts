import { useCallback, useSyncExternalStore } from "react";

const PREFERENCES_KEY = "wow_dashboard_preferences_v1";
const PREFERENCES_EVENT = "wow-dashboard:preferences";

const LEGACY_HIDE_BELOW_90_KEY = "wow_dashboard_hide_below_90";
const LEGACY_MIN_ILVL_KEY = "wow_dashboard_min_ilvl";
const LEGACY_HIDE_NO_SNAPSHOT_KEY = "wow_dashboard_hide_no_snapshot";

export type DashboardPreferences = {
  hideBelow90: boolean;
  minItemLevel: number;
  hideNoSnapshot: boolean;
};

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = Object.freeze({
  hideBelow90: false,
  minItemLevel: 200,
  hideNoSnapshot: false,
});

let cachedRawValue: string | null | undefined;
let cachedPreferences = DEFAULT_DASHBOARD_PREFERENCES;

function normalizeItemLevel(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DASHBOARD_PREFERENCES.minItemLevel;
  return Math.min(1000, Math.max(0, Math.round(parsed * 10) / 10));
}

export function normalizeDashboardPreferences(value: unknown): DashboardPreferences {
  if (!value || typeof value !== "object") return DEFAULT_DASHBOARD_PREFERENCES;

  const candidate = value as Partial<DashboardPreferences>;
  return {
    hideBelow90:
      typeof candidate.hideBelow90 === "boolean"
        ? candidate.hideBelow90
        : DEFAULT_DASHBOARD_PREFERENCES.hideBelow90,
    minItemLevel: normalizeItemLevel(candidate.minItemLevel),
    hideNoSnapshot:
      typeof candidate.hideNoSnapshot === "boolean"
        ? candidate.hideNoSnapshot
        : DEFAULT_DASHBOARD_PREFERENCES.hideNoSnapshot,
  };
}

function readLegacyPreferences(): DashboardPreferences {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_PREFERENCES;

  return normalizeDashboardPreferences({
    hideBelow90: window.localStorage.getItem(LEGACY_HIDE_BELOW_90_KEY) === "true",
    minItemLevel:
      window.localStorage.getItem(LEGACY_MIN_ILVL_KEY) ??
      DEFAULT_DASHBOARD_PREFERENCES.minItemLevel,
    hideNoSnapshot: window.localStorage.getItem(LEGACY_HIDE_NO_SNAPSHOT_KEY) === "true",
  });
}

function readDashboardPreferences(): DashboardPreferences {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_PREFERENCES;

  try {
    const rawValue = window.localStorage.getItem(PREFERENCES_KEY);
    if (rawValue === cachedRawValue) return cachedPreferences;

    cachedRawValue = rawValue;
    cachedPreferences = rawValue
      ? normalizeDashboardPreferences(JSON.parse(rawValue) as unknown)
      : readLegacyPreferences();
    return cachedPreferences;
  } catch {
    cachedRawValue = undefined;
    cachedPreferences = DEFAULT_DASHBOARD_PREFERENCES;
    return cachedPreferences;
  }
}

function writeDashboardPreferences(preferences: DashboardPreferences) {
  if (typeof window === "undefined") return;

  const normalizedPreferences = normalizeDashboardPreferences(preferences);
  const rawValue = JSON.stringify(normalizedPreferences);

  try {
    window.localStorage.setItem(PREFERENCES_KEY, rawValue);
    window.localStorage.removeItem(LEGACY_HIDE_BELOW_90_KEY);
    window.localStorage.removeItem(LEGACY_MIN_ILVL_KEY);
    window.localStorage.removeItem(LEGACY_HIDE_NO_SNAPSHOT_KEY);
  } catch {
    return;
  }

  cachedRawValue = rawValue;
  cachedPreferences = normalizedPreferences;
  window.dispatchEvent(new Event(PREFERENCES_EVENT));
}

function subscribeToDashboardPreferences(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PREFERENCES_KEY) return;
    cachedRawValue = undefined;
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(PREFERENCES_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(PREFERENCES_EVENT, onStoreChange);
  };
}

export function useDashboardPreferences() {
  const preferences = useSyncExternalStore(
    subscribeToDashboardPreferences,
    readDashboardPreferences,
    () => DEFAULT_DASHBOARD_PREFERENCES,
  );

  const updatePreferences = useCallback((patch: Partial<DashboardPreferences>) => {
    writeDashboardPreferences({ ...readDashboardPreferences(), ...patch });
  }, []);

  return { preferences, updatePreferences };
}
