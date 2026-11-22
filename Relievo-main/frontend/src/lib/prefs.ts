// Large-text accessibility preference: persisted in localStorage, applied as a class on <html>.
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const read = () => {
  try { return localStorage.getItem("rr-large-text") === "1"; } catch { return false; }
};

export function setLargeText(on: boolean) {
  try { localStorage.setItem("rr-large-text", on ? "1" : "0"); } catch { /* storage blocked: still apply for this page */ }
  document.documentElement.classList.toggle("large-text", on);
  listeners.forEach((l) => l());
}

document.documentElement.classList.toggle("large-text", read());

export function useLargeText() {
  const on = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, read);
  return [on, setLargeText] as const;
}

// Colour theme: "light" | "dark". Default = system preference; an explicit choice is remembered (index.html applies it before first paint).
export type Theme = "light" | "dark";
const themeListeners = new Set<() => void>();
const readTheme = (): Theme => {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
};
export function setTheme(t: Theme) {
  try { localStorage.setItem("rr-theme", t); } catch { /* storage blocked: the choice still applies for this page */ }
  document.documentElement.setAttribute("data-theme", t);
  themeListeners.forEach((l) => l());
}
export function useTheme() {
  const theme = useSyncExternalStore((cb) => { themeListeners.add(cb); return () => themeListeners.delete(cb); }, readTheme);
  return [theme, setTheme] as const;
}
