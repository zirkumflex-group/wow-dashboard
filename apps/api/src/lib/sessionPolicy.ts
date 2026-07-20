const dayInSeconds = 24 * 60 * 60;

// Browser and desktop sessions use the same rolling lifetime. Active sessions
// refresh at most once per day and expire after six months of inactivity.
export const persistentSessionTtlSeconds = 180 * dayInSeconds;
export const persistentSessionUpdateAgeSeconds = dayInSeconds;

export const desktopSessionUserAgent = "wow-dashboard-desktop";
export const desktopSessionRefreshThresholdSeconds = 30 * dayInSeconds;
export const desktopSessionMaximumClockSkewSeconds = 5 * 60;
