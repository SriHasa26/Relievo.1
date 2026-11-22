// Leaflet + OpenStreetMap (no API key). Circle markers avoid Leaflet's icon-image bundling issues.
// Look: themed tiles/controls (theme.css), pulsing radar rings on critical incidents, fly-to on selection,
// coverage circles around clusters of open incidents, an animated route line, and a drop-in pin for the location picker.
import { useEffect } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { URGENCY_COLOR } from "@/components/badges";
import { MAP_CENTER } from "@/lib/places";
import type { IncidentListItem } from "@/lib/types";
import { label } from "@/lib/utils";

const Tiles = () => (
  <TileLayer
    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  />
);

/* ---------- geometry helpers ---------- */
const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Point `km` away from `from` along `bearingDeg`. */
function destination(from: { lat: number; lng: number }, km: number, bearingDeg: number): [number, number] {
  const d = km / R, br = rad(bearingDeg), lat1 = rad(from.lat), lng1 = rad(from.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI];
}

const OPEN = ["submitted", "verified", "assigned", "in_progress"];
const levelOf = (i: IncidentListItem) => i.priority?.level ?? i.urgency;
/** Groups of 2+ open incidents within `km` of each other; each gets a centre and a coverage radius in metres. */
export function clusters(incidents: IncidentListItem[], km = 1.5) {
  const open = incidents.filter((i) => OPEN.includes(i.status));
  const used = new Set<string>();
  const out: Array<{ lat: number; lng: number; radius: number; count: number }> = [];
  for (const a of open) {
    if (used.has(a.id)) continue;
    const group = open.filter((b) => !used.has(b.id) && haversineKm(a, b) <= km);
    if (group.length < 2) continue;
    group.forEach((g) => used.add(g.id));
    const lat = group.reduce((s, g) => s + g.lat, 0) / group.length;
    const lng = group.reduce((s, g) => s + g.lng, 0) / group.length;
    const radius = Math.max(...group.map((g) => haversineKm({ lat, lng }, g))) * 1000 + 250;
    out.push({ lat, lng, radius, count: group.length });
  }
  return out;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo(target, Math.max(map.getZoom(), 14), { duration: 0.9 }); }, [map, target]);
  return null;
}

/** Incident map for the coordinator: one dot per incident coloured by urgency, radar rings on critical ones. */
export function IncidentMap({
  incidents, onSelect, selectedId, height = 380,
}: { incidents: IncidentListItem[]; onSelect?: (id: string) => void; selectedId?: string | null; height?: number }) {
  const picked = incidents.find((i) => i.id === selectedId);
  const target: [number, number] | null = picked ? [picked.lat, picked.lng] : null;
  return (
    <MapContainer center={MAP_CENTER} zoom={13} style={{ height: `${height / 16}rem` }} className="rounded-lg">
      <Tiles />
      <FlyTo target={target} />
      {clusters(incidents).map((c, i) => (
        <Circle key={`cl-${i}`} center={[c.lat, c.lng]} radius={c.radius}
          pathOptions={{ color: "#f2733a", weight: 1.5, dashArray: "4 6", fillColor: "#f2733a", fillOpacity: 0.08, className: "coverage" }}>
          <Tooltip direction="top">{c.count} open incidents in this area</Tooltip>
        </Circle>
      ))}
      {incidents.filter((i) => levelOf(i) === "critical" && OPEN.includes(i.status)).map((i) => (
        <CircleMarker key={`ring-${i.id}`} center={[i.lat, i.lng]} radius={10} interactive={false}
          pathOptions={{ color: URGENCY_COLOR.critical, fill: false, weight: 3, className: "pulse-ring" }} />
      ))}
      {incidents.map((i) => {
        const done = i.status === "resolved" || i.status === "rejected";
        return (
          <CircleMarker
            key={i.id} center={[i.lat, i.lng]} radius={i.id === selectedId ? 13 : done ? 6 : 10}
            pathOptions={{
              color: i.id === selectedId ? "#ffffff" : URGENCY_COLOR[levelOf(i)], weight: 3,
              fillColor: URGENCY_COLOR[levelOf(i)], fillOpacity: done ? 0.25 : 0.8, className: "coverage",
            }}
            eventHandlers={{ click: () => onSelect?.(i.id) }}
          >
            <Popup>
              <strong>{label(i.category)}</strong> · {levelOf(i)}<br />
              {label(i.status)}<br />
              {i.address_text}
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

function FitTo({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => { map.fitBounds(points, { padding: [40, 40], maxZoom: 15 }); }, [map, points]);
  return null;
}

/** Dispatch map on the incident page: an animated line from the volunteer to the incident.
 *  The line length is the real distance from the score breakdown. Volunteer positions are not exposed to the UI,
 *  so the direction is illustrative (and the tooltip says so). */
export function AssignmentMap({
  incident, volunteerName, distanceKm,
}: { incident: { lat: number; lng: number; category: string; urgency: IncidentListItem["urgency"] }; volunteerName: string; distanceKm: number }) {
  const from = destination(incident, Math.min(distanceKm, 25), 300);
  const to: [number, number] = [incident.lat, incident.lng];
  const points = [from, to];
  return (
    <MapContainer center={to} zoom={14} style={{ height: "16rem" }} className="rounded-lg" scrollWheelZoom={false}>
      <Tiles />
      <FitTo points={points} />
      <Polyline positions={points} pathOptions={{ color: "#f2733a", weight: 4, className: "route-line" }} />
      <CircleMarker center={to} radius={11} pathOptions={{ color: URGENCY_COLOR[incident.urgency], fillColor: URGENCY_COLOR[incident.urgency], fillOpacity: 0.85, className: "coverage" }}>
        <Tooltip permanent direction="top">{label(incident.category)} incident</Tooltip>
      </CircleMarker>
      <CircleMarker center={from} radius={8} pathOptions={{ color: "#14b8a6", fillColor: "#14b8a6", fillOpacity: 0.9, className: "vol-dot" }}>
        <Tooltip permanent direction="bottom">{volunteerName} · {distanceKm} km (direction illustrative)</Tooltip>
      </CircleMarker>
    </MapContainer>
  );
}

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

// Drop-in pin: a divIcon (no image files); the inner element carries the CSS animation and is re-created per position.
const pinIcon = L.divIcon({
  className: "",
  html: '<div class="pin-drop"><svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37C15 37 2 23 2 14a13 13 0 0 1 26 0c0 9-13 23-13 23z" fill="#f2733a" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg></div>',
  iconSize: [30, 38], iconAnchor: [15, 37],
});

/** Map where the citizen clicks to set the emergency location. */
export function LocationPicker({
  value, onChange,
}: { value: { lat: number; lng: number } | null; onChange: (lat: number, lng: number) => void }) {
  return (
    <MapContainer center={value ? [value.lat, value.lng] : MAP_CENTER} zoom={13} style={{ height: "17.5rem" }} className="rounded-lg">
      <Tiles />
      <ClickToPick onPick={onChange} />
      {value && <Marker key={`${value.lat}-${value.lng}`} position={[value.lat, value.lng]} icon={pinIcon} keyboard={false} />}
    </MapContainer>
  );
}
