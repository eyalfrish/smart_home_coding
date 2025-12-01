import { NextResponse } from "next/server";
import type {
  DiscoveryRequest,
  DiscoveryResponse,
  DiscoveryResult,
  DiscoverySummary,
} from "@/lib/discovery/types";

export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 1200;
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

  const targets: Promise<DiscoveryResult>[] = [];
  for (let lastOctet = body.start; lastOctet <= body.end; lastOctet += 1) {
    targets.push(checkHost(`${body.baseIp}.${lastOctet}`));
  }

  const results = await Promise.all(targets);
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
      return { ip, status: "panel", httpStatus: response.status };
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
    noResponse: 0,
    errors: 0,
  };

  for (const result of results) {
    if (result.status === "panel") {
      summary.panelsFound += 1;
    } else if (result.status === "no-response") {
      summary.noResponse += 1;
    } else if (result.status === "error") {
      summary.errors += 1;
    }
  }

  return summary;
}

