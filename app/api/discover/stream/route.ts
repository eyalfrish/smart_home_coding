import { NextRequest } from "next/server";
import { runMultiPhaseDiscovery, type DiscoveryEvent } from "@/lib/discovery/discovery-engine";
import { getPanelRegistry } from "@/lib/discovery/panel-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_IP_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Streaming discovery endpoint using SSE.
 * Results are streamed in real-time as they complete.
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

  // Create a ReadableStream for true SSE streaming
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      let aborted = false;
      
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

      // Send events as they arrive
      const sendEvent = (event: DiscoveryEvent) => {
        if (aborted) return;
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch (err) {
          console.error("[Discovery] Failed to send event:", err);
        }
      };

      try {
        // Run discovery with real-time event streaming
        await runMultiPhaseDiscovery(baseIp, start, end, sendEvent);
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
