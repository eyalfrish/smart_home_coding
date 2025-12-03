'use client';

interface FingerprintEntry {
  id: string;
  state: string;
}

const RELAY_SELECTOR = 'span[id^="relay-status-"]';
const CURTAIN_SELECTOR = 'span[id^="curtain-status-"]';
const CONTACT_SELECTOR = "#contact-input-status";

export function computePanelFingerprint(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const relayStatuses = collectStatuses(doc, RELAY_SELECTOR);
  const curtainStatuses = collectStatuses(doc, CURTAIN_SELECTOR);
  const contactStatus = doc.querySelector(CONTACT_SELECTOR);

  relayStatuses.sort((a, b) => a.id.localeCompare(b.id));
  curtainStatuses.sort((a, b) => a.id.localeCompare(b.id));

  const fingerprint = {
    relays: relayStatuses,
    curtains: curtainStatuses,
    contact: contactStatus
      ? normalizeStateText(contactStatus.textContent)
      : null,
  };

  return JSON.stringify(fingerprint);
}

function collectStatuses(doc: Document, selector: string): FingerprintEntry[] {
  return Array.from(doc.querySelectorAll(selector)).map((el) => ({
    id: el.id || "",
    state: normalizeStateText(el.textContent),
  }));
}

function normalizeStateText(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }

  if (normalized.includes("opening")) {
    return "opening";
  }
  if (normalized.includes("closing")) {
    return "closing";
  }
  if (normalized.includes("open")) {
    return "open";
  }
  if (normalized.includes("close")) {
    return "close";
  }
  if (normalized.includes("stopped")) {
    return "stopped";
  }
  if (normalized.includes("stop")) {
    return "stop";
  }
  if (normalized.includes("on")) {
    return "on";
  }
  if (normalized.includes("off")) {
    return "off";
  }

  return normalized;
}

