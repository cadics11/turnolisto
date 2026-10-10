// Shared lists used by both the server (parsing, matching) and the UI.

export const SPECIALTIES = [
	'Ortodoncia',
	'Neurología',
	'Cardiología',
	'Dermatología',
	'Endocrinología',
	'Gastroenterología',
	'Ortopedia',
	'Psiquiatría'
] as const;

export const REGIONS = ['Norte', 'Sur', 'Este', 'Oeste', 'Metro', 'Centro'] as const;

export const PLANS = ['Triple-S', 'MCS', 'Plan Vital', 'First Medical', 'Medicare Advantage'] as const;

/** Town → region. Keys are lowercase without accents (see `normalize`). */
export const TOWN_REGION: Record<string, string> = {
	arecibo: 'Norte',
	manati: 'Norte',
	hatillo: 'Norte',
	camuy: 'Norte',
	'vega baja': 'Norte',
	'vega alta': 'Norte',
	barceloneta: 'Norte',
	ponce: 'Sur',
	'juana diaz': 'Sur',
	guayama: 'Sur',
	salinas: 'Sur',
	yauco: 'Sur',
	humacao: 'Este',
	fajardo: 'Este',
	'rio grande': 'Este',
	yabucoa: 'Este',
	mayaguez: 'Oeste',
	aguadilla: 'Oeste',
	'san german': 'Oeste',
	'cabo rojo': 'Oeste',
	'san juan': 'Metro',
	bayamon: 'Metro',
	carolina: 'Metro',
	guaynabo: 'Metro',
	'toa baja': 'Metro',
	caguas: 'Centro',
	cayey: 'Centro',
	aibonito: 'Centro',
	barranquitas: 'Centro'
};

/** Pretty town names for display. */
export const TOWN_LABEL: Record<string, string> = {
	arecibo: 'Arecibo',
	manati: 'Manatí',
	hatillo: 'Hatillo',
	camuy: 'Camuy',
	'vega baja': 'Vega Baja',
	'vega alta': 'Vega Alta',
	barceloneta: 'Barceloneta',
	ponce: 'Ponce',
	'juana diaz': 'Juana Díaz',
	guayama: 'Guayama',
	salinas: 'Salinas',
	yauco: 'Yauco',
	humacao: 'Humacao',
	fajardo: 'Fajardo',
	'rio grande': 'Río Grande',
	yabucoa: 'Yabucoa',
	mayaguez: 'Mayagüez',
	aguadilla: 'Aguadilla',
	'san german': 'San Germán',
	'cabo rojo': 'Cabo Rojo',
	'san juan': 'San Juan',
	bayamon: 'Bayamón',
	carolina: 'Carolina',
	guaynabo: 'Guaynabo',
	'toa baja': 'Toa Baja',
	caguas: 'Caguas',
	cayey: 'Cayey',
	aibonito: 'Aibonito',
	barranquitas: 'Barranquitas'
};

export const OFFER_MINUTES = 30;

/** Lowercase, strip accents, collapse spaces. */
export function normalize(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function formatPhone(digits: string): string {
	const d = digits.replace(/\D/g, '').slice(-10);
	if (d.length !== 10) return digits;
	return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

export function formatSlot(iso: string): { day: string; time: string; full: string } {
	const d = new Date(iso);
	const day = d.toLocaleDateString('es-PR', { weekday: 'short', day: 'numeric', month: 'short' });
	const time = d.toLocaleTimeString('es-PR', { hour: 'numeric', minute: '2-digit' });
	const full = d.toLocaleString('es-PR', {
		weekday: 'long',
		day: 'numeric',
		month: 'short',
		hour: 'numeric',
		minute: '2-digit'
	});
	return { day, time, full };
}

/** Approximate town centers, used when a clinic or patient has not set exact coordinates. Same keys as TOWN_REGION. */
export const TOWN_COORDS: Record<string, { lat: number; lng: number }> = {
	arecibo: { lat: 18.4725, lng: -66.7157 },
	manati: { lat: 18.4272, lng: -66.4919 },
	hatillo: { lat: 18.4864, lng: -66.8255 },
	camuy: { lat: 18.4839, lng: -66.8449 },
	'vega baja': { lat: 18.4444, lng: -66.3877 },
	'vega alta': { lat: 18.4122, lng: -66.3314 },
	barceloneta: { lat: 18.4505, lng: -66.5388 },
	ponce: { lat: 18.0111, lng: -66.6141 },
	'juana diaz': { lat: 18.0536, lng: -66.5066 },
	guayama: { lat: 17.9841, lng: -66.1138 },
	salinas: { lat: 17.9777, lng: -66.2972 },
	yauco: { lat: 18.035, lng: -66.8499 },
	humacao: { lat: 18.1497, lng: -65.8274 },
	fajardo: { lat: 18.3258, lng: -65.6524 },
	'rio grande': { lat: 18.3802, lng: -65.8312 },
	yabucoa: { lat: 18.0505, lng: -65.8793 },
	mayaguez: { lat: 18.2013, lng: -67.1397 },
	aguadilla: { lat: 18.4274, lng: -67.1541 },
	'san german': { lat: 18.0808, lng: -67.0411 },
	'cabo rojo': { lat: 18.0866, lng: -67.1457 },
	'san juan': { lat: 18.4655, lng: -66.1057 },
	bayamon: { lat: 18.3985, lng: -66.1557 },
	carolina: { lat: 18.3808, lng: -65.9574 },
	guaynabo: { lat: 18.3575, lng: -66.1111 },
	'toa baja': { lat: 18.4444, lng: -66.2546 },
	caguas: { lat: 18.2341, lng: -66.0485 },
	cayey: { lat: 18.1119, lng: -66.166 },
	aibonito: { lat: 18.14, lng: -66.266 },
	barranquitas: { lat: 18.1863, lng: -66.3066 }
};
