import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1360px" } },
    extend: {
      colors: {
        asphalt: "#0A0A0B",
        panel: "#141416",
        line: "#27272A", // decorative only: dividers and card edges
        field: "#71717A", // borders of inputs and outline buttons: 3:1+ on asphalt and panel (WCAG 1.4.11)
        signal: { DEFAULT: "#FF5500", dim: "#CC4400" },
        chalk: "#F4F4F5",
        mute: "#A1A1AA",
        verified: "#5EEAD4",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
      },
      fontFamily: {
        sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
      },
      borderRadius: { lg: "10px", md: "8px", sm: "6px" },
      keyframes: {
        "bid-flash": {
          "0%": { boxShadow: "0 0 0 0 rgba(255,85,0,0.55)" },
          "100%": { boxShadow: "0 0 0 14px rgba(255,85,0,0)" },
        },
      },
      animation: { "bid-flash": "bid-flash 700ms ease-out" },
    },
  },
  plugins: [animate],
};

export default config;
