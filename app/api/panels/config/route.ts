import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CONFIG_REQUEST_TIMEOUT_MS = 10000; // 10 seconds

interface ConfigRequest {
  ip: string;
  operation: "backup" | "restore";
  configData?: string; // Base64 encoded config data for restore
  credentials?: { username: string; password: string }; // HTTP Basic Auth for backup
}

/**
 * POST /api/panels/config
 * 
 * Configuration operations for a panel:
 * - backup: Download panel configuration (requires HTTP Basic Auth)
 * - restore: Upload configuration to panel
 */
export async function POST(request: Request) {
  let body: ConfigRequest;

  try {
    body = (await request.json()) as ConfigRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const { ip, operation, configData, credentials } = body;

  if (!ip || typeof ip !== "string") {
    return NextResponse.json(
      { success: false, error: "IP address is required." },
      { status: 400 }
    );
  }

  if (!operation || !["backup", "restore"].includes(operation)) {
    return NextResponse.json(
      { success: false, error: "Operation must be one of: backup, restore." },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG_REQUEST_TIMEOUT_MS);

  try {
    switch (operation) {
      case "backup": {
        // Build headers with optional Basic Auth
        const headers: HeadersInit = {};
        if (credentials) {
          const authString = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
          headers["Authorization"] = `Basic ${authString}`;
        }

        // GET /backup to download configuration
        const response = await fetch(`http://${ip}/backup`, {
          method: "GET",
          headers,
          signal: controller.signal,
        });

        if (response.status === 401) {
          return NextResponse.json(
            { success: false, error: "Authentication required. Please provide valid credentials." },
            { status: 401 }
          );
        }

        if (!response.ok) {
          return NextResponse.json(
            { success: false, error: `Failed to backup config: HTTP ${response.status}` },
            { status: 502 }
          );
        }

        const configBuffer = await response.arrayBuffer();
        const configBase64 = Buffer.from(configBuffer).toString("base64");

        return NextResponse.json({
          success: true,
          ip,
          operation: "backup",
          configData: configBase64,
          contentType: response.headers.get("content-type") || "application/octet-stream",
        });
      }

      case "restore": {
        if (!configData) {
          return NextResponse.json(
            { success: false, error: "Config data is required for restore operation." },
            { status: 400 }
          );
        }

        // Decode base64 config data
        const configBuffer = Buffer.from(configData, "base64");

        // Create form data for upload
        const formData = new FormData();
        const configBlob = new Blob([configBuffer], { type: "application/octet-stream" });
        formData.append("config", configBlob, "config.bin");

        // POST to /restore
        const response = await fetch(`http://${ip}/restore`, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) {
          return NextResponse.json(
            { success: false, error: `Failed to restore config: HTTP ${response.status}` },
            { status: 502 }
          );
        }

        return NextResponse.json({
          success: true,
          ip,
          operation: "restore",
          message: "Configuration restored successfully. Panel will restart.",
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: "Unknown operation." },
          { status: 400 }
        );
    }
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

