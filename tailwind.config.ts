import type { Config } from "tailwindcss";

// Tokens taken from the reference screens: soft grey-green canvas, deep teal
// accent, amber for "needs you", navy for the status card and dark sections.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        strong: "rgb(var(--strong) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        body: "rgb(var(--body) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        chip: "rgb(var(--chip) / <alpha-value>)",
        "on-teal": "rgb(var(--on-teal) / <alpha-value>)",
        navy: { DEFAULT: "rgb(var(--navy) / <alpha-value>)", 2: "rgb(var(--navy-2) / <alpha-value>)", line: "rgb(var(--navy-line) / <alpha-value>)" },
        teal: { DEFAULT: "rgb(var(--teal) / <alpha-value>)", dark: "rgb(var(--teal-dark) / <alpha-value>)", soft: "rgb(var(--teal-soft) / <alpha-value>)", tint: "rgb(var(--teal-tint) / <alpha-value>)" },
        amber: { DEFAULT: "rgb(var(--amber) / <alpha-value>)", soft: "rgb(var(--amber-soft) / <alpha-value>)", card: "rgb(var(--amber-card) / <alpha-value>)", line: "rgb(var(--amber-line) / <alpha-value>)", dot: "rgb(var(--amber-dot) / <alpha-value>)", ink: "rgb(var(--amber-ink) / <alpha-value>)" },
        good: { DEFAULT: "rgb(var(--good) / <alpha-value>)", soft: "rgb(var(--good-soft) / <alpha-value>)" },
        bad: { DEFAULT: "rgb(var(--bad) / <alpha-value>)", soft: "rgb(var(--bad-soft) / <alpha-value>)", line: "rgb(var(--bad-line) / <alpha-value>)" },
        sea: { DEFAULT: "rgb(var(--sea) / <alpha-value>)", light: "rgb(var(--sea-light) / <alpha-value>)", deep: "rgb(var(--sea-deep) / <alpha-value>)", foam: "rgb(var(--sea-foam) / <alpha-value>)" },
      },
      fontFamily: {
        display: ['"DM Serif Display"', "Georgia", "serif"],
        sans: ['"Hanken Grotesk"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: { card: "0 1px 0 rgba(15,45,58,0.03)" },
      keyframes: {
        page: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        pop: { from: { opacity: "0", transform: "translateY(-4px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
        "toast-in": { from: { opacity: "0", transform: "translateY(12px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
        "toast-out": { from: { opacity: "1" }, to: { opacity: "0", transform: "translateY(8px)" } },
        shake: { "0%,100%": { transform: "none" }, "20%,60%": { transform: "translateX(-4px)" }, "40%,80%": { transform: "translateX(4px)" } },
        badge: { "0%,100%": { transform: "scale(1)" }, "50%": { transform: "scale(1.12)" } },
        draw: { from: { strokeDashoffset: "var(--len, 2000)" }, to: { strokeDashoffset: "0" } },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        dialog: { from: { opacity: "0", transform: "translateY(16px) scale(0.97)" }, to: { opacity: "1", transform: "none" } },
        unblur: { from: { filter: "blur(8px)", opacity: "0.7" }, to: { filter: "blur(0)", opacity: "1" } },
      },
      animation: {
        page: "page 420ms cubic-bezier(.2,.7,.2,1) both",
        pop: "pop 160ms ease-out both",
        "toast-in": "toast-in 260ms cubic-bezier(.2,.7,.2,1) both",
        "toast-out": "toast-out 300ms ease-in both",
        shake: "shake 360ms ease-in-out",
        badge: "badge 2.4s ease-in-out infinite",
        draw: "draw 1.1s cubic-bezier(.4,0,.2,1) both",
        fade: "fade 600ms ease-out both",
        dialog: "dialog 480ms cubic-bezier(.2,.7,.2,1) 150ms both",
        unblur: "unblur 700ms cubic-bezier(.2,.7,.2,1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
