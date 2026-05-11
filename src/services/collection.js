import AsyncStorage from '@react-native-async-storage/async-storage';

const COLLECTION_KEY = 'brick_id_collection';
const TRACKED_SETS_KEY = 'brick_id_tracked_sets';

// --- Collection (owned parts) ---

export async function getCollection() {
  const raw = await AsyncStorage.getItem(COLLECTION_KEY);
  return raw ? JSON.parse(raw) : {};
}

export async function addPartsToCollection(parts) {
  // parts: array of { id, name, img_url, ... }
  const collection = await getCollection();
  const now = Date.now();

  for (const part of parts) {
    if (!part?.id) continue;
    if (collection[part.id]) {
      collection[part.id].count += 1;
      collection[part.id].lastAdded = now;
    } else {
      collection[part.id] = {
        part: { id: part.id, name: part.name || part.id, img_url: part.img_url || null },
        count: 1,
        firstAdded: now,
        lastAdded: now,
      };
    }
  }

  await AsyncStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
  return collection;
}

export async function removePartFromCollection(partId) {
  const collection = await getCollection();
  delete collection[partId];
  await AsyncStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
  return collection;
}

export async function updatePartCount(partId, count) {
  const collection = await getCollection();
  if (!collection[partId]) return collection;
  if (count <= 0) {
    delete collection[partId];
  } else {
    collection[partId].count = count;
  }
  await AsyncStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
  return collection;
}

export async function clearCollection() {
  await AsyncStorage.removeItem(COLLECTION_KEY);
}

// --- Tracked sets (sets the user wants to complete) ---

export async function getTrackedSets() {
  const raw = await AsyncStorage.getItem(TRACKED_SETS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function addTrackedSet(set) {
  const sets = await getTrackedSets();
  if (sets.find((s) => s.set_num === set.set_num)) return sets;
  const updated = [...sets, { set_num: set.set_num, name: set.name, set_img_url: set.set_img_url, num_parts: set.num_parts, year: set.year }];
  await AsyncStorage.setItem(TRACKED_SETS_KEY, JSON.stringify(updated));
  return updated;
}

export async function removeTrackedSet(setNum) {
  const sets = await getTrackedSets();
  const updated = sets.filter((s) => s.set_num !== setNum);
  await AsyncStorage.setItem(TRACKED_SETS_KEY, JSON.stringify(updated));
  return updated;
}

// Given a set inventory (from Rebrickable) and the user's collection,
// returns { owned, total, missing: [partEntry], pct }
export function calculateSetProgress(inventory, collection) {
  let owned = 0;
  const missing = [];

  for (const entry of inventory) {
    const partNum = entry.part.part_num;
    const needed = entry.quantity;
    const have = collection[partNum]?.count || 0;

    if (have >= needed) {
      owned += needed;
    } else {
      owned += have;
      missing.push({ ...entry, have, stillNeed: needed - have });
    }
  }

  return {
    owned,
    total: inventory.reduce((sum, e) => sum + e.quantity, 0),
    missing,
    pct: inventory.length === 0 ? 0 : Math.round((owned / inventory.reduce((sum, e) => sum + e.quantity, 0)) * 100),
  };
}
