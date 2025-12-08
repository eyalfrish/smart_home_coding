import { NextRequest } from "next/server";
import { runMultiPhaseDiscovery, type DiscoveryEvent } from "@/lib/discovery/discovery-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_IP_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Streaming discovery endpoint using SSE with multi-phase scanning.
 * 
 * Query params:
 * - baseIp: First 3 octets (e.g., "10.88.99")
 * - start: Start of range (e.g., 1)
 * - end: End of range (e.g., 254)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const baseIp = searchParams.get("baseIp");
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");

  // Validate baseIp
  if (!baseIp || !BASE_IP_REGEX.test(baseIp)) {
    return new Response(
      JSON.stringify({ error: "Invalid baseIp - must be 3 octets (e.g., 10.88.99)" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const octets = baseIp.split(".").map(Number);
  if (octets.some(o => o < 0 || o > 255)) {
    return new Response(
      JSON.stringify({ error: "Invalid baseIp - octets must be 0-255" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const start = parseInt(startStr ?? "1", 10);
  const end = parseInt(endStr ?? "254", 10);

  if (isNaN(start) || isNaN(end) || start < 0 || end > 254 || start > end) {
    return new Response(
      JSON.stringify({ error: "Invalid start/end range (must be 0-254, start <= end)" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await runMultiPhaseDiscovery(baseIp, start, end, (event: DiscoveryEvent) => {
          // Forward all events to client
          send(event);
        });
      } catch (error) {
        console.error("[Discovery] Error:", error);
        send({ 
          type: "complete", 
          stats: { 
            totalIps: 0, 
            panelsFound: 0, 
            nonPanels: 0, 
            noResponse: 0, 
            errors: 1, 
            phases: [], 
            totalDurationMs: 0 
          } 
        });
      }

      if (!closed) {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
