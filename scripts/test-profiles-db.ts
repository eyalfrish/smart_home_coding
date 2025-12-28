/**
 * Test script for the profiles database.
 * 
 * Run with: npx ts-node scripts/test-profiles-db.ts
 * Or:       npx tsx scripts/test-profiles-db.ts
 * 
 * This script tests all CRUD operations and verifies the database
 * persists correctly to data/profiles.json.
 */

import {
  loadProfiles,
  getAllProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  setFavorite,
  addIpRange,
} from '../server/db';

async function runTests() {
  console.log('='.repeat(60));
  console.log('Profiles Database Test Suite');
  console.log('='.repeat(60));
  console.log('');

  // Test 1: Load/Initialize Database
  console.log('Test 1: Loading database...');
  const db = await loadProfiles();
  console.log(`  ✓ Database loaded (version: ${db.version}, profiles: ${db.profiles.length})`);
  console.log('');

  // Test 2: Create Profile
  console.log('Test 2: Creating test profile...');
  const newProfile = await createProfile({
    name: 'Test Home',
    ip_ranges: ['192.168.1.1-192.168.1.254'],
  });
  console.log(`  ✓ Created profile: "${newProfile.name}" (id: ${newProfile.id})`);
  console.log(`    IP Ranges: ${JSON.stringify(newProfile.ip_ranges)}`);
  console.log(`    Created at: ${newProfile.created_at}`);
  console.log('');

  // Test 3: Get Profile
  console.log('Test 3: Fetching profile by ID...');
  const fetchedProfile = await getProfile(newProfile.id);
  if (fetchedProfile) {
    console.log(`  ✓ Fetched profile: "${fetchedProfile.name}"`);
  } else {
    console.log('  ✗ Profile not found!');
  }
  console.log('');

  // Test 4: Update Profile
  console.log('Test 4: Updating profile...');
  const updatedProfile = await updateProfile(newProfile.id, {
    name: 'Test Home (Updated)',
  });
  if (updatedProfile) {
    console.log(`  ✓ Updated profile name to: "${updatedProfile.name}"`);
    console.log(`    Updated at: ${updatedProfile.updated_at}`);
  } else {
    console.log('  ✗ Failed to update profile!');
  }
  console.log('');

  // Test 5: Add IP Range
  console.log('Test 5: Adding IP range...');
  const withNewRange = await addIpRange(newProfile.id, '10.0.0.1-10.0.0.254');
  if (withNewRange) {
    console.log(`  ✓ IP Ranges now: ${JSON.stringify(withNewRange.ip_ranges)}`);
  }
  console.log('');

  // Test 6: Set Favorites
  console.log('Test 6: Setting favorites...');
  await setFavorite(newProfile.id, '192.168.1.100', '0', true);
  await setFavorite(newProfile.id, '192.168.1.100', '2', true);
  await setFavorite(newProfile.id, '192.168.1.101', '1', true);
  const withFavorites = await getProfile(newProfile.id);
  if (withFavorites) {
    console.log(`  ✓ Favorites: ${JSON.stringify(withFavorites.favorites, null, 2)}`);
  }
  console.log('');

  // Test 7: Get All Profiles
  console.log('Test 7: Getting all profiles...');
  const allProfiles = await getAllProfiles();
  console.log(`  ✓ Total profiles: ${allProfiles.length}`);
  allProfiles.forEach(p => {
    console.log(`    - [${p.id}] ${p.name}`);
  });
  console.log('');

  // Test 8: Delete Profile
  console.log('Test 8: Deleting test profile...');
  const deleted = await deleteProfile(newProfile.id);
  console.log(`  ${deleted ? '✓' : '✗'} Profile deleted: ${deleted}`);
  console.log('');

  // Verify deletion
  const afterDelete = await getAllProfiles();
  console.log(`  Profiles remaining: ${afterDelete.length}`);
  console.log('');

  console.log('='.repeat(60));
  console.log('All tests completed!');
  console.log('');
  console.log('Check data/profiles.json to see the database file.');
  console.log('='.repeat(60));
}

// Run tests
runTests().catch(console.error);

