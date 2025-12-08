import { getServerSessionId } from "@/lib/discovery/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the current server session ID.
 * Clients can use this to detect server restarts.
 */
export async function GET() {
  return new Response(
    JSON.stringify({ sessionId: getServerSessionId() }),
    {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store",
      },
    }
  );
}

