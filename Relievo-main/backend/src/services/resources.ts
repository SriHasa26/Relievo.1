// ResourceBridge (minimal): list relief stock and allocate some of it to an incident.
import { getRepo, logEvent, newId } from "../store/repo";
import { HttpError, getIncident } from "./incidents";
import { distanceKm } from "./matching";
import type { Category, Resource, ResourceAllocation, User } from "../types";

// Which kind of stock helps which kind of request.
const RESOURCE_FOR: Record<Category, Resource["resource_type"] | null> = {
  water: "water", food: "food", medical: "medicine", shelter: "shelter", rescue: null, other: null,
};

/** Stock list. With an incident id, each item also gets its distance and whether it fits the request. */
export async function listResources(incidentId?: string) {
  const repo = await getRepo();
  const incident = incidentId ? await getIncident(incidentId) : null;
  const [resources, organisations] = await Promise.all([repo.resources(), repo.organisations()]);
  return resources.map((r) => ({
    ...r,
    organisation: organisations.find((o) => o.id === r.organisation_id)?.name ?? "Unknown",
    distance_km: incident ? Math.round(distanceKm(incident, r) * 10) / 10 : null,
    relevant: incident ? RESOURCE_FOR[incident.category] === r.resource_type : null,
  }));
}

export async function allocateResource(
  coordinator: User, resourceId: string, incidentId: string, quantity: number,
): Promise<ResourceAllocation> {
  const repo = await getRepo();
  const resource = await repo.resource(resourceId);
  if (!resource) throw new HttpError(404, "Resource not found");
  const incident = await getIncident(incidentId);
  if (!["verified", "assigned", "in_progress"].includes(incident.status)) {
    throw new HttpError(409, "Resources can only be allocated to a verified, open incident");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) throw new HttpError(400, "Quantity must be a positive whole number");
  if (quantity > resource.quantity) throw new HttpError(409, `Only ${resource.quantity} ${resource.unit} available`);

  resource.quantity -= quantity;
  await repo.saveResource(resource);
  const allocation: ResourceAllocation = {
    id: newId(), incident_id: incident.id, resource_id: resource.id, allocated_quantity: quantity,
    allocated_by: coordinator.id, created_at: new Date().toISOString(),
  };
  await repo.addAllocation(allocation);
  await logEvent(incident.id, coordinator.id, "resource_allocated", { resource_id: resource.id, name: resource.name, quantity });
  return allocation;
}
