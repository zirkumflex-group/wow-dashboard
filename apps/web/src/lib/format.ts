/**
 * SSR and the browser must use the same locale and time zone or React will
 * discard otherwise-valid server markup during hydration.
 */
export const DISPLAY_LOCALE = "en-US";
export const DISPLAY_TIME_ZONE = "UTC";
