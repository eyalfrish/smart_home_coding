import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/panels/rename
 * Proxies a device label rename request to a panel's /api/device-label endpoint.
 * This avoids CORS issues since the request goes server-to-server.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ip, type, index, name } = body;

    if (!ip || typeof ip !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'ip' parameter" },
        { status: 400 }
      );
    }

    if (!type || !["relay", "curtain", "contact", "scene"].includes(type)) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'type' parameter" },
        { status: 400 }
      );
    }

    if (typeof index !== "number" || index < 0) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'index' parameter" },
        { status: 400 }
      );
    }

    if (typeof name !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'name' parameter" },
        { status: 400 }
      );
    }

    console.log(`[Rename] Renaming ${type} ${index} on ${ip} to "${name}"`);

    // Make the request to the panel's device-label API
    const panelUrl = `http://${ip}/api/device-label`;
    const panelResponse = await fetch(panelUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, index, name }),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!panelResponse.ok) {
      const errorText = await panelResponse.text().catch(() => "Unknown error");
      console.error(`[Rename] Panel returned ${panelResponse.status}: ${errorText}`);
      return NextResponse.json(
        { success: false, error: `Panel returned ${panelResponse.status}` },
        { status: 502 }
      );
    }

    const result = await panelResponse.json().catch(() => ({}));
    console.log(`[Rename] Success:`, result);

    return NextResponse.json({
      success: true,
      ip,
      type,
      index,
      name,
      panelResponse: result,
    });
  } catch (error) {
    console.error("[Rename] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

