import { NextRequest } from "next/server";
import { runMultiPhaseDiscovery, type DiscoveryEvent, type DiscoveryOptions } from "@/lib/discovery/discovery-engine";
import { getPanelRegistry } from "@/lib/discovery/panel-registry";
import { updateCacheFromDiscovery, getCachedPanelsInRange, type UpdateCachedPanelData } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_IP_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Streaming discovery endpoint using SSE.
 * Results are streamed in real-time as they complete.
 * 
 * Query params:
 * - baseIp: Base IP (e.g., "10.88.99")
 * - start: Start of range (0-254)
 * - end: End of range (0-254)
 * - thorough: Enable thorough mode (optional, "true" to enable)
 * - timeout: Thorough mode timeout in ms (default: 5400)
 * - concurrency: Thorough mode parallel requests (default: 2)
 * - retries: Thorough mode retry count (default: 3)
 */
export async function GET(request: NextRequest) {
  // Reset panel registry before starting new discovery
  // This clears any stale WebSocket connections from previous discoveries
  const registry = getPanelRegistry();
  registry.reset();
  console.log("[Discovery] Starting new discovery - registry reset");
  
  const searchParams = request.nextUrl.searchParams;
  const baseIp = searchParams.get("baseIp");
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");
  const thoroughMode = searchParams.get("thorough") === "true";
  
  // Parse thorough mode settings (actual values, not multipliers)
  const timeout = parseInt(searchParams.get("timeout") ?? "", 10) || undefined;
  const concurrency = parseInt(searchParams.get("concurrency") ?? "", 10) || undefined;
  const retries = parseInt(searchParams.get("retries") ?? "", 10) ?? undefined;

  // Validate
  if (!baseIp || !BASE_IP_REGEX.test(baseIp)) {
    return new Response(
      JSON.stringify({ error: "Invalid baseIp" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const octets = baseIp.split(".").map(Number);
  if (octets.some(o => o < 0 || o > 255)) {
    return new Response(
      JSON.stringify({ error: "Invalid baseIp octets" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const start = parseInt(startStr ?? "1", 10);
  const end = parseInt(endStr ?? "254", 10);

  if (isNaN(start) || isNaN(end) || start < 0 || end > 254 || start > end) {
    return new Response(
      JSON.stringify({ error: "Invalid range" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Load cached panel data for this IP range (to enrich no-response results)
  const cachedPanelsPromise = getCachedPanelsInRange(baseIp, start, end);
  
  // Create a ReadableStream for true SSE streaming
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      let aborted = false;
      
      // Wait for cache to load
      const cachedPanels = await cachedPanelsPromise;
      
      // Track discovered panels for cache update (keyed by IP for updates)
      const discoveredPanelsMap = new Map<string, UpdateCachedPanelData>();
      
      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        aborted = true;
        console.log("[Discovery] Client disconnected, aborting");
        try {
          controller.close();
        } catch {
          // Controller might already be closed
        }
      });

      // Send events as they arrive, enriching with cached data
      const sendEvent = (event: DiscoveryEvent) => {
        if (aborted) return;
        try {
          // Handle result and update events for panel caching
          if ((event.type === "result" || event.type === "update") && event.data && !Array.isArray(event.data)) {
            const result = event.data;
            const cached = cachedPanels[result.ip];
            
            if (result.status === "panel") {
              // Track/update discovered panel for cache update
              // "update" events contain the enriched data with name from settings
              const existing = discoveredPanelsMap.get(result.ip);
              discoveredPanelsMap.set(result.ip, {
                ip: result.ip,
                name: result.name ?? existing?.name,
                loggingEnabled: result.settings?.logging ?? existing?.loggingEnabled,
                longPressMs: result.settings?.longPressMs ?? existing?.longPressMs,
              });
            } else if ((result.status === "no-response" || result.status === "error") && cached) {
              // Enrich with cached data so frontend can show "last known" info
              result.cachedName = cached.name;
              result.cachedLastSeen = cached.lastSeen;
            }
          }
          
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch (err) {
          console.error("[Discovery] Failed to send event:", err);
        }
      };

      try {
        // Run discovery with real-time event streaming
        const options: DiscoveryOptions = { 
          thoroughMode,
          thoroughSettings: thoroughMode ? {
            timeout,
            concurrency,
            retries,
          } : undefined,
        };
        await runMultiPhaseDiscovery(baseIp, start, end, sendEvent, options);
        
        // Update cache with discovered panels (fire and forget)
        const discoveredPanels = Array.from(discoveredPanelsMap.values());
        if (discoveredPanels.length > 0) {
          updateCacheFromDiscovery(discoveredPanels).catch(err => {
            console.error("[Discovery] Failed to update panel cache:", err);
          });
        }
      } catch (err) {
        console.error("[Discovery] Error during discovery:", err);
        sendEvent({
          type: "complete",
          stats: {
            totalIps: end - start + 1,
            panelsFound: 0,
            nonPanels: 0,
            noResponse: end - start + 1,
            errors: 1,
            phases: [],
            totalDurationMs: 0,
          },
        });
      } finally {
        if (!aborted) {
          try {
            controller.close();
          } catch {
            // Controller might already be closed
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
