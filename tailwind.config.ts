import type { Config } from "tailwindcss";

// Tokens taken from the reference screens: soft grey-green canvas, deep teal
// accent, amber for "needs you", navy for the status card and dark sections.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F3F6F5",
        surface: "#FFFFFF",
        line: "#E3E8E7",
        ink: "#0F2D3A",
        body: "#26383F",
        muted: "#53636A",
        faint: "#56666C",
        navy: { DEFAULT: "#102C38", 2: "#16394A", line: "#2A4B5A" },
        teal: { DEFAULT: "#0E5E56", dark: "#0A4A43", soft: "#DCEBE7", tint: "#EEF5F3" },
        amber: { DEFAULT: "#80560D", soft: "#F3E7D1", card: "#F4E9D6", line: "#E3CFA8", dot: "#C38A26" },
        good: { DEFAULT: "#22653D", soft: "#DDEFE4" },
        bad: { DEFAULT: "#A23625", soft: "#F7E1DC", line: "#E8B9B0" },
        sea: { DEFAULT: "#AFCBD3", light: "#CADDE2", deep: "#94B6C0", foam: "#E9F2F4" },
      },
      fontFamily: {
        display: ['"DM Serif Display"', "Georgia", "serif"],
        sans: ['"Hanken Grotesk"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: { card: "0 1px 0 rgba(15,45,58,0.03)" },
      // Decorative strokes only (chart lines, compass). Never used for text.
      borderColor: { strong: "#9AA9AD" },
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
