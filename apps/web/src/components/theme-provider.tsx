import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

export const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
});

export const THEME_SCRIPT = `
(function(){
  try {
    var root = document.documentElement;
    root.classList.remove('theme-ember','theme-arcane');
    root.classList.add('dark');
  } catch(e) {}
})();
`.trim();

function applyDarkTheme() {
  const root = document.documentElement;
  root.classList.remove("theme-ember", "theme-arcane");
  root.classList.add("dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    applyDarkTheme();
  }, []);

  function setTheme(newTheme: Theme) {
    setThemeState(newTheme);
    applyDarkTheme();
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
