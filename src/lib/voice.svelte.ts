// Browser voice helpers using the built-in Web Speech API (free, no server).
// Works best in Chrome / Edge. Safari support varies; Firefox has no recognition,
// so every voice screen also has a text box.

/* eslint-disable @typescript-eslint/no-explicit-any */

export class VoiceInput {
	listening = $state(false);
	interim = $state('');
	supported = $state(false);
	error = $state('');

	#rec: any = null;
	#onFinal: (text: string) => void;

	constructor(onFinal: (text: string) => void, lang = 'es-PR') {
		this.#onFinal = onFinal;
		if (typeof window === 'undefined') return;
		const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
		if (!SR) return;
		this.supported = true;
		const rec = new SR();
		rec.lang = lang;
		rec.interimResults = true;
		rec.continuous = false;
		rec.maxAlternatives = 1;
		let finalText = '';
		rec.onstart = () => {
			finalText = '';
			this.interim = '';
			this.error = '';
			this.listening = true;
		};
		rec.onresult = (e: any) => {
			let interim = '';
			for (let i = e.resultIndex; i < e.results.length; i++) {
				const r = e.results[i];
				if (r.isFinal) finalText += r[0].transcript;
				else interim += r[0].transcript;
			}
			this.interim = (finalText + ' ' + interim).trim();
		};
		rec.onerror = (e: any) => {
			if (e.error === 'not-allowed') this.error = 'Permite el micrófono para hablar.';
			else if (e.error === 'no-speech') this.error = 'No te escuché. Intenta otra vez.';
			else if (e.error !== 'aborted') this.error = 'Hubo un problema con el micrófono.';
		};
		rec.onend = () => {
			this.listening = false;
			const text = finalText.trim() || this.interim.trim();
			this.interim = '';
			if (text) this.#onFinal(text);
		};
		this.#rec = rec;
	}

	toggle() {
		if (!this.#rec) return;
		if (this.listening) this.#rec.stop();
		else {
			stopSpeaking();
			try {
				this.#rec.start();
			} catch {
				/* already started */
			}
		}
	}
}

export function speak(text: string, lang = 'es-PR') {
	if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
	window.speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(text);
	u.lang = lang;
	const voices = window.speechSynthesis.getVoices();
	const v =
		voices.find((x) => x.lang === lang) ??
		voices.find((x) => x.lang.startsWith('es-US')) ??
		voices.find((x) => x.lang.startsWith('es'));
	if (v) u.voice = v;
	u.rate = 1;
	window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
	if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
