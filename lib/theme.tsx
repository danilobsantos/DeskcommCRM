"use client";

import * as React from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "deskcomm-theme";

type ThemeContextValue = {
  /** User preference: light, dark, or system. */
  theme: Theme;
  /** Effective theme applied to the DOM (system collapsed to light/dark). */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // localStorage indisponível (modo privado, sandbox) — segue com default.
  }
  return "system";
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initializa com "system" em server E client (sem ler localStorage no
  // useState). Isso garante hydration idêntico. O inline script no layout
  // já setou data-theme no DOM antes do paint, então não há flash visual.
  // O useEffect abaixo sincroniza o state com o storage depois da hidratação.
  const [theme, setThemeState] = React.useState<Theme>("system");
  // Valor CONSTANTE no estado inicial, e não getSystemTheme(): este
  // inicializador roda no SSR E na hidratação, e getSystemTheme() lê
  // window.matchMedia — "light" no servidor, o tema real no cliente. Um
  // valor diferente nos dois lados quebra a hidratação (ex.: a Sidebar
  // desenha o logo claro no SSR e o escuro no cliente). O useEffect abaixo
  // sincroniza o valor real logo depois da hidratação.
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>("light");

  // Sincroniza theme e systemTheme com o real estado do client depois da
  // hidratação. No server, getSystemTheme() retorna "light" e readStoredTheme()
  // retorna "system" — ambos os valores são seguros como default porque o
  // inline script no layout já aplicou o data-theme correto no DOM antes do paint.
  React.useEffect(() => {
    const stored = readStoredTheme();
    if (stored !== theme) setThemeState(stored);
    const real = getSystemTheme();
    if (real !== systemTheme) setSystemTheme(real);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listener pra mudanças do prefers-color-scheme.
  React.useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;

  // Aplica no DOM sempre que o tema efetivo muda.
  React.useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistência opcional — falha silenciosamente.
    }
  }, []);

  const toggle = React.useCallback(() => {
    setThemeState((current) => {
      const currentResolved =
        current === "system" ? getSystemTheme() : current;
      const next: Theme = currentResolved === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggle }),
    [theme, resolvedTheme, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return ctx;
}
