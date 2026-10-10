// Small geographic helpers shared by the server and the UI.
// Distances are straight-line (haversine) miles: an approximation, not driving distance.

export type Coords = { lat: number; lng: number };

/** Returns coordinates only when both values are finite numbers (or numeric strings) in range. */
export function validCoords(lat: unknown, lng: unknown): Coords | null {
	const la = typeof lat === 'string' ? parseFloat(lat) : lat;
	const ln = typeof lng === 'string' ? parseFloat(lng) : lng;
	if (typeof la !== 'number' || typeof ln !== 'number') return null;
	if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
	if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
	return { lat: la, lng: ln };
}

/** Parses the lat/lng text inputs of a form. Both blank means "no location". */
export function parseCoordsForm(latRaw: unknown, lngRaw: unknown): { coords: Coords | null } | { error: string } {
	const lat = String(latRaw ?? '').trim();
	const lng = String(lngRaw ?? '').trim();
	if (!lat && !lng) return { coords: null };
	const coords = validCoords(lat, lng);
	if (!coords) return { error: 'La ubicación no es válida. Usa latitud y longitud, por ejemplo 18.4655 y -66.1057.' };
	return { coords };
}

const EARTH_RADIUS_MILES = 3958.8;

export function milesBetween(a: Coords, b: Coords): number {
	const rad = (d: number) => (d * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "4.2 mi" or an empty string when the distance is unknown. */
export function formatMiles(miles: number | null | undefined): string {
	if (miles === null || miles === undefined) return '';
	return miles < 0.1 ? 'menos de 0.1 mi' : `${miles.toFixed(1)} mi`;
}
