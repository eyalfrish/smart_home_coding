import { NextResponse } from "next/server";
import type {
  DiscoveryRequest,
  DiscoveryResponse,
  DiscoverySummary,
} from "@/lib/discovery/types";
import { runMultiPhaseDiscovery, type DiscoveryOptions } from "@/lib/discovery/discovery-engine";
import { updateCacheFromDiscovery, getCachedPanelsInRange, type UpdateCachedPanelData } from "@/server/db";

interface ThoroughSettings {
  timeout?: number;      // ms
  concurrency?: number;  // parallel requests
  retries?: number;      // retry count
}

interface ExtendedDiscoveryRequest extends DiscoveryRequest {
  thoroughMode?: boolean;
  thoroughSettings?: ThoroughSettings;
}

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
  let body: ExtendedDiscoveryRequest;

  try {
    body = (await request.json()) as ExtendedDiscoveryRequest;
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
    // Load cached panel data for this IP range
    const cachedPanels = await getCachedPanelsInRange(body.baseIp, body.start, body.end);
    
    const options: DiscoveryOptions = { 
      thoroughMode: body.thoroughMode ?? false,
      thoroughSettings: body.thoroughSettings,
    };
    const resultsMap = await runMultiPhaseDiscovery(
      body.baseIp,
      body.start,
      body.end,
      () => {}, // No-op callback for non-streaming mode
      options
    );

    // Track discovered panels for cache update
    const discoveredPanels: UpdateCachedPanelData[] = [];

    // Build ordered results array
    const results = [];
    for (let octet = body.start; octet <= body.end; octet++) {
      const ip = `${body.baseIp}.${octet}`;
      const result = resultsMap.get(ip);
      if (result) {
        // Remove panelHtml to reduce payload size
        const { panelHtml, ...rest } = result;
        
        // Track discovered panels for cache update
        if (result.status === "panel") {
          discoveredPanels.push({
            ip: result.ip,
            name: result.name,
            loggingEnabled: result.settings?.logging,
            longPressMs: result.settings?.longPressMs,
          });
        } else if ((result.status === "no-response" || result.status === "error") && cachedPanels[ip]) {
          // Enrich with cached data for offline panels
          rest.cachedName = cachedPanels[ip].name;
          rest.cachedLastSeen = cachedPanels[ip].lastSeen;
        }
        
        results.push(rest);
      }
    }

    // Update cache with discovered panels (fire and forget)
    if (discoveredPanels.length > 0) {
      updateCacheFromDiscovery(discoveredPanels).catch(err => {
        console.error("[Discovery] Failed to update panel cache:", err);
      });
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
