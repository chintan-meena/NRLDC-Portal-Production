import { useCallback, useEffect, useState } from 'react';

/**
 * useTheme — light, dark, or whatever the operating system says.
 *
 * Three states rather than two. "system" is the default and stamps nothing on
 * the document, so the CSS media query decides; an explicit choice stamps
 * data-theme on <html>, which is what lets someone pick light on a dark laptop
 * and have it stick.
 *
 * The choice is per browser, not per account: it belongs to where you are
 * sitting — a control room screen at night, a laptop in daylight — rather than
 * to who you are. That also means it needs no server round trip and works on
 * the sign-in screen, before anyone is signed in.
 */

const STORAGE_KEY = 'nrldc_theme';
const MODES = ['system', 'light', 'dark'];

/** Storage can throw in a private window; the theme is not worth failing over. */
function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Apply to <html>. "system" removes the attribute so the media query wins. */
function apply(mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

export function useTheme() {
  const [mode, setMode] = useState(readStored);

  useEffect(() => {
    apply(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch { /* the theme still applies for this session */ }
  }, [mode]);

  /** What is actually on screen right now, which "system" alone does not say. */
  const resolved = mode === 'system'
    ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;

  const cycle = useCallback(() => {
    setMode(current => MODES[(MODES.indexOf(current) + 1) % MODES.length]);
  }, []);

  return { mode, resolved, setMode, cycle, MODES };
}

/**
 * Apply the stored theme before React renders.
 *
 * Called from main.jsx. Without it the page paints in light and then corrects
 * itself once React mounts — a white flash on every load, which is exactly what
 * someone choosing a dark theme is trying to avoid.
 */
export function applyStoredThemeEarly() {
  apply(readStored());
}
