// In-memory data used when MOCK_DB=true (and by the unit tests, which read it directly). Plain arrays, no magic.
// The Supabase schema in /supabase/migrations mirrors these tables.
import { buildSeed, type SeedData } from "./seedData";

export let db: SeedData = buildSeed();

export function resetDb(seed: SeedData = buildSeed()) {
  db = seed;
}
