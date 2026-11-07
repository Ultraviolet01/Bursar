"use client";
// System / Light / Dark. The choice lives in localStorage; the inline script in the
// root layout applies it before first paint so there is no flash.
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const KEY = "bursar-theme";

export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="dark"||t==="light")document.documentElement.classList.add(t)}catch(e){}`;

function apply(t: Theme) {
  const el = document.documentElement;
  el.classList.remove("light", "dark");
  if (t !== "system") el.classList.add(t);
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {}
}

const ICONS: Record<Theme, React.ReactNode> = {
  system: <path d="M4 5.5h16v10H4zM9 19.5h6M12 15.5v4" />,
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  dark: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
};

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem(KEY);
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);
  return (
    <div role="radiogroup" aria-label="Colour theme" className={`inline-flex rounded-lg border border-line bg-surface p-0.5 ${className}`}>
      {(["system", "light", "dark"] as Theme[]).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          title={`${t[0].toUpperCase()}${t.slice(1)} theme`}
          onClick={() => {
            setTheme(t);
            apply(t);
          }}
          className={`flex h-7 w-8 items-center justify-center rounded-md transition-colors ${theme === t ? "bg-teal-soft text-teal" : "text-muted hover:text-ink"}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {ICONS[t]}
          </svg>
          <span className="sr-only">{t[0].toUpperCase() + t.slice(1)}</span>
        </button>
      ))}
    </div>
  );
}
