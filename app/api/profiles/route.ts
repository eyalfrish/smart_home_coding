import { NextRequest, NextResponse } from "next/server";
import {
  getAllProfiles,
  createProfile,
  getDefaultProfileId,
} from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// GET /api/profiles - List all profiles
// =============================================================================

/**
 * Returns a list of all profiles with summary info (id, name, created_at).
 * Also returns the defaultProfileId.
 */
export async function GET() {
  try {
    const [profiles, defaultProfileId] = await Promise.all([
      getAllProfiles(),
      getDefaultProfileId(),
    ]);
    
    // Return only summary fields for list view
    const summary = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at,
    }));

    return NextResponse.json({ 
      profiles: summary,
      defaultProfileId,
    }, { status: 200 });
  } catch (error) {
    console.error("[API] GET /api/profiles - Error:", error);
    return NextResponse.json(
      { error: "Failed to load profiles" },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST /api/profiles - Create a new profile
// =============================================================================

interface CreateProfileBody {
  name?: string;
  ip_ranges?: string[];
}

/**
 * Creates a new profile.
 * Body: { name: string, ip_ranges?: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    let body: CreateProfileBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { name, ip_ranges } = body;

    // Validate name is provided and not empty
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Name is required and cannot be empty" },
        { status: 400 }
      );
    }

    const trimmedName = name.trim();

    // Check name uniqueness
    const existingProfiles = await getAllProfiles();
    const nameExists = existingProfiles.some(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (nameExists) {
      return NextResponse.json(
        { error: `A profile with the name "${trimmedName}" already exists` },
        { status: 409 }
      );
    }

    // Validate ip_ranges if provided
    if (ip_ranges !== undefined && !Array.isArray(ip_ranges)) {
      return NextResponse.json(
        { error: "ip_ranges must be an array of strings" },
        { status: 400 }
      );
    }

    // Validate each ip_range is a string
    if (ip_ranges && !ip_ranges.every((r) => typeof r === "string")) {
      return NextResponse.json(
        { error: "Each ip_range must be a string" },
        { status: 400 }
      );
    }

    // Create the profile
    const profile = await createProfile({
      name: trimmedName,
      ip_ranges: ip_ranges ?? [],
    });

    console.log(`[API] POST /api/profiles - Created profile: ${profile.name} (id: ${profile.id})`);

    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    console.error("[API] POST /api/profiles - Error:", error);
    return NextResponse.json(
      { error: "Failed to create profile" },
      { status: 500 }
    );
  }
}

