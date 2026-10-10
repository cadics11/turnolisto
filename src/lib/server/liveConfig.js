// Gemini Live setup shared by the token endpoint: system prompts, tool declarations and model.
// Server-only. The browser receives them locked inside a short-lived ephemeral token.
import { Type } from '@google/genai';

// gemini-2.0-flash-exp is retired. Override with GEMINI_LIVE_MODEL if Google renames the model.
export const DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

/** @param {Date} now */
export function buildInstructions(now) {
	// Puerto Rico date, not the server's (Vercel runs in UTC).
	const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Puerto_Rico' });
	const weekday = now.toLocaleDateString('es-PR', { weekday: 'long', timeZone: 'America/Puerto_Rico' });
	return {
		nueva: [
			'Eres el asistente de voz de TurnoListo en Puerto Rico. Ayudas a un paciente a pedir una cita con un especialista.',
			'Necesitas cinco datos: especialidad, pueblo o área, plan médico, días preferidos y si ya tiene el referido de su médico primario.',
			'Cada vez que el paciente te dé uno o más datos, llama a la función update_request con lo que dijo (solo los datos nuevos). La función te dirá qué falta y qué preguntar; sigue esas indicaciones.',
			'Haz una sola pregunta a la vez, con frases cortas, en español. No hables de funciones ni de procesos internos.',
			'No pidas el nombre ni el teléfono: ya están en el perfil del paciente.',
			'REGLA ESTRICTA: solo puedes mencionar oficinas, médicos, direcciones, horarios y distancias que te devuelva la función find_openings en esta conversación. Nunca inventes ni recomiendes médicos, clínicas, hospitales, teléfonos o páginas web que no vengan de esa función, y no uses tu conocimiento general para sugerir lugares.',
			'No hables de turnos ni de oficinas antes de que find_openings te devuelva resultados. Al leer los turnos usa el texto que te da la función, sin añadir ni cambiar nada.',
			'Si el paciente pregunta por un médico u oficina en particular, o por algo que no sea pedir una cita, responde que solo puedes ayudar con los turnos de las oficinas registradas en TurnoListo y vuelve a la pregunta pendiente.',
			'Cuando tengas los cinco datos, llama a find_openings. Si hay turnos, léelos en voz alta (máximo 3, con número, oficina, pueblo, distancia en millas, fecha y hora) y pregunta cuál quiere. Cuando elija, llama a choose_opening con su número.',
			'Si no hay turnos, o no quiere ninguno, ofrece ponerlo en lista de espera: cuando se abra un turno recibirá un aviso para reservarlo. Si acepta, llama a join_waitlist.',
			'Nunca guardes ni repitas síntomas, diagnósticos o medicamentos. No des consejo médico ni juzgues urgencia. Si describe una emergencia, llama a update_request con emergency=true y sigue sus indicaciones.'
		].join(' '),
		oficina: [
			'Eres el asistente de voz de TurnoListo para oficinas médicas en Puerto Rico. Ayudas a la oficina a publicar turnos disponibles.',
			`Hoy es ${weekday} ${today}. Si dicen un día de la semana, usa el próximo que venga. Las horas sin am/pm entre 1 y 7 son de la tarde.`,
			'Cuando tengas fecha y hora de inicio, llama a la función publish_slots (con la hora final, la cantidad de turnos o la duración si las dieron). Si falta la fecha o la hora de inicio, pregunta solo eso.',
			'Cuando la función termine, confirma en voz alta qué se publicó. Habla en español, con frases cortas. No hables de funciones ni de procesos internos.'
		].join(' '),
		default: 'Eres un asistente de voz amable de TurnoListo. Responde en español, con frases cortas.'
	};
}

const str = (/** @type {string} */ description) => ({ type: Type.STRING, description });

/**
 * Function declarations per page. The app validates every value again when the call runs.
 * @type {Record<string, import('@google/genai').FunctionDeclaration[]>}
 */
export const TOOLS = {
	nueva: [
		{
			name: 'update_request',
			description:
				'Guarda los datos de la solicitud de cita que el paciente acaba de decir. Envía solo los que dijo. Devuelve lo que falta y la próxima pregunta.',
			parameters: {
				type: Type.OBJECT,
				properties: {
					specialty: str(
						'Especialidad que el paciente nombró: Ortodoncia, Neurología, Cardiología, Dermatología, Endocrinología, Gastroenterología, Ortopedia o Psiquiatría. No la deduzcas de síntomas.'
					),
					town: str('Pueblo de Puerto Rico, por ejemplo Arecibo o San Juan.'),
					region: str('Área de la isla: Norte, Sur, Este, Oeste, Metro o Centro. Solo si no dio un pueblo.'),
					plan: str(
						'Plan médico: Triple-S, MCS, Plan Vital (también la Reforma o plan del gobierno), First Medical o Medicare Advantage.'
					),
					preferred_days: str('Días preferidos en texto corto en español, por ejemplo "Martes o jueves, tardes" o "Cualquier día".'),
					has_referral: { type: Type.BOOLEAN, description: 'true si ya tiene el referido de su médico primario, false si no.' },
					emergency: { type: Type.BOOLEAN, description: 'true solo si describe una emergencia médica o de salud mental.' }
				}
			}
		},
		{
			name: 'find_openings',
			description:
				'Busca hasta 3 turnos abiertos que coincidan con la solicitud (especialidad, plan y cercanía). Llámala cuando ya estén los cinco datos.',
			parameters: { type: Type.OBJECT, properties: {} }
		},
		{
			name: 'choose_opening',
			description: 'Reserva el turno que el paciente eligió entre los que acabas de leer.',
			parameters: {
				type: Type.OBJECT,
				properties: {
					number: { type: Type.INTEGER, description: 'Número del turno elegido: 1, 2 o 3.' }
				},
				required: ['number']
			}
		},
		{
			name: 'join_waitlist',
			description:
				'Pone al paciente en lista de espera cuando no hay turnos o no quiso ninguno. Recibirá un aviso cuando se abra uno.',
			parameters: { type: Type.OBJECT, properties: {} }
		}
	],
	oficina: [
		{
			name: 'publish_slots',
			description: 'Publica turnos disponibles de la oficina y empieza a buscar pacientes.',
			parameters: {
				type: Type.OBJECT,
				properties: {
					date: str('Fecha en formato YYYY-MM-DD.'),
					start: str('Hora de inicio en 24 horas, formato HH:MM.'),
					end: str('Hora final en 24 horas, formato HH:MM, si la dieron.'),
					count: { type: Type.INTEGER, description: 'Cantidad de turnos, si la dieron.' },
					duration_min: { type: Type.INTEGER, description: 'Duración de cada turno en minutos, si la dieron.' }
				},
				required: ['date', 'start']
			}
		}
	]
};
