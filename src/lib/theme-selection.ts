import { BUILTIN_THEMES } from "./builtin-themes"

interface ThemeSelection {
  main: string
  alt: string
}

const STORAGE_KEY = "manna-active-themes"

export function loadThemeSelection(): ThemeSelection {
  const fallback = BUILTIN_THEMES[0].id
  const selection = { main: fallback, alt: fallback }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    for (const output of ["main", "alt"] as const) {
      if (typeof saved?.[output] === "string" && saved[output].trim()) {
        selection[output] = saved[output]
      }
    }
  } catch {
    // Unavailable storage or invalid saved data uses the default theme.
  }
  return selection
}

export function saveThemeSelection(selection: ThemeSelection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  } catch {
    // Keep live theme changes usable when storage is unavailable.
  }
}
