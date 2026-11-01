import { useState } from 'react';
import { applyTheme, currentTheme, saveTheme, type Theme } from './theme';

/** The active palette and a function that flips it, remembering the choice. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  };
  return { theme, toggle };
}
