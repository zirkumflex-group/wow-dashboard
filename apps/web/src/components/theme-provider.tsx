import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "auto" | "ember" | "arcane";

export const THEMES: { id: Theme; label: string; description: string }[] = [
  { id: "auto", label: "Auto", description: "Follows your system preference" },
  { id: "light", label: "Light", description: "Clean light interface" },
  { id: "dark", label: "Dark", description: "Default dark interface" },
  { id: "ember", label: "Ember", description: "Warm amber forge aesthetic" },
  { id: "arcane", label: "Arcane", description: "Cool cyan frost magic" },
];

const THEME_KEY = "wow_dashboard_theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

export const ThemeContext = createContext<ThemeContextValue>({
  theme: "auto",
  setTheme: () => {},
});

/** Inline script for <head> — prevents flash by applying class before first paint */
export const THEME_SCRIPT = `
(function(){
  try {
    var t = localStorage.getItem('${THEME_KEY}') || 'auto';
    var r = document.documentElement;
    r.classList.remove('dark','theme-ember','theme-arcane');
    if (t === 'dark') { r.classList.add('dark'); }
    else if (t === 'ember') { r.classList.add('dark','theme-ember'); }
    else if (t === 'arcane') { r.classList.add('dark','theme-arcane'); }
    else if (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches) { r.classList.add('dark'); }
  } catch(e) {}
})();
`.trim();

function applyThemeClasses(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("dark", "theme-ember", "theme-arcane");
  if (theme === "dark") root.classList.add("dark");
  else if (theme === "ember") root.classList.add("dark", "theme-ember");
  else if (theme === "arcane") root.classList.add("dark", "theme-arcane");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("auto");

  // Hydrate from localStorage once on client
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY) as Theme | null;
      if (stored && ["light", "dark", "auto", "ember", "arcane"].includes(stored)) {
        setThemeState(stored);
      }
    } catch {}
  }, []);

  // Apply classes whenever theme changes
  useEffect(() => {
    if (theme === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = () => {
        document.documentElement.classList.remove("dark", "theme-ember", "theme-arcane");
        if (mq.matches) document.documentElement.classList.add("dark");
      };
      apply();
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    applyThemeClasses(theme);
  }, [theme]);

  function setTheme(newTheme: Theme) {
    setThemeState(newTheme);
    try {
      localStorage.setItem(THEME_KEY, newTheme);
    } catch {}
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
