import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../src/store/store";
import { buildSeed, uid } from "../src/store/seedData";
import { resetMockNexconn } from "../src/integrations/nexconn.adapter";
import { resetHubState } from "../src/services/rooms";
import { computePriority } from "../src/services/priority";
import { incidentDetail } from "../src/services/incidents";
import { listNotifications } from "../src/services/notifications";
import { analyzeSosLater, attachSosAudio, cancelSos, getSosAudio, sosInfo, startSos } from "../src/services/sos";

const user = (n: number) => db.users.find((u) => u.id === uid(n))!;
const citizen = () => user(1);
const priya = () => user(21);
const karthik = () => user(11); // verified volunteer
const divya = () => user(13);   // UNVERIFIED volunteer
const clip = (bytes = 1000) => ({ audio_base64: Buffer.alloc(bytes, 1).toString("base64"), mime: "audio/webm;codecs=opus", duration_s: 12, transcript: "Water is rising, my mother cannot walk" });

beforeEach(() => {
  resetDb(buildSeed());
  resetMockNexconn();
  resetHubState();
});

describe("SOS", () => {
  it("creates a Critical, SOS-flagged incident immediately, with no AI or audio needed", async () => {
    const { incident, existing } = await startSos(citizen(), { lat: 17.41, lng: 78.48 });
    expect(existing).toBe(false);
    expect(incident.is_sos).toBe(true);
    expect(incident.urgency).toBe("critical");
    expect(incident.sos_approximate).toBe(false);
    expect(computePriority(incident).level).toBe("critical");
    expect(computePriority(incident).score).toBeGreaterThanOrEqual(1000);
  });

  it("without a device location it falls back to the last place and marks it approximate", async () => {
    const { incident } = await startSos(citizen(), {});
    expect(incident.sos_approximate).toBe(true);
    expect(incident.address_text).toMatch(/approximate/i);
  });

  it("alerts all coordinators and all verified volunteers; unverified volunteers get a generic alert only", async () => {
    const { incident } = await startSos(citizen(), { lat: 17.41, lng: 78.48 });
    for (const u of [priya(), user(22), karthik(), user(14)]) {
      const n = (await listNotifications(u)).items.find((x) => x.type === "sos")!;
      expect(n.incident_id).toBe(incident.id);
      expect(n.priority).toBe("critical");
    }
    const generic = (await listNotifications(divya())).items.find((x) => x.type === "sos")!;
    expect(generic.incident_id).toBeNull();
    expect(generic.data.generic).toBe(true);
    expect(JSON.stringify(generic)).not.toContain(incident.address_text);
  });

  it("allows only one active SOS per citizen", async () => {
    const first = await startSos(citizen(), { lat: 17.41, lng: 78.48 });
    const second = await startSos(citizen(), { lat: 17.41, lng: 78.48 });
    expect(second.existing).toBe(true);
    expect(second.incident.id).toBe(first.incident.id);
    expect(db.incidents.filter((i) => i.is_sos)).toHaveLength(1);
  });

  it("attaches audio, notifies again and serves it only to authorised roles", async () => {
    const { incident } = await startSos(citizen(), { lat: 17.41, lng: 78.48 });
    await attachSosAudio(citizen(), incident.id, clip());
    const n = (await listNotifications(priya())).items.find((x) => x.type === "sos_audio")!;
    expect(n.data.has_audio).toBe(true);
    expect((await getSosAudio(priya(), incident.id)).buffer.length).toBe(1000);
    expect((await getSosAudio(karthik(), incident.id)).mime).toBe("audio/webm");
    expect((await getSosAudio(citizen(), incident.id)).transcript).toContain("Water is rising");
    await expect(getSosAudio(divya(), incident.id)).rejects.toThrow(/access/i);   // unverified volunteer
    await expect(getSosAudio(user(2), incident.id)).rejects.toThrow(/access/i);   // another citizen
    await expect(incidentDetail(divya(), incident.id)).rejects.toThrow();          // never sees the incident either
  });

  it("rejects oversized or non-audio uploads and other people's SOS", async () => {
    const { incident } = await startSos(citizen(), { lat: 17.41, lng: 78.48 });
    await expect(attachSosAudio(citizen(), incident.id, clip(2_000_000))).rejects.toThrow(/too large/i);
    await expect(attachSosAudio(citizen(), incident.id, { ...clip(), mime: "text/html" })).rejects.toThrow(/audio/i);
    await expect(attachSosAudio(user(2), incident.id, clip())).rejects.toThrow();
  });

  it("works without a transcript (transcription unsupported): the clip is still stored", async () => {
    const { incident } = await startSos(citizen(), { lat: 17.41, lng: 78.48 });
    await attachSosAudio(citizen(), incident.id, { ...clip(), transcript: "" });
    const info = await sosInfo(priya(), incident);
    expect(info?.has_audio).toBe(true);
    expect(info?.transcript).toBe("");
  });

  it("AI analysis adds detail afterwards but never lowers the priority below Critical", async () => {
    const { incident } = await startSos(citizen(), { lat: 17.41, lng: 78.48 });
    await analyzeSosLater(incident.id, "Just a small question about a leaking tap, nothing urgent at all");
    const after = db.incidents.find((i) => i.id === incident.id)!;
    expect(after.urgency).toBe("critical");
    expect(computePriority(after).level).toBe("critical");
    expect(db.analyses.find((a) => a.incident_id === incident.id)!.extracted_data.urgency).toBe("critical");
  });

  it("'I am safe' cancels the SOS, notifies responders and frees the citizen to start a new one", async () => {
    const { incident } = await startSos(citizen(), { lat: 17.41, lng: 78.48 });
    await cancelSos(citizen(), incident.id);
    expect(db.incidents.find((i) => i.id === incident.id)!.sos_status).toBe("cancelled");
    expect((await listNotifications(priya())).items.some((n) => n.type === "sos_cancelled")).toBe(true);
    await expect(cancelSos(user(2), incident.id)).rejects.toThrow();
    const again = await startSos(citizen(), { lat: 17.41, lng: 78.48 });
    expect(again.existing).toBe(false);
  });
});
