import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ink: {
          DEFAULT: "#1c1733",
          soft: "#4a4368",
          faint: "#8b86a3",
        },
        cream: "#fdfbff",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(28,23,51,0.04), 0 8px 24px rgba(28,23,51,0.06)",
        lift: "0 4px 8px rgba(28,23,51,0.06), 0 16px 40px rgba(28,23,51,0.10)",
      },
      borderRadius: {
        "2xl": "1.1rem",
        "3xl": "1.6rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(251,146,60,0.55)" },
          "70%": { boxShadow: "0 0 0 10px rgba(251,146,60,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(251,146,60,0)" },
        },
        "pulse-ring-rose": {
          "0%": { boxShadow: "0 0 0 0 rgba(244,63,94,0.55)" },
          "70%": { boxShadow: "0 0 0 10px rgba(244,63,94,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(244,63,94,0)" },
        },
        "pulse-ring-green": {
          "0%": { boxShadow: "0 0 0 0 rgba(16,185,129,0.55)" },
          "70%": { boxShadow: "0 0 0 10px rgba(16,185,129,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(16,185,129,0)" },
        },
        "pulse-ring-indigo": {
          "0%": { boxShadow: "0 0 0 0 rgba(99,102,241,0.6)" },
          "70%": { boxShadow: "0 0 0 10px rgba(99,102,241,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(99,102,241,0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s cubic-bezier(0.16,1,0.3,1) both",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
        "pulse-ring-rose": "pulse-ring-rose 1.6s cubic-bezier(0.4,0,0.6,1) infinite",
        "pulse-ring-green": "pulse-ring-green 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
        "pulse-ring-indigo": "pulse-ring-indigo 1.1s cubic-bezier(0.4,0,0.6,1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
