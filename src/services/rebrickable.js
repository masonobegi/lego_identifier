import axios from 'axios';

const BASE_URL = 'https://rebrickable.com/api/v3/lego';
// Get a free key at rebrickable.com/api/
const API_KEY = process.env.EXPO_PUBLIC_REBRICKABLE_KEY || '';

const client = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `key ${API_KEY}` },
  timeout: 15000,
});

export async function searchSets(query) {
  const response = await client.get('/sets/', {
    params: { search: query, page_size: 20, ordering: '-year' },
  });
  return response.data.results;
}

export async function getSetInventory(setNum) {
  // setNum format: "75192-1"
  const response = await client.get(`/sets/${setNum}/parts/`, {
    params: { page_size: 500 },
  });
  return response.data.results;
}

export async function getPartDetails(partNum) {
  const response = await client.get(`/parts/${partNum}/`);
  return response.data;
}

export async function getSetsForPart(partNum) {
  const response = await client.get('/parts/', {
    params: { part_num: partNum, page_size: 1 },
  });
  if (!response.data.results.length) return [];

  const setsResponse = await client.get(`/parts/${partNum}/sets/`, {
    params: { page_size: 30, ordering: '-year' },
  });
  return setsResponse.data.results;
}

// Fetch sets for multiple part IDs in parallel.
// Returns { partId: [sets] } map — failed lookups are silently skipped.
export async function getSetsForParts(partIds) {
  const unique = [...new Set(partIds)];
  const results = await Promise.allSettled(
    unique.map(async (id) => ({ id, sets: await getSetsForPart(id) }))
  );

  const map = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.sets.length > 0) {
      map[r.value.id] = r.value.sets;
    }
  }
  return map;
}
