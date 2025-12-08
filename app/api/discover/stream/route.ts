import { NextRequest } from "next/server";
import { runMultiPhaseDiscovery, type DiscoveryEvent } from "@/lib/discovery/discovery-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_IP_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Streaming discovery endpoint using SSE.
 * NOTE: True real-time streaming is limited by Next.js buffering.
 * Results are sent as they complete but may arrive in batches.
 */
export async function GET(request: NextRequest) {
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

  // Collect all events, then stream them
  const events: DiscoveryEvent[] = [];
  
  await runMultiPhaseDiscovery(baseIp, start, end, (event: DiscoveryEvent) => {
    events.push(event);
  });

  // Build SSE response with all events
  const encoder = new TextEncoder();
  const lines: string[] = [];
  
  for (const event of events) {
    lines.push(`data: ${JSON.stringify(event)}\n\n`);
  }
  
  const body = lines.join("");

  return new Response(encoder.encode(body), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      "Connection": "keep-alive",
    },
  });
}
