'use client';

import { FormEvent, useCallback, useMemo, useRef, KeyboardEvent, ClipboardEvent } from "react";
import styles from "./discovery-dashboard.module.css";

export interface IpRange {
  id: string;
  octet1: string;
  octet2: string;
  octet3: string;
  start: string;
  end: string;
}

// Helper to create a unique ID for new ranges
let rangeIdCounter = 0;
export function createEmptyRange(): IpRange {
  return {
    id: `range-${++rangeIdCounter}-${Date.now()}`,
    octet1: "",
    octet2: "",
    octet3: "",
    start: "",
    end: "",
  };
}

// Helper to create a default range with pre-filled values
export function createDefaultRange(
  octet1 = "10",
  octet2 = "88",
  octet3 = "99",
  start = "201",
  end = "254"
): IpRange {
  return {
    id: `range-${++rangeIdCounter}-${Date.now()}`,
    octet1,
    octet2,
    octet3,
    start,
    end,
  };
}

// Validate an octet value (0-255)
function isValidOctet(value: string): boolean {
  if (value === "") return false;
  const num = parseInt(value, 10);
  return !isNaN(num) && num >= 0 && num <= 255 && value === String(num);
}

// Validate a last-octet value (0-254 for IP range)
function isValidLastOctet(value: string): boolean {
  if (value === "") return false;
  const num = parseInt(value, 10);
  return !isNaN(num) && num >= 0 && num <= 254 && value === String(num);
}

// Check if a single range is valid
function isRangeValid(range: IpRange): boolean {
  const validBase =
    isValidOctet(range.octet1) &&
    isValidOctet(range.octet2) &&
    isValidOctet(range.octet3);
  const validStart = isValidLastOctet(range.start);
  const validEnd = isValidLastOctet(range.end);
  
  if (!validBase || !validStart || !validEnd) return false;
  
  const start = parseInt(range.start, 10);
  const end = parseInt(range.end, 10);
  
  return start <= end;
}

// Get base IP string from octets
function getBaseIp(range: IpRange): string {
  return `${range.octet1}.${range.octet2}.${range.octet3}`;
}

// Check if two ranges overlap
function rangesOverlap(a: IpRange, b: IpRange): boolean {
  // Different base IPs don't overlap
  if (getBaseIp(a) !== getBaseIp(b)) return false;
  
  const aStart = parseInt(a.start, 10);
  const aEnd = parseInt(a.end, 10);
  const bStart = parseInt(b.start, 10);
  const bEnd = parseInt(b.end, 10);
  
  // Check interval overlap
  return aStart <= bEnd && bStart <= aEnd;
}

// Check for any overlapping ranges
function findOverlaps(ranges: IpRange[]): Set<string> {
  const validRanges = ranges.filter(isRangeValid);
  const overlappingIds = new Set<string>();
  
  for (let i = 0; i < validRanges.length; i++) {
    for (let j = i + 1; j < validRanges.length; j++) {
      if (rangesOverlap(validRanges[i], validRanges[j])) {
        overlappingIds.add(validRanges[i].id);
        overlappingIds.add(validRanges[j].id);
      }
    }
  }
  
  return overlappingIds;
}

// Normal mode deep phase settings (for reference and default calculation)
// These match PHASES_NORMAL deep phase in discovery-engine.ts
const NORMAL_DEEP_PHASE = {
  timeout: 1800,      // ms
  concurrency: 12,    // parallel requests
  retries: 1,         // retry count
};

// Default factors applied to normal mode to get thorough defaults
const DEFAULT_FACTORS = {
  timeoutMultiplier: 3,      // 1800 * 3 = 5400ms
  concurrencyDivisor: 8,     // 12 / 8 = ~2 parallel  
  extraRetries: 2,           // 1 + 2 = 3 retries
};

/** 
 * Thorough mode settings - actual values the user configures
 * (timeout in ms, concurrency count, retry count)
 */
export interface ThoroughSettings {
  timeout: number;       // milliseconds
  concurrency: number;   // parallel requests
  retries: number;       // retry count
}

/** Default thorough settings calculated from normal mode × factors */
export const DEFAULT_THOROUGH_SETTINGS: ThoroughSettings = {
  timeout: Math.round(NORMAL_DEEP_PHASE.timeout * DEFAULT_FACTORS.timeoutMultiplier),
  concurrency: Math.max(1, Math.round(NORMAL_DEEP_PHASE.concurrency / DEFAULT_FACTORS.concurrencyDivisor)),
  retries: NORMAL_DEEP_PHASE.retries + DEFAULT_FACTORS.extraRetries,
};

export interface DiscoveryFormValues {
  ranges: IpRange[];
  thoroughMode?: boolean;
  thoroughSettings?: ThoroughSettings;
}

// =============================================================================
// Compound IP Input Component - looks like one field, has multiple segments
// =============================================================================

interface IpBaseInputProps {
  octet1: string;
  octet2: string;
  octet3: string;
  onChange: (field: "octet1" | "octet2" | "octet3", value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}

function IpBaseInput({ octet1, octet2, octet3, onChange, disabled, hasError }: IpBaseInputProps) {
  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);
  const ref3 = useRef<HTMLInputElement>(null);

  const sanitize = (val: string, max: number = 255): string => {
    let cleaned = val.replace(/[^\d]/g, "");
    if (cleaned.length > 1 && cleaned.startsWith("0")) {
      cleaned = String(parseInt(cleaned, 10));
    }
    cleaned = cleaned.slice(0, 3);
    // Auto-cap at max
    const num = parseInt(cleaned, 10);
    if (!isNaN(num) && num > max) {
      cleaned = String(max);
    }
    return cleaned;
  };

  const handleChange = (field: "octet1" | "octet2" | "octet3", value: string, nextRef?: React.RefObject<HTMLInputElement | null>) => {
    const sanitized = sanitize(value);
    onChange(field, sanitized);
    
    // Auto-advance to next field when 3 digits entered or value is >= 26 (can't get higher with another digit)
    const num = parseInt(sanitized, 10);
    if (nextRef && (sanitized.length === 3 || (sanitized.length >= 2 && num >= 26))) {
      nextRef.current?.focus();
      nextRef.current?.select();
    }
  };

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    field: "octet1" | "octet2" | "octet3",
    prevRef?: React.RefObject<HTMLInputElement | null>,
    nextRef?: React.RefObject<HTMLInputElement | null>
  ) => {
    const input = e.currentTarget;
    
    // Tab or dot advances to next field
    if ((e.key === "." || e.key === "Tab") && !e.shiftKey && nextRef) {
      if (e.key === ".") {
        e.preventDefault();
        nextRef.current?.focus();
        nextRef.current?.select();
      }
      // Tab is handled naturally
    }
    
    // Shift+Tab or backspace at start goes to previous field
    if (e.key === "Backspace" && input.selectionStart === 0 && input.selectionEnd === 0 && prevRef) {
      e.preventDefault();
      prevRef.current?.focus();
      // Select all in previous field for easy replacement
      prevRef.current?.select();
    }
    
    // Arrow keys navigation
    if (e.key === "ArrowRight" && input.selectionStart === input.value.length && nextRef) {
      e.preventDefault();
      nextRef.current?.focus();
      nextRef.current?.setSelectionRange(0, 0);
    }
    if (e.key === "ArrowLeft" && input.selectionStart === 0 && prevRef) {
      e.preventDefault();
      prevRef.current?.focus();
      const len = prevRef.current?.value.length || 0;
      prevRef.current?.setSelectionRange(len, len);
    }
  };

  // Handle paste of full IP address
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").trim();
    const parts = pasted.split(".");
    
    if (parts.length >= 3) {
      e.preventDefault();
      onChange("octet1", sanitize(parts[0]));
      onChange("octet2", sanitize(parts[1]));
      onChange("octet3", sanitize(parts[2]));
      ref3.current?.focus();
    }
  };

  const containerClass = `${styles.compoundIpInput} ${hasError ? styles.compoundIpInputError : ""} ${disabled ? styles.compoundIpInputDisabled : ""}`;

  return (
    <div className={containerClass}>
      <input
        ref={ref1}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={styles.ipSegment}
        value={octet1}
        onChange={(e) => handleChange("octet1", e.target.value, ref2)}
        onKeyDown={(e) => handleKeyDown(e, "octet1", undefined, ref2)}
        onPaste={handlePaste}
        disabled={disabled}
        placeholder="10"
        maxLength={3}
        aria-label="First octet"
      />
      <span className={styles.ipSeparator}>.</span>
      <input
        ref={ref2}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={styles.ipSegment}
        value={octet2}
        onChange={(e) => handleChange("octet2", e.target.value, ref3)}
        onKeyDown={(e) => handleKeyDown(e, "octet2", ref1, ref3)}
        onPaste={handlePaste}
        disabled={disabled}
        placeholder="88"
        maxLength={3}
        aria-label="Second octet"
      />
      <span className={styles.ipSeparator}>.</span>
      <input
        ref={ref3}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={styles.ipSegment}
        value={octet3}
        onChange={(e) => handleChange("octet3", e.target.value)}
        onKeyDown={(e) => handleKeyDown(e, "octet3", ref2, undefined)}
        onPaste={handlePaste}
        disabled={disabled}
        placeholder="99"
        maxLength={3}
        aria-label="Third octet"
      />
    </div>
  );
}

// =============================================================================
// Compound Range Input Component - start and end with dash separator
// =============================================================================

interface RangeInputProps {
  start: string;
  end: string;
  onChange: (field: "start" | "end", value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}

function RangeInput({ start, end, onChange, disabled, hasError }: RangeInputProps) {
  const refStart = useRef<HTMLInputElement>(null);
  const refEnd = useRef<HTMLInputElement>(null);

  const sanitize = (val: string): string => {
    let cleaned = val.replace(/[^\d]/g, "");
    if (cleaned.length > 1 && cleaned.startsWith("0")) {
      cleaned = String(parseInt(cleaned, 10));
    }
    cleaned = cleaned.slice(0, 3);
    // Auto-cap at 254
    const num = parseInt(cleaned, 10);
    if (!isNaN(num) && num > 254) {
      cleaned = "254";
    }
    return cleaned;
  };

  const handleChange = (field: "start" | "end", value: string, nextRef?: React.RefObject<HTMLInputElement | null>) => {
    const sanitized = sanitize(value);
    onChange(field, sanitized);
    
    // Auto-advance when 3 digits or value >= 26
    const num = parseInt(sanitized, 10);
    if (nextRef && (sanitized.length === 3 || (sanitized.length >= 2 && num >= 26))) {
      nextRef.current?.focus();
      nextRef.current?.select();
    }
  };

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    field: "start" | "end",
    prevRef?: React.RefObject<HTMLInputElement | null>,
    nextRef?: React.RefObject<HTMLInputElement | null>
  ) => {
    const input = e.currentTarget;
    
    // Tab or dash advances to next field
    if ((e.key === "-" || e.key === "Tab") && !e.shiftKey && nextRef) {
      if (e.key === "-") {
        e.preventDefault();
        nextRef.current?.focus();
        nextRef.current?.select();
      }
    }
    
    // Backspace at start goes to previous field
    if (e.key === "Backspace" && input.selectionStart === 0 && input.selectionEnd === 0 && prevRef) {
      e.preventDefault();
      prevRef.current?.focus();
      prevRef.current?.select();
    }
    
    // Arrow keys
    if (e.key === "ArrowRight" && input.selectionStart === input.value.length && nextRef) {
      e.preventDefault();
      nextRef.current?.focus();
      nextRef.current?.setSelectionRange(0, 0);
    }
    if (e.key === "ArrowLeft" && input.selectionStart === 0 && prevRef) {
      e.preventDefault();
      prevRef.current?.focus();
      const len = prevRef.current?.value.length || 0;
      prevRef.current?.setSelectionRange(len, len);
    }
  };

  // Handle paste of range like "1-254" or "100 - 200"
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").trim();
    const parts = pasted.split(/[-–—\s]+/);
    
    if (parts.length >= 2) {
      e.preventDefault();
      onChange("start", sanitize(parts[0]));
      onChange("end", sanitize(parts[1]));
      refEnd.current?.focus();
    }
  };

  const containerClass = `${styles.compoundRangeInput} ${hasError ? styles.compoundRangeInputError : ""} ${disabled ? styles.compoundRangeInputDisabled : ""}`;

  return (
    <div className={containerClass}>
      <input
        ref={refStart}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={styles.rangeSegment}
        value={start}
        onChange={(e) => handleChange("start", e.target.value, refEnd)}
        onKeyDown={(e) => handleKeyDown(e, "start", undefined, refEnd)}
        onPaste={handlePaste}
        disabled={disabled}
        placeholder="1"
        maxLength={3}
        aria-label="Start of range"
      />
      <span className={styles.rangeDashSeparator}>–</span>
      <input
        ref={refEnd}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={styles.rangeSegment}
        value={end}
        onChange={(e) => handleChange("end", e.target.value)}
        onKeyDown={(e) => handleKeyDown(e, "end", refStart, undefined)}
        onPaste={handlePaste}
        disabled={disabled}
        placeholder="254"
        maxLength={3}
        aria-label="End of range"
      />
    </div>
  );
}

// =============================================================================
// Main Discovery Form
// =============================================================================

interface DiscoveryFormProps {
  values: DiscoveryFormValues;
  disabled: boolean;
  isLoading: boolean;
  onChange: (values: DiscoveryFormValues) => void;
  onSubmit: () => void;
  selectedCount?: number;
  onBatchOperationsClick?: () => void;
  hasResults?: boolean;
  onExportClick?: () => void;
}

export default function DiscoveryForm({
  values,
  disabled,
  isLoading,
  onChange,
  onSubmit,
  selectedCount = 0,
  onBatchOperationsClick,
  hasResults = false,
  onExportClick,
}: DiscoveryFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  // Update a specific field within a specific range
  const handleRangeFieldChange = useCallback(
    (rangeId: string, field: keyof Omit<IpRange, "id">, value: string) => {
      onChange({
        ...values,
        ranges: values.ranges.map((r) =>
          r.id === rangeId ? { ...r, [field]: value } : r
        ),
      });
    },
    [values, onChange]
  );

  // Add a new range
  const handleAddRange = useCallback(() => {
    const lastRange = values.ranges[values.ranges.length - 1];
    const newRange: IpRange = {
      id: `range-${++rangeIdCounter}-${Date.now()}`,
      octet1: lastRange?.octet1 || "",
      octet2: lastRange?.octet2 || "",
      octet3: lastRange?.octet3 || "",
      start: "",
      end: "",
    };
    onChange({
      ...values,
      ranges: [...values.ranges, newRange],
    });
  }, [values, onChange]);

  // Remove a range
  const handleRemoveRange = useCallback(
    (rangeId: string) => {
      if (values.ranges.length <= 1) return;
      onChange({
        ...values,
        ranges: values.ranges.filter((r) => r.id !== rangeId),
      });
    },
    [values, onChange]
  );

  // Calculate validation state
  const { allRangesValid, overlappingIds, hasOverlap } = useMemo(() => {
    const allValid = values.ranges.every(isRangeValid);
    const overlaps = findOverlaps(values.ranges);
    return {
      allRangesValid: allValid,
      overlappingIds: overlaps,
      hasOverlap: overlaps.size > 0,
    };
  }, [values.ranges]);

  const canSubmit = !disabled && allRangesValid && !hasOverlap;
  const hasBatchSelection = selectedCount > 0;

  return (
    <form onSubmit={handleSubmit}>
      {/* IP Ranges Section - Framed */}
      <div className={styles.ipRangesSection}>
        <div className={styles.ipRangesSectionHeader}>
          <h3 className={styles.ipRangesSectionTitle}>IP Ranges</h3>
          <button
            type="button"
            className={styles.addRangeButton}
            onClick={handleAddRange}
            disabled={disabled}
            title="Add another IP range"
          >
            + Add Range
          </button>
        </div>

        <div className={styles.ipRangesList}>
          {values.ranges.map((range, index) => {
            const isOverlapping = overlappingIds.has(range.id);
            const baseIpValid = isValidOctet(range.octet1) && isValidOctet(range.octet2) && isValidOctet(range.octet3);
            const baseIpPartiallyFilled = !!(range.octet1 || range.octet2 || range.octet3);
            const baseIpHasError = baseIpPartiallyFilled && !baseIpValid;
            
            const startValid = isValidLastOctet(range.start);
            const endValid = isValidLastOctet(range.end);
            const startNum = parseInt(range.start, 10);
            const endNum = parseInt(range.end, 10);
            const hasInvalidOrder = startValid && endValid && startNum > endNum;
            const rangePartiallyFilled = !!(range.start || range.end);
            const rangeHasError = (rangePartiallyFilled && (!startValid || !endValid)) || hasInvalidOrder;

            return (
              <div
                key={range.id}
                className={`${styles.ipRangeRow} ${isOverlapping ? styles.ipRangeRowOverlap : ""}`}
              >
                <span className={styles.rangeNumber}>{index + 1}.</span>
                
                {/* Base IP - compound input */}
                <IpBaseInput
                  octet1={range.octet1}
                  octet2={range.octet2}
                  octet3={range.octet3}
                  onChange={(field, value) => handleRangeFieldChange(range.id, field, value)}
                  disabled={disabled}
                  hasError={baseIpHasError}
                />

                <span className={styles.rangeDotConnector}>.</span>

                {/* Range start-end - compound input */}
                <RangeInput
                  start={range.start}
                  end={range.end}
                  onChange={(field, value) => handleRangeFieldChange(range.id, field, value)}
                  disabled={disabled}
                  hasError={rangeHasError || isOverlapping}
                />

                {/* Remove button */}
                {values.ranges.length > 1 && (
                  <button
                    type="button"
                    className={styles.removeRangeButton}
                    onClick={() => handleRemoveRange(range.id)}
                    disabled={disabled}
                    title="Remove this range"
                    aria-label="Remove range"
                  >
                    ×
                  </button>
                )}

                {/* Overlap warning */}
                {isOverlapping && (
                  <span className={styles.overlapWarning} title="This range overlaps with another range">
                    ⚠️
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Validation messages */}
        {hasOverlap && (
          <div className={styles.rangeValidationError}>
            ⚠️ Some IP ranges overlap. Please adjust the ranges to continue.
          </div>
        )}
      </div>

      {/* Thorough Mode Toggle */}
      <div className={styles.thoroughModeSection}>
        <label className={styles.thoroughModeLabel}>
          <input
            type="checkbox"
            checked={values.thoroughMode ?? false}
            onChange={(e) => onChange({ 
              ...values, 
              thoroughMode: e.target.checked,
              thoroughSettings: e.target.checked ? (values.thoroughSettings ?? DEFAULT_THOROUGH_SETTINGS) : undefined,
            })}
            disabled={disabled}
            className={styles.thoroughModeCheckbox}
          />
          <span className={styles.thoroughModeText}>
            🔬 Thorough Mode
          </span>
          <span className={styles.thoroughModeHint}>
            (slower scan for panels recovering from power outages)
          </span>
        </label>
        
        {/* Thorough Mode Settings */}
        {values.thoroughMode && (
          <div className={styles.thoroughSettings}>
            <div className={styles.thoroughSettingsHeader}>
              <span className={styles.thoroughSettingsTitle}>Thorough Mode Settings</span>
              <span className={styles.thoroughSettingsNormal}>
                Normal mode: {NORMAL_DEEP_PHASE.timeout}ms, {NORMAL_DEEP_PHASE.concurrency} parallel, {NORMAL_DEEP_PHASE.retries} retry
              </span>
            </div>
            
            <div className={styles.thoroughSettingRow}>
              <label 
                className={styles.thoroughSettingLabel}
                title="Maximum time to wait for each panel response. Increase for slow/recovering panels."
              >
                ⏱️ Timeout
              </label>
              <div className={styles.thoroughSettingInputGroup}>
                <input
                  type="number"
                  min="500"
                  max="30000"
                  step="100"
                  value={values.thoroughSettings?.timeout ?? DEFAULT_THOROUGH_SETTINGS.timeout}
                  onChange={(e) => onChange({
                    ...values,
                    thoroughSettings: {
                      ...DEFAULT_THOROUGH_SETTINGS,
                      ...values.thoroughSettings,
                      timeout: parseInt(e.target.value, 10) || DEFAULT_THOROUGH_SETTINGS.timeout,
                    },
                  })}
                  disabled={disabled}
                  className={styles.thoroughSettingInput}
                />
                <span className={styles.thoroughSettingSuffix}>ms</span>
              </div>
              <span className={styles.thoroughSettingNormalValue}>
                normal: {NORMAL_DEEP_PHASE.timeout}ms
              </span>
            </div>
            
            <div className={styles.thoroughSettingRow}>
              <label 
                className={styles.thoroughSettingLabel}
                title="Number of simultaneous panel requests. Lower = less network load, better for VPN/slow networks."
              >
                🔀 Parallel Requests
              </label>
              <div className={styles.thoroughSettingInputGroup}>
                <input
                  type="number"
                  min="1"
                  max="25"
                  step="1"
                  value={values.thoroughSettings?.concurrency ?? DEFAULT_THOROUGH_SETTINGS.concurrency}
                  onChange={(e) => onChange({
                    ...values,
                    thoroughSettings: {
                      ...DEFAULT_THOROUGH_SETTINGS,
                      ...values.thoroughSettings,
                      concurrency: Math.max(1, parseInt(e.target.value, 10) || DEFAULT_THOROUGH_SETTINGS.concurrency),
                    },
                  })}
                  disabled={disabled}
                  className={styles.thoroughSettingInput}
                />
              </div>
              <span className={styles.thoroughSettingNormalValue}>
                normal: {NORMAL_DEEP_PHASE.concurrency}
              </span>
            </div>
            
            <div className={styles.thoroughSettingRow}>
              <label 
                className={styles.thoroughSettingLabel}
                title="Number of retry attempts per panel. Increase for flaky networks."
              >
                🔄 Retries
              </label>
              <div className={styles.thoroughSettingInputGroup}>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="1"
                  value={values.thoroughSettings?.retries ?? DEFAULT_THOROUGH_SETTINGS.retries}
                  onChange={(e) => onChange({
                    ...values,
                    thoroughSettings: {
                      ...DEFAULT_THOROUGH_SETTINGS,
                      ...values.thoroughSettings,
                      retries: Math.max(0, parseInt(e.target.value, 10) ?? DEFAULT_THOROUGH_SETTINGS.retries),
                    },
                  })}
                  disabled={disabled}
                  className={styles.thoroughSettingInput}
                />
              </div>
              <span className={styles.thoroughSettingNormalValue}>
                normal: {NORMAL_DEEP_PHASE.retries}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.button}
          disabled={!canSubmit}
          aria-busy={isLoading}
          title={
            hasOverlap
              ? "Cannot start discovery: IP ranges overlap"
              : !allRangesValid
              ? "Please fill in all IP range fields with valid values"
              : undefined
          }
        >
          {isLoading ? (
            <>
              <span className={styles.desktopText}>⏳ Scanning…</span>
              <span className={styles.mobileText}>⏳</span>
            </>
          ) : (
            <>
              <span className={styles.desktopText}>🔍 Discover</span>
              <span className={styles.mobileText}>🔍 Scan</span>
            </>
          )}
        </button>
        <button
          type="button"
          className={`${styles.batchButton} ${hasBatchSelection ? styles.batchButtonActive : ""}`}
          disabled={!hasBatchSelection || isLoading}
          onClick={onBatchOperationsClick}
        >
          <span className={styles.desktopText}>
            ⚡ Batch Operations{hasBatchSelection ? ` (${selectedCount})` : ""}
          </span>
          <span className={styles.mobileText}>
            ⚡ Batch{hasBatchSelection ? ` (${selectedCount})` : ""}
          </span>
        </button>
        <button
          type="button"
          className={styles.exportButton}
          disabled={!hasResults || isLoading}
          onClick={onExportClick}
          title="Export all discovery results to Excel"
        >
          <span className={styles.desktopText}>📊 Export</span>
          <span className={styles.mobileText}>📊</span>
        </button>
      </div>
    </form>
  );
}
