import { NextResponse } from "next/server";
import type {
  DiscoveryRequest,
  DiscoveryResponse,
  DiscoverySummary,
} from "@/lib/discovery/types";
import { runMultiPhaseDiscovery } from "@/lib/discovery/discovery-engine";

export const runtime = "nodejs";

const BASE_IP_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Non-streaming discovery endpoint.
 * 
 * Uses the same multi-phase discovery engine as the streaming endpoint,
 * but returns all results at once when complete.
 * 
 * For better UX, prefer the streaming endpoint at /api/discover/stream
 */
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

  try {
    const resultsMap = await runMultiPhaseDiscovery(
      body.baseIp,
      body.start,
      body.end,
      () => {} // No-op callback for non-streaming mode
    );

    // Build ordered results array
    const results = [];
    for (let octet = body.start; octet <= body.end; octet++) {
      const ip = `${body.baseIp}.${octet}`;
      const result = resultsMap.get(ip);
      if (result) {
        // Remove panelHtml to reduce payload size
        const { panelHtml, ...rest } = result;
        results.push(rest);
      }
    }

    const summary: DiscoverySummary = {
      baseIp: body.baseIp,
      start: body.start,
      end: body.end,
      totalChecked: results.length,
      panelsFound: results.filter(r => r.status === "panel").length,
      notPanels: results.filter(r => r.status === "not-panel").length,
      noResponse: results.filter(r => r.status === "no-response" || r.status === "pending").length,
      errors: results.filter(r => r.status === "error").length,
    };

    const response: DiscoveryResponse = {
      summary,
      results,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[Discovery] Error:", error);
    return NextResponse.json(
      { message: "Discovery failed due to an internal error." },
      { status: 500 }
    );
  }
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
