// =============================================================================
// Shared Constants
// =============================================================================
// This file contains constants that can be safely imported by both
// client components and server-side code.

/**
 * Special zone name for the auto-generated "All" zone.
 * This zone contains ALL discovered switches and is:
 * - Always the leftmost (first) zone
 * - Non-editable (switches cannot be added or removed)
 * - Cannot be renamed or deleted
 * - Dynamically generated from discovered panels
 */
export const ALL_ZONE_NAME = 'All';
