import { HubChat } from "@/components/RoomPanels";

/** Volunteer Hub: the always-available common room for all volunteers and coordinators. */
export default function Hub() {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <h1 className="text-2xl font-bold">Volunteer Hub</h1>
      <p className="text-sm text-slate-600">
        One room for every volunteer and coordinator, with or without an assignment. Coordinators can broadcast here.
        SOS alerts appear here without exact locations; verified responders get the details in their alerts.
      </p>
      <HubChat />
    </div>
  );
}
