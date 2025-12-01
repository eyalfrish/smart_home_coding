'use client';

import { FormEvent, useState } from "react";
import styles from "./discovery-dashboard.module.css";
import type { DiscoveryRequest } from "@/lib/discovery/types";

interface DiscoveryFormProps {
  defaults: DiscoveryRequest;
  disabled: boolean;
  isLoading: boolean;
  onSubmit: (payload: DiscoveryRequest) => void;
}

export default function DiscoveryForm({
  defaults,
  disabled,
  isLoading,
  onSubmit,
}: DiscoveryFormProps) {
  const [baseIp, setBaseIp] = useState(defaults.baseIp);
  const [start, setStart] = useState<string>(String(defaults.start));
  const [end, setEnd] = useState<string>(String(defaults.end));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      baseIp: baseIp.trim(),
      start: Number(start),
      end: Number(end),
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          Base IP
          <input
            type="text"
            name="baseIp"
            inputMode="numeric"
            autoComplete="off"
            value={baseIp}
            onChange={(event) => setBaseIp(event.target.value)}
            disabled={disabled}
            placeholder="10.88.99"
            required
          />
        </label>
        <label className={styles.field}>
          Start
          <input
            type="number"
            name="start"
            min={0}
            max={254}
            value={start}
            onChange={(event) => setStart(event.target.value)}
            disabled={disabled}
            required
          />
        </label>
        <label className={styles.field}>
          End
          <input
            type="number"
            name="end"
            min={0}
            max={254}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            disabled={disabled}
            required
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.button}
          disabled={disabled}
          aria-busy={isLoading}
        >
          {isLoading ? "Scanning…" : "Discover"}
        </button>
        {isLoading && <span className={styles.status}>Scanning range…</span>}
      </div>
    </form>
  );
}

