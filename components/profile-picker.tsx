'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './discovery-dashboard.module.css';
import type { IpRange } from './discovery-form';

// =============================================================================
// Types
// =============================================================================

interface ProfileSummary {
  id: number;
  name: string;
  created_at: string;
}

export interface FullProfile {
  id: number;
  name: string;
  ip_ranges: string[];
  favorites: Record<string, unknown>;
  smart_switches: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ProfilePickerProps {
  /** Current form values ranges */
  currentRanges: IpRange[];
  /** Called when profile is selected with parsed IP ranges and full profile */
  onProfileSelect: (profileId: number, ranges: IpRange[], fullProfile: FullProfile) => void;
  /** Called after ranges are loaded to trigger discovery - receives the new ranges */
  onTriggerDiscovery: (ranges: IpRange[]) => void;
  /** Whether discovery is currently running */
  isLoading: boolean;
  /** Disabled state */
  disabled?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

let rangeIdCounter = 1000; // Start high to avoid conflicts with form's counter

/**
 * Parse an IP range string like "10.88.99.1-254" or "192.168.1.100-200"
 * into an IpRange object.
 */
function parseIpRangeString(rangeStr: string): IpRange | null {
  // Expected format: "octet1.octet2.octet3.start-end"
  // Examples: "10.88.99.1-254", "192.168.1.100-200"
  const match = rangeStr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})-(\d{1,3})$/);
  
  if (!match) {
    console.warn(`[ProfilePicker] Failed to parse IP range: ${rangeStr}`);
    return null;
  }

  const [, octet1, octet2, octet3, start, end] = match;
  
  return {
    id: `profile-range-${++rangeIdCounter}-${Date.now()}`,
    octet1,
    octet2,
    octet3,
    start,
    end,
  };
}

/**
 * Convert IpRange object to string format for storage.
 */
function ipRangeToString(range: IpRange): string {
  return `${range.octet1}.${range.octet2}.${range.octet3}.${range.start}-${range.end}`;
}

// =============================================================================
// ProfilePicker Component
// =============================================================================

export default function ProfilePicker({
  currentRanges,
  onProfileSelect,
  onTriggerDiscovery,
  isLoading,
  disabled = false,
}: ProfilePickerProps) {
  // State
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showNewProfileModal, setShowNewProfileModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // =============================================================================
  // Fetch profiles on mount
  // =============================================================================
  
  const fetchProfiles = useCallback(async () => {
    setIsFetching(true);
    setFetchError(null);
    
    try {
      const res = await fetch('/api/profiles');
      
      if (!res.ok) {
        throw new Error(`Failed to fetch profiles: ${res.status}`);
      }
      
      const data = await res.json();
      setProfiles(data.profiles || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profiles';
      console.error('[ProfilePicker] Fetch error:', message);
      setFetchError(message);
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // =============================================================================
  // Handle profile selection
  // =============================================================================
  
  const handleSelectChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    
    if (value === '') {
      // Placeholder selected, do nothing
      return;
    }
    
    if (value === 'new') {
      // Show new profile modal
      setShowNewProfileModal(true);
      setNewProfileName('');
      setCreateError(null);
      return;
    }
    
    const profileId = parseInt(value, 10);
    if (isNaN(profileId)) return;
    
    // Fetch full profile to get ip_ranges
    try {
      const res = await fetch(`/api/profiles/${profileId}`);
      
      if (!res.ok) {
        throw new Error(`Failed to load profile: ${res.status}`);
      }
      
      const data = await res.json();
      const profile = data.profile as FullProfile;
      
      // Parse IP ranges
      const parsedRanges: IpRange[] = [];
      for (const rangeStr of profile.ip_ranges) {
        const parsed = parseIpRangeString(rangeStr);
        if (parsed) {
          parsedRanges.push(parsed);
        }
      }
      
      // If no valid ranges, create a default one
      if (parsedRanges.length === 0) {
        parsedRanges.push({
          id: `profile-range-${++rangeIdCounter}-${Date.now()}`,
          octet1: '',
          octet2: '',
          octet3: '',
          start: '',
          end: '',
        });
      }
      
      setSelectedProfileId(profileId);
      
      // Call parent handlers with full profile data
      onProfileSelect(profileId, parsedRanges, profile);
      
      // Trigger discovery with the parsed ranges directly to avoid timing issues
      onTriggerDiscovery(parsedRanges);
      
    } catch (err) {
      console.error('[ProfilePicker] Load profile error:', err);
      // Don't update selection on error
    }
  };

  // =============================================================================
  // Handle new profile creation
  // =============================================================================
  
  const handleCreateProfile = async () => {
    const trimmedName = newProfileName.trim();
    
    if (!trimmedName) {
      setCreateError('Please enter a profile name');
      return;
    }
    
    setIsCreating(true);
    setCreateError(null);
    
    try {
      // Convert current ranges to string format
      const ipRangesStrings = currentRanges
        .filter(r => r.octet1 && r.octet2 && r.octet3 && r.start && r.end)
        .map(ipRangeToString);
      
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          ip_ranges: ipRangesStrings,
        }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to create profile: ${res.status}`);
      }
      
      const data = await res.json();
      const newProfile = data.profile as FullProfile;
      
      // Add to profiles list
      setProfiles(prev => [...prev, {
        id: newProfile.id,
        name: newProfile.name,
        created_at: newProfile.created_at,
      }]);
      
      // Select the new profile
      setSelectedProfileId(newProfile.id);
      
      // Close modal
      setShowNewProfileModal(false);
      setNewProfileName('');
      
      console.log(`[ProfilePicker] Created new profile: ${newProfile.name} (ID: ${newProfile.id})`);
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create profile';
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreating && newProfileName.trim()) {
      handleCreateProfile();
    }
    if (e.key === 'Escape') {
      setShowNewProfileModal(false);
    }
  };

  // =============================================================================
  // Render
  // =============================================================================
  
  return (
    <>
      {/* Profile Picker Section */}
      <div className={styles.profilePickerSection}>
        <div className={styles.profilePickerHeader}>
          <span className={styles.profilePickerIcon}>👤</span>
          <h3 className={styles.profilePickerTitle}>Profile</h3>
        </div>
        
        <div className={styles.profilePickerContent}>
          {isFetching ? (
            <div className={styles.profilePickerLoading}>
              <span className={styles.profilePickerSpinner}>⏳</span>
              <span className={styles.desktopText}>Loading profiles...</span>
              <span className={styles.mobileText}>Loading...</span>
            </div>
          ) : fetchError ? (
            <div className={styles.profilePickerError}>
              <span>⚠️ {fetchError}</span>
              <button 
                type="button"
                className={styles.profilePickerRetry}
                onClick={fetchProfiles}
              >
                Retry
              </button>
            </div>
          ) : (
            <select
              className={styles.profilePickerSelect}
              value={selectedProfileId ?? ''}
              onChange={handleSelectChange}
              disabled={disabled || isLoading}
              aria-label="Select profile"
            >
              <option value="">Select a profile...</option>
              {profiles.map(profile => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
              <option value="new">➕ New Profile...</option>
            </select>
          )}
        </div>
      </div>

      {/* New Profile Modal */}
      {showNewProfileModal && (
        <div 
          className={styles.modalOverlay}
          onClick={() => setShowNewProfileModal(false)}
        >
          <div 
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleModalKeyDown}
          >
            <h3>Create New Profile</h3>
            <p>
              This will save your current IP ranges to a new profile. 
              You can then quickly switch between profiles.
            </p>
            
            <div className={styles.modalForm}>
              <div className={styles.modalField}>
                <label htmlFor="profile-name">Profile Name</label>
                <input
                  id="profile-name"
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="e.g., Home, Office, Lab..."
                  autoFocus
                  disabled={isCreating}
                />
              </div>
              
              {createError && (
                <div className={styles.profilePickerModalError}>
                  ⚠️ {createError}
                </div>
              )}
            </div>
            
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalButtonSecondary}
                onClick={() => setShowNewProfileModal(false)}
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.modalButtonPrimary}
                onClick={handleCreateProfile}
                disabled={isCreating || !newProfileName.trim()}
              >
                {isCreating ? 'Creating...' : 'Create Profile'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

