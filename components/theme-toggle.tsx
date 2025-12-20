"use client";

import { useState, useEffect } from "react";
import { useTheme, Theme } from "./theme-provider";
import styles from "./theme-toggle.module.css";

const themes: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀️" },
  { value: "dark", label: "Dark", icon: "🌙" },
  { value: "system", label: "System", icon: "💻" },
];

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent hydration mismatch - render placeholder during SSR
  if (!mounted) {
    return (
      <div className={styles.container}>
        <div className={styles.toggleGroup} style={{ opacity: 0 }}>
          {themes.map(({ value, label, icon }) => (
            <button key={value} className={styles.toggleButton} disabled>
              <span className={styles.icon}>{icon}</span>
              <span className={styles.label}>{label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.toggleGroup} role="radiogroup" aria-label="Theme selection">
        {themes.map(({ value, label, icon }) => (
          <button
            key={value}
            className={`${styles.toggleButton} ${theme === value ? styles.active : ""}`}
            onClick={() => setTheme(value)}
            role="radio"
            aria-checked={theme === value}
            aria-label={label}
            title={label}
          >
            <span className={styles.icon}>{icon}</span>
            <span className={styles.label}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

