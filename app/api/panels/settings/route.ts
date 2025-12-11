import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SETTINGS_REQUEST_TIMEOUT_MS = 3000;

interface SettingsRequest {
  ip: string;
  operation: "set-logging-on" | "set-logging-off" | "set-longpress";
  longPressMs?: number;
}

/**
 * POST /api/panels/settings
 * 
 * Apply settings to a panel via HTTP POST to its /savesettings endpoint.
 * This is used for batch settings operations like logging and long press time.
 */
export async function POST(request: Request) {
  let body: SettingsRequest;

  try {
    body = (await request.json()) as SettingsRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const { ip, operation, longPressMs } = body;

  if (!ip || typeof ip !== "string") {
    return NextResponse.json(
      { success: false, error: "IP address is required." },
      { status: 400 }
    );
  }

  if (!operation) {
    return NextResponse.json(
      { success: false, error: "Operation is required." },
      { status: 400 }
    );
  }

  // First, fetch current settings to preserve other values
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SETTINGS_REQUEST_TIMEOUT_MS);

  try {
    // Get current settings page to extract existing values
    const getResponse = await fetch(`http://${ip}/settings`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!getResponse.ok) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch current settings: HTTP ${getResponse.status}` },
        { status: 502 }
      );
    }

    const html = await getResponse.text();

    // Parse current settings from HTML
    // Hostname: <input type="text" id="hostn" name="hostn" value="Entrance1">
    const hostnMatch = html.match(/id=["']hostn["'][^>]*value=["']([^"']*)["']/i);
    const hostname = hostnMatch ? hostnMatch[1] : "";

    // Current logging state: <select id="file_logging" name="file_logging">
    let currentLogging = false;
    const loggingSelectMatch = html.match(/<select[^>]*id=["']file_logging["'][^>]*>[\s\S]*?<\/select>/i);
    if (loggingSelectMatch) {
      currentLogging = /<option[^>]*value=["']1["'][^>]*selected/i.test(loggingSelectMatch[0]);
    }

    // Current long press time: <input type="number" id="long_press_duration" name="long_press_duration" value="1000">
    const lpMatch = html.match(/id=["']long_press_duration["'][^>]*value=["'](\d+)["']/i);
    let currentLongPress = lpMatch ? parseInt(lpMatch[1], 10) : 1000;

    // Build form data for POST
    const formData = new URLSearchParams();
    formData.append("hostn", hostname);

    // Apply operation
    let newLogging = currentLogging;
    let newLongPress = currentLongPress;

    switch (operation) {
      case "set-logging-on":
        newLogging = true;
        break;
      case "set-logging-off":
        newLogging = false;
        break;
      case "set-longpress":
        if (typeof longPressMs === "number" && longPressMs >= 100) {
          newLongPress = longPressMs;
        }
        break;
    }

    // Add logging as select value (0=disabled, 1=enabled)
    formData.append("file_logging", newLogging ? "1" : "0");

    // Add long press time
    formData.append("long_press_duration", String(newLongPress));

    // POST settings to panel (form action is /savesettings, not /settings)
    const postResponse = await fetch(`http://${ip}/savesettings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
      signal: controller.signal,
    });

    if (!postResponse.ok) {
      return NextResponse.json(
        { success: false, error: `Failed to save settings: HTTP ${postResponse.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      ip,
      operation,
      settings: {
        logging: newLogging,
        longPressMs: newLongPress,
      },
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return NextResponse.json(
        { success: false, error: "Request timed out" },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

