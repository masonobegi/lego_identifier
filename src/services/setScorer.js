// Given a map of partId -> [sets], score each set by how many unique parts it contains.
// Returns sorted array: [{ set, matchedParts, totalIdentified, score }, ...]
export function scoreSetsByParts(partToSetsMap) {
  const setMap = {}; // setNum -> { set, matchedPartIds }

  for (const [partId, sets] of Object.entries(partToSetsMap)) {
    for (const set of sets) {
      if (!setMap[set.set_num]) {
        setMap[set.set_num] = { set, matchedPartIds: new Set() };
      }
      setMap[set.set_num].matchedPartIds.add(partId);
    }
  }

  const totalIdentified = Object.keys(partToSetsMap).length;

  return Object.values(setMap)
    .map(({ set, matchedPartIds }) => ({
      set,
      matchedParts: matchedPartIds.size,
      totalIdentified,
      score: matchedPartIds.size / totalIdentified,
    }))
    .sort((a, b) => b.matchedParts - a.matchedParts || b.set.num_parts - a.set.num_parts);
}
