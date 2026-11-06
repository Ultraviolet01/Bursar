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
        muted: "#5E6E73",
        faint: "#8A989C",
        navy: { DEFAULT: "#102C38", 2: "#16394A", line: "#2A4B5A" },
        teal: { DEFAULT: "#0E5E56", dark: "#0A4A43", soft: "#DCEBE7", tint: "#EEF5F3" },
        amber: { DEFAULT: "#A36C12", soft: "#F3E7D1", card: "#F4E9D6", line: "#E3CFA8", dot: "#C38A26" },
        good: { DEFAULT: "#2C7A4E", soft: "#DDEFE4" },
        bad: { DEFAULT: "#B53F2E", soft: "#F7E1DC", line: "#E8B9B0" },
        sea: { DEFAULT: "#AFCBD3", light: "#CADDE2", deep: "#94B6C0", foam: "#E9F2F4" },
      },
      fontFamily: {
        display: ['"DM Serif Display"', "Georgia", "serif"],
        sans: ['"Hanken Grotesk"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: { card: "0 1px 0 rgba(15,45,58,0.03)" },
    },
  },
  plugins: [],
} satisfies Config;
