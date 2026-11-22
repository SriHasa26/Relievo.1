// EMERGENCY SOS. The SOS path never waits for AI, speech recognition or an upload:
//   1. startSos      creates a Critical incident at once and alerts responders (notifications + Volunteer Hub message)
//   2. attachSosAudio  later adds the recorded clip and transcript, alerts again, and runs the AI analysis in the background
// AI may add detail afterwards but can never lower the priority below Critical. Audio is private: only the backend can read it
// and only coordinators, VERIFIED volunteers and the citizen who recorded it are served it.
import { getRepo, logEvent, newId } from "../store/repo";
import { extractIncident, keywordExtract } from "./extraction";
import { HttpError, activeAssignment, canSee, getIncident } from "./incidents";
import { coordinators, notifyUsers, safely, volunteers } from "./notifications";
import { postHubAlert } from "./rooms";
import type { Incident, SosAudio, User } from "../types";

export const MAX_AUDIO_BYTES = 1_500_000; // about 1.5 MB: far more than 45 s of Opus/AAC needs
export const MAX_AUDIO_SECONDS = 46;
const FALLBACK_CENTER = { lat: 17.412, lng: 78.468 }; // the demo area, used only when nothing better is known
const SOS_TEXT = "EMERGENCY SOS. The citizen pressed the SOS button and needs urgent help. Audio and a transcript may follow.";

const activeSosOf = async (userId: string) =>
  (await (await getRepo()).incidents()).find((i) => i.reporter_id === userId && i.is_sos && i.sos_status === "active");

export interface SosInput { lat?: number; lng?: number; address_text?: string }

/** Create the SOS. One active SOS per citizen: a second tap returns the one already running. */
export async function startSos(user: User, input: SosInput): Promise<{ incident: Incident; existing: boolean }> {
  const repo = await getRepo();
  const running = await activeSosOf(user.id);
  if (running) return { incident: running, existing: true };

  let { lat, lng } = input;
  let approximate = false;
  let address = input.address_text?.trim() ?? "";
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat!) > 90 || Math.abs(lng!) > 180) {
    // no usable device location: fall back to the citizen's last reported place, then to the demo area
    const last = (await repo.incidents()).filter((i) => i.reporter_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    ({ lat, lng } = last ?? FALLBACK_CENTER);
    approximate = true;
    address = last?.address_text ? `Near ${last.address_text} (approximate)` : "Approximate location";
  } else if (!address) address = "Shared device location";

  const x = keywordExtract(SOS_TEXT).extraction;
  const incident: Incident = {
    id: newId(), reporter_id: user.id, original_text: SOS_TEXT, title: "EMERGENCY SOS",
    category: "other", urgency: "critical", people_affected: null, needs: [], vulnerable_persons: [],
    lat: lat!, lng: lng!, address_text: address, status: "submitted", reject_reason: null, possible_duplicate_of: null,
    is_synthetic: user.is_synthetic, created_at: new Date().toISOString(),
    is_sos: true, sos_status: "active", sos_approximate: approximate,
  };
  await repo.addIncident(incident);
  await repo.saveAnalysis({
    incident_id: incident.id, confidence: 1, model_version: "sos-rule", source: "fallback",
    extracted_data: { ...x, category: "other", urgency: "critical", summary: "EMERGENCY SOS", requires_human_verification: true },
  });
  await logEvent(incident.id, user.id, "submitted");
  await logEvent(incident.id, user.id, "sos_started", { approximate });

  await safely(async () => {
    const where = approximate ? `${address}` : address;
    const full = {
      type: "sos" as const, priority: "critical" as const, incident_id: incident.id,
      title: `EMERGENCY SOS from ${user.name}`,
      body: `${where}. A recording may follow.`, data: { sos: true, approximate },
    };
    await notifyUsers([...(await coordinators()), ...(await volunteers(true))], full);
    // unverified volunteers: a generic alert only (no incident, no location, no audio)
    await notifyUsers(await volunteers(false), {
      type: "sos", priority: "high", incident_id: null, title: "SOS nearby",
      body: "A citizen nearby has asked for urgent help. Verified responders have been alerted.", data: { sos: true, generic: true },
    });
  });
  // the Hub includes unverified volunteers, so its message carries no location
  await safely(() => postHubAlert("SOS alert: a citizen needs urgent help. Verified responders: open your alerts for the location and any audio."));
  return { incident, existing: false };
}

export interface AudioInput { audio_base64?: unknown; mime?: unknown; duration_s?: unknown; transcript?: unknown }

/** Add the recorded clip and transcript to the citizen's own active SOS. */
export async function attachSosAudio(user: User, incidentId: string, input: AudioInput) {
  const incident = await getIncident(incidentId);
  if (!incident.is_sos || incident.reporter_id !== user.id) throw new HttpError(403, "This is not your SOS");
  if (incident.sos_status !== "active") throw new HttpError(409, "This SOS has already ended");
  const mime = typeof input.mime === "string" && /^audio\/[a-z0-9.+-]+(;.*)?$/i.test(input.mime) ? input.mime.split(";")[0]!.toLowerCase() : null;
  if (!mime) throw new HttpError(400, "The recording must be an audio file");
  const b64 = typeof input.audio_base64 === "string" ? input.audio_base64 : "";
  if (!b64) throw new HttpError(400, "No audio received");
  const size = Math.floor((b64.length * 3) / 4);
  if (size > MAX_AUDIO_BYTES) throw new HttpError(413, "The recording is too large. Keep it under 45 seconds.");
  const transcript = typeof input.transcript === "string" ? input.transcript.trim().slice(0, 2000) : "";
  const seconds = Math.min(MAX_AUDIO_SECONDS, Math.max(0, Number(input.duration_s) || 0));

  const clip: SosAudio = {
    incident_id: incident.id, mime, duration_s: seconds, size_bytes: size, transcript, data_base64: b64, created_at: new Date().toISOString(),
  };
  await (await getRepo()).saveSosAudio(clip);
  await logEvent(incident.id, user.id, "sos_audio_added", { seconds, has_transcript: transcript.length > 0 });

  await safely(async () => {
    await notifyUsers([...(await coordinators()), ...(await volunteers(true))], {
      type: "sos_audio", priority: "critical", incident_id: incident.id,
      title: `SOS audio available from ${user.name}`,
      body: transcript ? transcript.slice(0, 160) : "Audio was recorded (no transcript).",
      data: { sos: true, has_audio: true, transcript: transcript.slice(0, 400) },
    });
  });
  void analyzeSosLater(incident.id, transcript); // never blocks the response
  return { ok: true, size_bytes: size, seconds };
}

/** AI analysis of the SOS transcript, afterwards and in the background. It adds detail but never lowers the priority. */
export async function analyzeSosLater(incidentId: string, transcript: string) {
  try {
    if (transcript.trim().length < 8) return;
    const repo = await getRepo();
    const ai = await extractIncident(transcript); // falls back to keywords when the AI fails
    const incident = await repo.incident(incidentId);
    if (!incident) return;
    ai.extracted_data.urgency = "critical"; // an SOS stays Critical whatever the AI says
    await repo.saveAnalysis({ incident_id: incident.id, ...ai });
    incident.category = ai.extracted_data.category;
    incident.needs = ai.extracted_data.needs;
    incident.vulnerable_persons = ai.extracted_data.vulnerable_persons;
    if (ai.extracted_data.people_affected !== null) incident.people_affected = ai.extracted_data.people_affected;
    incident.urgency = "critical";
    incident.title = ai.extracted_data.summary || incident.title;
    await repo.saveIncident(incident);
    await logEvent(incident.id, null, "ai_analyzed", { source: ai.source, from: "sos_transcript" });
  } catch (e) {
    console.warn("SOS analysis failed:", (e as Error).message);
  }
}

/** Who may hear / read an SOS: the citizen who made it, every coordinator, and VERIFIED volunteers. */
async function assertSosViewer(user: User, incident: Incident) {
  if (!incident.is_sos) throw new HttpError(404, "No SOS audio for this incident");
  const ok = user.role === "coordinator" || incident.reporter_id === user.id || (user.role === "volunteer" && user.verified);
  if (!ok || !(await canSee(user, incident))) throw new HttpError(403, "You do not have access to this audio");
}

export async function getSosAudio(user: User, incidentId: string) {
  const incident = await getIncident(incidentId);
  await assertSosViewer(user, incident);
  const clip = await (await getRepo()).sosAudio(incident.id);
  if (!clip) throw new HttpError(404, "No audio has been recorded for this SOS yet");
  return { mime: clip.mime, buffer: Buffer.from(clip.data_base64, "base64"), transcript: clip.transcript };
}

/** SOS summary shown on the incident page (only to people allowed to see the incident). */
export async function sosInfo(user: User, incident: Incident) {
  if (!incident.is_sos) return null;
  const clip = await (await getRepo()).sosAudio(incident.id);
  const canHear = user.role === "coordinator" || incident.reporter_id === user.id || (user.role === "volunteer" && user.verified);
  return {
    status: incident.sos_status ?? "active", approximate: incident.sos_approximate === true,
    has_audio: Boolean(clip) && canHear, transcript: canHear ? clip?.transcript ?? "" : "", duration_s: clip?.duration_s ?? 0,
  };
}

/** "I am safe": the citizen ends their SOS. Responders are told. */
export async function cancelSos(user: User, incidentId: string) {
  const repo = await getRepo();
  const incident = await getIncident(incidentId);
  if (!incident.is_sos || incident.reporter_id !== user.id) throw new HttpError(403, "This is not your SOS");
  if (incident.sos_status !== "active") throw new HttpError(409, "This SOS has already ended");
  incident.sos_status = "cancelled";
  incident.status = "rejected";
  incident.reject_reason = "SOS cancelled by the citizen (marked safe).";
  await repo.saveIncident(incident);
  const active = await activeAssignment(incident.id);
  if (active) { active.status = "completed"; active.responded_at = new Date().toISOString(); await repo.saveAssignment(active); }
  await logEvent(incident.id, user.id, "sos_cancelled");
  await safely(async () => {
    await notifyUsers([...(await coordinators()), ...(await volunteers(true))], {
      type: "sos_cancelled", priority: "medium", incident_id: incident.id,
      title: `${user.name} says they are safe`, body: "The SOS was cancelled by the citizen. No further action is needed unless you hear otherwise.",
    });
  });
  await safely(() => postHubAlert("SOS update: the citizen reports they are safe. The SOS was cancelled."));
  return incident;
}
