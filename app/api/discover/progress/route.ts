import { getProgress } from "@/lib/discovery/discovery-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Progress polling endpoint for discovery.
 * Returns current scan progress and partial results.
 */
export async function GET() {
  const progress = getProgress();
  
  return new Response(
    JSON.stringify({
      isRunning: progress.isRunning,
      phase: progress.phase,
      totalIps: progress.totalIps,
      scannedCount: progress.scannedCount,
      panelsFound: progress.panelsFound,
      notPanels: progress.notPanels,
      noResponse: progress.noResponse,
      errors: progress.errors,
      partialResults: progress.partialResults,
      elapsed: progress.startTime ? Date.now() - progress.startTime : 0,
    }),
    {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store",
      },
    }
  );
}

