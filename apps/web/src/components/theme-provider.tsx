import { type ReactNode, useEffect } from "react";

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

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyDarkTheme();
  }, []);

  return <>{children}</>;
}
