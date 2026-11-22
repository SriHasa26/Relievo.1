// Evaluator access: one synthetic demo account per role. These are the seeded demo accounts (see backend/src/store/seedData.ts),
// listed here as constants so the panel is visible even while the API is still waking up. They hold synthetic data only.
import type { Role } from "@/lib/types";

export const EVALUATOR_PASSWORD = "demo1234";
export interface EvaluatorAccount { role: Role; name: string; email: string; note: string }

export const EVALUATOR_ACCOUNTS: EvaluatorAccount[] = [
  { role: "citizen", name: "Asha Rao", email: "citizen1@demo.reliefrelay.test", note: "Send a request, follow it, chat with the volunteer." },
  { role: "volunteer", name: "Sana Khan", email: "volunteer14@demo.reliefrelay.test", note: "Verified volunteer: accept assignments, use rooms." },
  { role: "coordinator", name: "Coordinator Priya", email: "coordinator21@demo.reliefrelay.test", note: "Verify incidents, approve matches, run the board." },
  { role: "ngo", name: "Hope Relief Trust (NGO)", email: "ngo31@demo.reliefrelay.test", note: "See relief resources." },
];
