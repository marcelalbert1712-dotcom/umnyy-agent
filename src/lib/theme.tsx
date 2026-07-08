import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

export const ACCENT_COLORS = [
  { id: "indigo", label: "Индиго", hue: 250 },
  { id: "blue", label: "Синий", hue: 220 },
  { id: "green", label: "Зелёный", hue: 160 },
  { id: "purple", label: "Фиолетовый", hue: 280 },
  { id: "pink", label: "Розовый", hue: 330 },
  { id: "amber", label: "Янтарный", hue: 40 },
  { id: "red", label: "Красный", hue: 0 },
  { id: "teal", label: "Бирюзовый", hue: 190 },
] as const;

type AccentId = (typeof ACCENT_COLORS)[number]["id"];

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
  accent: AccentId;
  setAccent: (id: AccentId) => void;
} | null>(null);

function getInitialTheme(): Theme {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function getInitialAccent(): AccentId {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("accent-color");
    if (stored && ACCENT_COLORS.some((a) => a.id === stored)) return stored as AccentId;
  }
  return "indigo";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [accent, setAccent] = useState<AccentId>(getInitialAccent);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const hue = ACCENT_COLORS.find((a) => a.id === accent)!.hue;
    document.documentElement.style.setProperty("--accent-hue", String(hue));
    localStorage.setItem("accent-color", accent);
  }, [accent]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggle, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
