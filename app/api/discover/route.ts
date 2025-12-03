import { NextResponse } from "next/server";
import type {
  DiscoveryRequest,
  DiscoveryResponse,
  DiscoveryResult,
  DiscoverySummary,
} from "@/lib/discovery/types";

export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 1600;
const SETTINGS_REQUEST_TIMEOUT_MS = 1500;
const MAX_CONCURRENCY = 10;
const RETRY_LIMIT = 1;
const RETRY_DELAY_MS = 200;
const BASE_IP_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export async function POST(request: Request) {
  let body: DiscoveryRequest;

  try {
    body = (await request.json()) as DiscoveryRequest;
  } catch {
    return NextResponse.json(
      { message: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const validationError = validatePayload(body);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  const targets: string[] = [];
  for (let lastOctet = body.start; lastOctet <= body.end; lastOctet += 1) {
    targets.push(`${body.baseIp}.${lastOctet}`);
  }

  const results = await runDiscovery(targets);
  const summary = buildSummary(body, results);

  const response: DiscoveryResponse = {
    summary,
    results,
  };

  return NextResponse.json(response);
}

function validatePayload(payload: DiscoveryRequest): string | null {
  if (!payload || typeof payload !== "object") {
    return "Missing request body.";
  }

  if (!BASE_IP_REGEX.test(payload.baseIp ?? "")) {
    return "Base IP must contain exactly three octets (e.g. 10.88.99).";
  }

  const octets = payload.baseIp.split(".").map(Number);
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return "Base IP octets must be between 0 and 255.";
  }

  if (!Number.isInteger(payload.start) || !Number.isInteger(payload.end)) {
    return "Start and end must be integers.";
  }

  if (
    payload.start < 0 ||
    payload.start > 254 ||
    payload.end < 0 ||
    payload.end > 254
  ) {
    return "Start and end must be between 0 and 254.";
  }

  if (payload.start > payload.end) {
    return "Start must be less than or equal to end.";
  }

  if (payload.end - payload.start > 254) {
    return "Range is too large. Please scan 255 addresses or fewer.";
  }

  return null;
}

async function runDiscovery(targets: string[]): Promise<DiscoveryResult[]> {
  const results: DiscoveryResult[] = Array(targets.length);
  let nextIndex = 0;

  const workers = Array.from({
    length: Math.min(MAX_CONCURRENCY, targets.length),
  }).map(async () => {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= targets.length) {
        break;
      }
      nextIndex += 1;

      const ip = targets[currentIndex];
      results[currentIndex] = await checkHostWithRetry(ip);
      // slight pause to avoid hammering all panels simultaneously
      await delay(20);
    }
  });

  await Promise.all(workers);
  return results;
}

async function checkHostWithRetry(ip: string): Promise<DiscoveryResult> {
  let attempt = 0;
  while (attempt <= RETRY_LIMIT) {
    const result = await checkHost(ip);
    if (result.status !== "no-response" || attempt === RETRY_LIMIT) {
      return result;
    }
    attempt += 1;
    await delay(RETRY_DELAY_MS);
  }

  // Should not reach here, but return a fallback if it does.
  return { ip, status: "no-response", errorMessage: "No response" };
}

async function checkHost(ip: string): Promise<DiscoveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `http://${ip}/`;

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 200) {
      const html = await response.text();
      const panel = isPanelHtml(html);
      const panelName = panel ? await fetchPanelName(ip) : null;
      return {
        ip,
        status: panel ? "panel" : "not-panel",
        httpStatus: response.status,
        errorMessage: panel ? undefined : "HTML does not look like Cubixx",
        name: panel ? panelName : undefined,
      };
    }

    return {
      ip,
      status: "error",
      httpStatus: response.status,
      errorMessage: `Unexpected HTTP ${response.status}`,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return {
        ip,
        status: "no-response",
        errorMessage: "Request timed out",
      };
    }

    return {
      ip,
      status: "error",
      errorMessage: (error as Error).message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Best-effort scrape of the hostn input on /settings. The main page does not expose
// the name, so we read it from the settings form when possible.
async function fetchPanelName(ip: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SETTINGS_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(`http://${ip}/settings`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const match = html.match(/id=["']hostn["'][^>]*value=["']([^"']*)["']/i);
    if (!match) {
      return null;
    }

    const rawName = match[1].trim();
    return rawName || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSummary(
  payload: DiscoveryRequest,
  results: DiscoveryResult[]
): DiscoverySummary {
  const summary: DiscoverySummary = {
    baseIp: payload.baseIp,
    start: payload.start,
    end: payload.end,
    totalChecked: results.length,
    panelsFound: 0,
    notPanels: 0,
    noResponse: 0,
    errors: 0,
  };

  for (const result of results) {
    if (result.status === "panel") {
      summary.panelsFound += 1;
    } else if (result.status === "not-panel") {
      summary.notPanels += 1;
    } else if (result.status === "no-response") {
      summary.noResponse += 1;
    } else if (result.status === "error") {
      summary.errors += 1;
    }
  }

  return summary;
}

// Treat an IP as a "panel" only if its HTML clearly looks like a Cubixx controller.
// This is intentionally strict: any non-Cubixx page (including Control4 or other devices)
// will be classified as "not-panel" even if it returns HTTP 200.
function isPanelHtml(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes("cubixx") || lower.includes("cubixx controller");
}

