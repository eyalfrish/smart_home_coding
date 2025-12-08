import { getProgressStats } from "@/lib/discovery/discovery-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Progress polling endpoint for discovery.
 * Returns current scan progress and partial results.
 */
export async function GET() {
  const stats = getProgressStats();
  
  return new Response(
    JSON.stringify({
      ...stats,
      elapsed: stats.startTime ? Date.now() - stats.startTime : 0,
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

