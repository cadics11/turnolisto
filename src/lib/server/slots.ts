import { db, save, uid, type Clinic } from './store.ts';

/** Adds open slots for a clinic (skips past times and duplicates). Returns how many were added. */
export function addSlots(clinic: Clinic, starts: string[], durationMin: number): number {
const d = db();
let added = 0;
for (const startsAt of starts) {
if (new Date(startsAt).getTime() < Date.now()) continue;
if (d.slots.some((s) => s.clinicId === clinic.id && s.startsAt === startsAt)) continue;
d.slots.push({
id: uid(),
clinicId: clinic.id,
startsAt,
durationMin,
acceptedPlans: [...clinic.acceptedPlans],
status: 'open',
requestId: null
});
added++;
}
save();
return added;
}
