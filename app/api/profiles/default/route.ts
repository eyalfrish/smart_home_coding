import { NextRequest, NextResponse } from "next/server";
import {
  getDefaultProfileId,
  setDefaultProfileId,
} from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// GET /api/profiles/default - Get the default profile ID
// =============================================================================

/**
 * Returns the current default profile ID.
 */
export async function GET() {
  try {
    const defaultProfileId = await getDefaultProfileId();
    return NextResponse.json({ defaultProfileId }, { status: 200 });
  } catch (error) {
    console.error("[API] GET /api/profiles/default - Error:", error);
    return NextResponse.json(
      { error: "Failed to get default profile" },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH /api/profiles/default - Set the default profile ID
// =============================================================================

interface SetDefaultBody {
  profileId?: number | null;
}

/**
 * Sets the default profile ID.
 * Body: { profileId: number | null }
 * Pass null to clear the default.
 */
export async function PATCH(request: NextRequest) {
  try {
    // Parse request body
    let body: SetDefaultBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { profileId } = body;

    // Validate profileId is provided
    if (profileId === undefined) {
      return NextResponse.json(
        { error: "profileId is required (use null to clear default)" },
        { status: 400 }
      );
    }

    // Validate profileId is a number or null
    if (profileId !== null && (typeof profileId !== "number" || isNaN(profileId) || profileId < 1)) {
      return NextResponse.json(
        { error: "profileId must be a positive number or null" },
        { status: 400 }
      );
    }

    // Set the default profile
    const success = await setDefaultProfileId(profileId);

    if (!success) {
      return NextResponse.json(
        { error: `Profile with ID ${profileId} not found` },
        { status: 404 }
      );
    }

    console.log(`[API] PATCH /api/profiles/default - Set default profile to: ${profileId}`);

    return NextResponse.json({ 
      success: true,
      defaultProfileId: profileId,
    }, { status: 200 });
  } catch (error) {
    console.error("[API] PATCH /api/profiles/default - Error:", error);
    return NextResponse.json(
      { error: "Failed to set default profile" },
      { status: 500 }
    );
  }
}

