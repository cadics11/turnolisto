// Where clinics and patients are, for approximate distances. Exact coordinates win;
// otherwise the center of the town is used.
import { TOWN_COORDS, normalize } from '../constants.ts';
import { milesBetween, validCoords, type Coords } from '../geo.ts';
import { db, type Clinic } from './store.ts';

/** A clinic outside the patient's region still counts when it is at most this many miles away. */
export const NEARBY_MILES = 25;

export function clinicCoords(c: Clinic): Coords | null {
	return validCoords(c.lat, c.lng) ?? TOWN_COORDS[normalize(c.town)] ?? null;
}

/** The patient's saved location, or the center of the town they asked for. */
export function patientOrigin(userId: string, town?: string): Coords | null {
	const user = db().users.find((u) => u.id === userId);
	const saved = user ? validCoords(user.lat, user.lng) : null;
	return saved ?? (town ? (TOWN_COORDS[normalize(town)] ?? null) : null);
}

export function milesToClinic(userId: string, town: string | undefined, clinic: Clinic): number | null {
	const from = patientOrigin(userId, town);
	const to = clinicCoords(clinic);
	return from && to ? milesBetween(from, to) : null;
}

/** Same region as the request, or close enough by distance. */
export function closeEnough(region: string, clinic: Clinic, miles: number | null): boolean {
	return clinic.region === region || (miles !== null && miles <= NEARBY_MILES);
}
