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
