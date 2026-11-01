export type Theme = 'light' | 'dark';

export const THEME_KEY = 'inkling.theme';

/** The saved choice, or null when the visitor has never picked one (then the OS setting rules). */
export function savedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme(): Theme {
  return savedTheme() ?? systemTheme();
}

/** Marks the page with the theme so tokens.css switches palette. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage can be blocked (private mode); the choice then lasts until the page closes.
  }
}

/** Run once at startup, before the first paint, so a saved choice never flashes the wrong palette. */
export function initTheme() {
  const saved = savedTheme();
  if (saved) applyTheme(saved);
}
