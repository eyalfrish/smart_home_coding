'use client';

import { FormEvent } from "react";
import styles from "./discovery-dashboard.module.css";

export interface DiscoveryFormValues {
  baseIp: string;
  start: string;
  end: string;
}

interface DiscoveryFormProps {
  values: DiscoveryFormValues;
  disabled: boolean;
  isLoading: boolean;
  onChange: (values: DiscoveryFormValues) => void;
  onSubmit: () => void;
}

export default function DiscoveryForm({
  values,
  disabled,
  isLoading,
  onChange,
  onSubmit,
}: DiscoveryFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  const handleFieldChange = (field: keyof DiscoveryFormValues, value: string) => {
    onChange({ ...values, [field]: value });
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
            value={values.baseIp}
            onChange={(event) => handleFieldChange("baseIp", event.target.value)}
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
            value={values.start}
            onChange={(event) => handleFieldChange("start", event.target.value)}
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
            value={values.end}
            onChange={(event) => handleFieldChange("end", event.target.value)}
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

