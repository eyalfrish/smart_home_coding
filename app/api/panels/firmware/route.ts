import { NextResponse } from "next/server";

export const runtime = "nodejs";

const FIRMWARE_UPLOAD_TIMEOUT_MS = 30000; // 30 seconds for firmware upload
const FIRMWARE_REBOOT_WAIT_MS = 35000; // 35 seconds to wait for reboot
const VERSION_CHECK_INTERVAL_MS = 2000; // Check every 2 seconds
const VERSION_CHECK_TIMEOUT_MS = 3000; // Individual version check timeout

/**
 * Extract version from firmware filename.
 * Examples: "Cubixx_V3.26.9.bin" -> "3.26.9", "firmware_3.26.10.bin" -> "3.26.10"
 */
function extractVersionFromFilename(filename: string): string | null {
  // Remove .bin extension
  const nameWithoutExt = filename.replace(/\.bin$/i, "");
  // Find the last underscore and get everything after it
  const lastUnderscoreIdx = nameWithoutExt.lastIndexOf("_");
  if (lastUnderscoreIdx === -1) return null;
  
  let version = nameWithoutExt.slice(lastUnderscoreIdx + 1);
  // Remove leading "V" or "v" if present
  version = version.replace(/^[Vv]/, "");
  // Validate it looks like a version (at least X.Y format)
  if (!/^\d+\.\d+/.test(version)) return null;
  
  return version;
}

/**
 * Try to read the current firmware version from a panel via WebSocket.
 * The panel only exposes version info via WebSocket full_state event.
 */
async function readPanelVersion(ip: string, timeoutMs: number): Promise<string | null> {
  // Dynamic import of ws package
  let WebSocket: typeof import('ws').default;
  try {
    WebSocket = (await import('ws')).default;
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const wsUrl = `ws://${ip}:81/`;
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { ws.close(); } catch { /* ignore */ }
        resolve(null);
      }
    }, timeoutMs);

    let ws: InstanceType<typeof WebSocket>;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      clearTimeout(timeout);
      resolve(null);
      return;
    }

    ws.on('open', () => {
      // Request full state to get version
      ws.send(JSON.stringify({ command: 'request_state' }));
    });

    ws.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // Check for full_state event with version, or system_boot event
        if (msg.event === 'full_state' && msg.version) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve(msg.version);
          }
        } else if (msg.event === 'system_boot' && msg.device?.version) {
          // system_boot also contains version
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve(msg.device.version);
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(null);
      }
    });

    ws.on('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(null);
      }
    });
  });
}

/**
 * Wait for panel to come back online with the expected version.
 */
async function waitForVersionUpdate(
  ip: string,
  expectedVersion: string,
  maxWaitMs: number
): Promise<{ success: boolean; actualVersion: string | null; timedOut: boolean }> {
  const startTime = Date.now();
  let lastVersion: string | null = null;
  
  while (Date.now() - startTime < maxWaitMs) {
    const version = await readPanelVersion(ip, VERSION_CHECK_TIMEOUT_MS);
    
    if (version) {
      lastVersion = version;
      if (version === expectedVersion) {
        return { success: true, actualVersion: version, timedOut: false };
      }
    }
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, VERSION_CHECK_INTERVAL_MS));
  }
  
  return { success: false, actualVersion: lastVersion, timedOut: true };
}

/**
 * POST /api/panels/firmware
 * 
 * Upload firmware file to a panel via HTTP POST to its /update endpoint.
 * The panel expects a multipart/form-data with the firmware file.
 * 
 * After upload, waits for the panel to reboot and verifies the new version.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const ip = formData.get("ip") as string;
    const firmwareFile = formData.get("firmware") as File | null;

    if (!ip || typeof ip !== "string") {
      return NextResponse.json(
        { success: false, error: "IP address is required." },
        { status: 400 }
      );
    }

    if (!firmwareFile) {
      return NextResponse.json(
        { success: false, error: "Firmware file is required." },
        { status: 400 }
      );
    }

    // Validate file extension
    if (!firmwareFile.name.toLowerCase().endsWith(".bin")) {
      return NextResponse.json(
        { success: false, error: "Firmware file must be a .bin file." },
        { status: 400 }
      );
    }

    // Extract expected version from filename
    const expectedVersion = extractVersionFromFilename(firmwareFile.name);

    if (!expectedVersion) {
      return NextResponse.json(
        { success: false, error: `Could not extract version from filename "${firmwareFile.name}". Expected format: Name_V1.2.3.bin or Name_1.2.3.bin` },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FIRMWARE_UPLOAD_TIMEOUT_MS);

    let uploadSucceeded = false;
    let uploadError: string | null = null;

    try {
      // Create form data for the panel
      const panelFormData = new FormData();
      panelFormData.append("firmware", firmwareFile, firmwareFile.name);

      // POST firmware to panel's /update endpoint
      const response = await fetch(`http://${ip}/update`, {
        method: "POST",
        body: panelFormData,
        signal: controller.signal,
      });

      if (response.ok) {
        uploadSucceeded = true;
      } else {
        uploadError = `HTTP ${response.status}`;
      }
    } catch (error) {
      // AbortError or connection reset is expected - panel likely started rebooting
      if ((error as Error).name === "AbortError" || (error as Error).message.includes("fetch failed")) {
        // This is expected! Panel is rebooting. We'll verify via version check.
        uploadSucceeded = true; // Tentatively assume upload worked
      } else {
        uploadError = (error as Error).message;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!uploadSucceeded && uploadError) {
      return NextResponse.json(
        { success: false, error: `Failed to upload firmware: ${uploadError}` },
        { status: 502 }
      );
    }

    // Wait for panel to reboot and verify version
    const verifyResult = await waitForVersionUpdate(ip, expectedVersion, FIRMWARE_REBOOT_WAIT_MS);

    if (verifyResult.success) {
      return NextResponse.json({
        success: true,
        ip,
        version: verifyResult.actualVersion,
        message: `Firmware upgrade successful. Panel now running version ${verifyResult.actualVersion}.`,
      });
    } else if (verifyResult.timedOut && !verifyResult.actualVersion) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Panel did not come back online after firmware upload. Please check the panel manually.",
          ip,
        },
        { status: 504 }
      );
    } else {
      return NextResponse.json(
        { 
          success: false, 
          error: `Version mismatch: expected ${expectedVersion}, got ${verifyResult.actualVersion || "unknown"}`,
          ip,
          expectedVersion,
          actualVersion: verifyResult.actualVersion,
        },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
