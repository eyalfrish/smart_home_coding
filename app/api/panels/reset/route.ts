import { getPanelRegistry } from "@/lib/discovery/panel-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reset the panel registry - disconnect all panels and clear state.
 * Call this when starting fresh (e.g., on page load before discovery).
 */
export async function POST() {
  const registry = getPanelRegistry();
  
  const previousCount = registry.getConnectedPanelIps().length;
  registry.reset();
  
  console.log(`[Reset] Panel registry cleared. Had ${previousCount} connections.`);
  
  return new Response(
    JSON.stringify({ 
      success: true, 
      message: `Cleared ${previousCount} panel connections` 
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

