import { NextResponse } from "next/server";

export const runtime = "nodejs";

const FIRMWARE_REQUEST_TIMEOUT_MS = 60000; // 60 seconds for firmware upload

/**
 * POST /api/panels/firmware
 * 
 * Upload firmware file to a panel via HTTP POST to its /update endpoint.
 * The panel expects a multipart/form-data with the firmware file.
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FIRMWARE_REQUEST_TIMEOUT_MS);

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

      if (!response.ok) {
        return NextResponse.json(
          { success: false, error: `Failed to upload firmware: HTTP ${response.status}` },
          { status: 502 }
        );
      }

      return NextResponse.json({
        success: true,
        ip,
        message: "Firmware upload successful. Panel will restart automatically.",
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return NextResponse.json(
        { success: false, error: "Firmware upload timed out" },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

