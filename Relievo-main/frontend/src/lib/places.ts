// Seeded places (synthetic demo area) so a citizen can pick a location without clicking the map.
export interface Place { name: string; lat: number; lng: number }
export const PLACES: Place[] = [
  { name: "Riverside Colony", lat: 17.41, lng: 78.48 },
  { name: "Old Bazaar Road", lat: 17.415, lng: 78.472 },
  { name: "Hill View Apartments", lat: 17.398, lng: 78.465 },
  { name: "Canal Street", lat: 17.402, lng: 78.483 },
  { name: "Temple Ward", lat: 17.425, lng: 78.45 },
  { name: "Market Lane", lat: 17.407, lng: 78.476 },
  { name: "Garden Lane", lat: 17.433, lng: 78.442 },
];
export const MAP_CENTER: [number, number] = [17.412, 78.468];
