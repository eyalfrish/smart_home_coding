import { NextRequest, NextResponse } from "next/server";
import {
  getProfile,
  updateProfile,
  deleteProfile,
  getAllProfiles,
  DEFAULT_SECTION_ORDER,
} from "@/server/db";
import type { UpdateProfileData, DashboardSection, FullscreenSection } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parses and validates the profile ID from route params.
 */
function parseProfileId(idParam: string): { id: number | null; error: string | null } {
  const id = parseInt(idParam, 10);
  
  if (isNaN(id) || id < 1) {
    return { id: null, error: "Invalid profile ID. Must be a positive integer." };
  }
  
  return { id, error: null };
}

// =============================================================================
// GET /api/profiles/[id] - Get single profile
// =============================================================================

/**
 * Returns full profile data for a single profile.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const { id, error } = parseProfileId(idParam);
    
    if (error || id === null) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const profile = await getProfile(id);

    if (!profile) {
      return NextResponse.json(
        { error: `Profile with ID ${id} not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({ profile }, { status: 200 });
  } catch (error) {
    console.error("[API] GET /api/profiles/[id] - Error:", error);
    return NextResponse.json(
      { error: "Failed to get profile" },
      { status: 500 }
    );
  }
}

// =============================================================================
// PUT /api/profiles/[id] - Update profile (partial updates allowed)
// =============================================================================

interface UpdateProfileBody {
  name?: string;
  ip_ranges?: string[];
  favorites?: Record<string, Record<string, boolean>>;
  smart_switches?: Record<string, unknown>;
  section_order?: DashboardSection[];
  fullscreen_section?: FullscreenSection;
}

/**
 * Updates a profile. Supports partial updates.
 * Body: { name?, ip_ranges?, favorites?, smart_switches? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const { id, error: idError } = parseProfileId(idParam);
    
    if (idError || id === null) {
      return NextResponse.json({ error: idError }, { status: 400 });
    }

    // Check profile exists
    const existingProfile = await getProfile(id);
    if (!existingProfile) {
      return NextResponse.json(
        { error: `Profile with ID ${id} not found` },
        { status: 404 }
      );
    }

    // Parse request body
    let body: UpdateProfileBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // Validate that at least one field is being updated
    const { name, ip_ranges, favorites, smart_switches, section_order, fullscreen_section } = body;
    
    if (
      name === undefined &&
      ip_ranges === undefined &&
      favorites === undefined &&
      smart_switches === undefined &&
      section_order === undefined &&
      fullscreen_section === undefined
    ) {
      return NextResponse.json(
        { error: "No fields to update. Provide at least one of: name, ip_ranges, favorites, smart_switches, section_order, fullscreen_section" },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: UpdateProfileData = {};

    // Validate and add name if provided
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return NextResponse.json(
          { error: "Name cannot be empty" },
          { status: 400 }
        );
      }

      const trimmedName = name.trim();

      // Check name uniqueness (excluding current profile)
      const allProfiles = await getAllProfiles();
      const nameExists = allProfiles.some(
        (p) => p.id !== id && p.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (nameExists) {
        return NextResponse.json(
          { error: `A profile with the name "${trimmedName}" already exists` },
          { status: 409 }
        );
      }

      updateData.name = trimmedName;
    }

    // Validate and add ip_ranges if provided
    if (ip_ranges !== undefined) {
      if (!Array.isArray(ip_ranges)) {
        return NextResponse.json(
          { error: "ip_ranges must be an array of strings" },
          { status: 400 }
        );
      }

      if (!ip_ranges.every((r) => typeof r === "string")) {
        return NextResponse.json(
          { error: "Each ip_range must be a string" },
          { status: 400 }
        );
      }

      updateData.ip_ranges = ip_ranges;
    }

    // Add favorites if provided (trust the structure for now)
    if (favorites !== undefined) {
      if (typeof favorites !== "object" || favorites === null) {
        return NextResponse.json(
          { error: "favorites must be an object" },
          { status: 400 }
        );
      }
      updateData.favorites = favorites;
    }

    // Add smart_switches if provided
    if (smart_switches !== undefined) {
      if (typeof smart_switches !== "object" || smart_switches === null) {
        return NextResponse.json(
          { error: "smart_switches must be an object" },
          { status: 400 }
        );
      }
      updateData.smart_switches = smart_switches;
    }

    // Add section_order if provided
    if (section_order !== undefined) {
      if (!Array.isArray(section_order)) {
        return NextResponse.json(
          { error: "section_order must be an array" },
          { status: 400 }
        );
      }

      // Validate that all sections are valid and unique
      const validSections = new Set(DEFAULT_SECTION_ORDER);
      const seenSections = new Set<string>();
      
      for (const section of section_order) {
        if (!validSections.has(section)) {
          return NextResponse.json(
            { error: `Invalid section: ${section}. Valid sections: ${DEFAULT_SECTION_ORDER.join(", ")}` },
            { status: 400 }
          );
        }
        if (seenSections.has(section)) {
          return NextResponse.json(
            { error: `Duplicate section: ${section}` },
            { status: 400 }
          );
        }
        seenSections.add(section);
      }

      // Ensure all sections are present
      if (section_order.length !== DEFAULT_SECTION_ORDER.length) {
        return NextResponse.json(
          { error: `section_order must contain all sections: ${DEFAULT_SECTION_ORDER.join(", ")}` },
          { status: 400 }
        );
      }

      updateData.section_order = section_order;
    }

    // Add fullscreen_section if provided
    if (fullscreen_section !== undefined) {
      // Validate that it's null or a valid section
      if (fullscreen_section !== null && fullscreen_section !== 'discovery' && fullscreen_section !== 'favorites') {
        return NextResponse.json(
          { error: `Invalid fullscreen_section: ${fullscreen_section}. Valid values: discovery, favorites, null` },
          { status: 400 }
        );
      }
      updateData.fullscreen_section = fullscreen_section;
    }

    // Perform update
    const updatedProfile = await updateProfile(id, updateData);

    if (!updatedProfile) {
      // Should not happen since we checked existence above, but handle anyway
      return NextResponse.json(
        { error: `Profile with ID ${id} not found` },
        { status: 404 }
      );
    }

    console.log(`[API] PUT /api/profiles/${id} - Updated profile: ${updatedProfile.name}`);

    return NextResponse.json({ profile: updatedProfile }, { status: 200 });
  } catch (error) {
    console.error("[API] PUT /api/profiles/[id] - Error:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE /api/profiles/[id] - Delete profile
// =============================================================================

/**
 * Deletes a profile by ID.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const { id, error } = parseProfileId(idParam);
    
    if (error || id === null) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const deleted = await deleteProfile(id);

    if (!deleted) {
      return NextResponse.json(
        { error: `Profile with ID ${id} not found` },
        { status: 404 }
      );
    }

    console.log(`[API] DELETE /api/profiles/${id} - Profile deleted`);

    return NextResponse.json(
      { message: `Profile ${id} deleted successfully` },
      { status: 200 }
    );
  } catch (error) {
    console.error("[API] DELETE /api/profiles/[id] - Error:", error);
    return NextResponse.json(
      { error: "Failed to delete profile" },
      { status: 500 }
    );
  }
}

