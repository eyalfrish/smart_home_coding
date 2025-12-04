import { NextRequest } from "next/server";
import { getPanelRegistry } from "@/lib/discovery/panel-registry";
import type { SSEMessage } from "@/lib/discovery/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE endpoint for streaming real-time panel updates.
 * 
 * Query parameters:
 * - ips: Comma-separated list of panel IPs to connect to (e.g., "10.88.99.201,10.88.99.203")
 * 
 * Example: GET /api/panels/stream?ips=10.88.99.201,10.88.99.203
 */
export async function GET(request: NextRequest) {
  const registry = getPanelRegistry();

  // Check if WebSocket support is available
  if (!registry.isWebSocketAvailable()) {
    return new Response(
      JSON.stringify({ 
        error: "WebSocket package (ws) not installed",
        message: "Run: npm install ws @types/ws --save",
        hint: "After installing, restart the dev server"
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const ipsParam = searchParams.get("ips");

  if (!ipsParam) {
    return new Response(
      JSON.stringify({ error: "Missing 'ips' query parameter" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const ips = ipsParam
    .split(",")
    .map((ip) => ip.trim())
    .filter((ip) => isValidIp(ip));

  if (ips.length === 0) {
    return new Response(
      JSON.stringify({ error: "No valid IP addresses provided" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection message
      const initMessage: SSEMessage = {
        type: "heartbeat",
        ip: "",
        timestamp: Date.now(),
      };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(initMessage)}\n\n`)
      );

      // Define the listener for SSE events
      const listener = (message: SSEMessage) => {
        try {
          const sseData = `data: ${JSON.stringify(message)}\n\n`;
          controller.enqueue(encoder.encode(sseData));
        } catch (error) {
          console.error("[SSE] Error encoding message:", error);
        }
      };

      // Register listener
      registry.addListener(listener);

      // Disconnect panels not in the new list (cleanup stale connections)
      const currentIps = new Set(ips);
      const connectedIps = registry.getConnectedPanelIps();
      const staleIps = connectedIps.filter(ip => !currentIps.has(ip));
      if (staleIps.length > 0) {
        console.log(`[SSE] Cleaning up ${staleIps.length} stale panels`);
        staleIps.forEach(ip => registry.disconnectPanel(ip));
      }

      // Connect to requested panels
      console.log(`[SSE] Connecting to panels: ${ips.join(", ")}`);
      registry.connectPanels(ips);

      // Cleanup when the connection is closed
      request.signal.addEventListener("abort", () => {
        console.log("[SSE] Client disconnected");
        registry.removeListener(listener);
        
        // Keep panel connections alive for faster reconnection
        // They'll be cleaned up after a timeout or when server restarts
        // This allows quick recovery when client reconnects
        
        try {
          controller.close();
        } catch {
          // Controller might already be closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function isValidIp(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255;
  });
}

