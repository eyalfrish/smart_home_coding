import { NextRequest } from "next/server";
import type { DiscoveryResult } from "@/lib/discovery/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_TIMEOUT_MS = 1000;          // Reliable timeout for panels (halved)
const RESCUE_TIMEOUT_MS = 750;            // Rescue timeout (halved)
const SETTINGS_REQUEST_TIMEOUT_MS = 600;  // Settings request timeout (halved)
const MAX_CONCURRENCY = 10;               // Lower concurrency = more reliable
const RETRY_LIMIT = 2;                    // 3 total attempts
const RETRY_DELAYS_MS = [100, 200, 300];  // Backoff delays (halved)
const BASE_IP_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Streaming discovery endpoint using SSE.
 * Results are sent as they complete, enabling progressive UI updates.
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

  // Validate
  if (!baseIp || !BASE_IP_REGEX.test(baseIp)) {
    return new Response(
      JSON.stringify({ error: "Invalid baseIp - must be 3 octets (e.g., 10.88.99)" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const start = parseInt(startStr ?? "1", 10);
  const end = parseInt(endStr ?? "254", 10);

  if (isNaN(start) || isNaN(end) || start < 0 || end > 254 || start > end) {
    return new Response(
      JSON.stringify({ error: "Invalid start/end range" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build target list
  const targets: string[] = [];
  for (let lastOctet = start; lastOctet <= end; lastOctet++) {
    targets.push(`${baseIp}.${lastOctet}`);
  }

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let completedCount = 0;
      
      // Use a queue with mutex-like behavior to avoid race conditions
      const pendingTargets = [...targets];
      
      const getNextTarget = (): string | null => {
        return pendingTargets.shift() ?? null;
      };

      const sendResult = (result: DiscoveryResult) => {
        completedCount++;
        // Log first result to verify it's being sent
        if (completedCount === 1) {
          console.log(`[Discovery Stream] First result: ${result.ip} = ${result.status}`);
        }
        const message = {
          type: "result",
          data: result,
          progress: { completed: completedCount, total: targets.length },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
      };

      const sendComplete = () => {
        const message = { type: "complete", total: targets.length };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
        controller.close();
      };

      // Small delay to ensure SSE connection is established on client
      await delay(50);
      
      // Send initial heartbeat to confirm connection
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`));

      // Track results for final rescue pass
      const resultsMap = new Map<string, DiscoveryResult>();
      
      // Worker function - processes IPs from the shared queue
      const worker = async () => {
        while (true) {
          const ip = getNextTarget();
          if (!ip) break;

          const result = await checkHostWithRetry(ip);
          resultsMap.set(ip, result);
          sendResult(result);
        }
      };

      // Run workers concurrently
      const workerCount = Math.min(MAX_CONCURRENCY, targets.length);
      const workers = Array.from({ length: workerCount }, () => worker());

      await Promise.all(workers);
      
      // Final rescue pass: retry no-response IPs in PARALLEL
      // This catches panels that were temporarily busy during initial scan
      const noResponseIps = Array.from(resultsMap.entries())
        .filter(([, result]) => result.status === "no-response")
        .map(([ip]) => ip);
      
      // Always do rescue pass if we have failures (up to 15 IPs for speed)
      if (noResponseIps.length > 0 && noResponseIps.length <= 25) {
        const rescueIps = noResponseIps.slice(0, 15);
        console.log(`[Discovery] Rescue pass for ${rescueIps.length}/${noResponseIps.length} IPs (parallel)`);
        
        // Run rescue checks in parallel
        const rescueResults = await Promise.all(
          rescueIps.map(ip => checkHostFast(ip))
        );
        
        for (const result of rescueResults) {
          if (result.status !== "no-response") {
            resultsMap.set(result.ip, result);
            const message = { type: "update", data: result };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
            console.log(`[Discovery] Rescue found: ${result.ip} = ${result.status}`);
          }
        }
      }
      
      sendComplete();
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

async function checkHostWithRetry(ip: string): Promise<DiscoveryResult> {
  let attempt = 0;
  let lastResult: DiscoveryResult = { ip, status: "no-response", errorMessage: "No response" };
  
  while (attempt <= RETRY_LIMIT) {
    const result = await checkHost(ip);
    lastResult = result;
    
    // Success or definitive result - return immediately
    if (result.status === "panel" || result.status === "not-panel") {
      return result;
    }
    
    // If error (not timeout), might be worth retrying
    // If no-response (timeout), definitely retry
    if (attempt < RETRY_LIMIT) {
      const delayMs = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await delay(delayMs);
    }
    attempt++;
  }
  
  return lastResult;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fast check for rescue pass - shorter timeout, no panel name fetch */
async function checkHostFast(ip: string): Promise<DiscoveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESCUE_TIMEOUT_MS);
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
      return {
        ip,
        status: panel ? "panel" : "not-panel",
        httpStatus: response.status,
        errorMessage: panel ? undefined : "HTML does not look like Cubixx",
        // Skip name fetch for speed
      };
    }

    return {
      ip,
      status: "error",
      httpStatus: response.status,
      errorMessage: `Unexpected HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ip,
      status: "no-response",
      errorMessage: (error as Error).name === "AbortError" ? "Request timed out" : (error as Error).message,
    };
  } finally {
    clearTimeout(timeout);
  }
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
        panelHtml: panel ? html : undefined,
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

async function fetchPanelName(ip: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SETTINGS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`http://${ip}/settings`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const html = await response.text();
    const match = html.match(/id=["']hostn["'][^>]*value=["']([^"']*)["']/i);
    return match ? match[1].trim() || null : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isPanelHtml(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes("cubixx") || lower.includes("cubixx controller");
}

