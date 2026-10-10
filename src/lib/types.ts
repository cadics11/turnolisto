// Types shared by the server and the UI.

/** One bookable opening shown to a patient (no private data about anyone). */
export type OpeningCard = {
	slotId: string;
	clinic: string;
	town: string;
	address: string;
	startsAt: string;
	/** Human readable date and time, e.g. "martes, 14 oct, 2:00 p. m.". */
	when: string;
	/** Straight-line miles from the patient, or null when either location is unknown. */
	miles: number | null;
	/** "3.2 mi" or an empty string. */
	distance: string;
};
