import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "#0A84FF",
          hover: "#007AFF",
          glow: "rgba(10, 132, 255, 0.5)",
        },
        "text-secondary": "var(--text-secondary)",
      },
      boxShadow: {
        glow: "0 0 20px rgba(10, 132, 255, 0.3)",
      },
    },
  },
  plugins: [],
};

export default config;
