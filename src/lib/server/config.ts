// Reads settings from .env (if present) and the process environment.
// Server-only: never import this from a .svelte file.
import fs from 'node:fs';

if (fs.existsSync('.env')) {
	try {
		process.loadEnvFile('.env');
	} catch (e) {
		console.warn('[config] could not read .env:', e);
	}
}

const v = (k: string) => (process.env[k] ?? '').trim();

export type LlmProvider = 'anthropic' | 'openai' | 'openrouter' | 'ollama';

const PROVIDERS: readonly LlmProvider[] = ['anthropic', 'openai', 'openrouter', 'ollama'];

function hasCredentials(p: LlmProvider): boolean {
	switch (p) {
		case 'openrouter':
			return Boolean(v('OPENROUTER_API_KEY') || v('LLM_API_KEY'));
		case 'ollama':
			return Boolean(v('OLLAMA_MODEL') || v('LLM_MODEL'));
		default:
			return Boolean(v('LLM_API_KEY'));
	}
}

/**
 * LLM_PROVIDER wins when it names a provider that is actually configured.
 * If it is empty/invalid or has no credentials, fall back to the first provider
 * that does, so the intake chat and the clinic voice commands always share the
 * same working AI instead of silently dropping to the rule-based parser.
 */
function resolveProvider(): LlmProvider {
	const explicit = v('LLM_PROVIDER').toLowerCase() as LlmProvider;
	const valid = PROVIDERS.includes(explicit);
	if (valid && hasCredentials(explicit)) return explicit;
	const found = PROVIDERS.find(hasCredentials);
	if (found) {
		if (valid) console.warn(`[config] LLM_PROVIDER=${explicit} has no credentials; using ${found} instead.`);
		return found;
	}
	return valid ? explicit : 'anthropic';
}

export const config = {
	/** 'anthropic' (default), 'openai', 'openrouter' or 'ollama'. */
	llmProvider: resolveProvider(),
	llmApiKey: v('LLM_API_KEY'),
	llmModel: v('LLM_MODEL'),
	openrouterApiKey: v('OPENROUTER_API_KEY'),
	openrouterModel: v('OPENROUTER_MODEL'),
	ollamaHost: (v('OLLAMA_HOST') || 'http://localhost:11434').replace(/\/+$/, ''),
	ollamaModel: v('OLLAMA_MODEL'),
	geminiApiKey: v('GEMINI_API_KEY'),
	/** 'simulated' (default): SMS only appear in /sms. 'twilio': also send real texts. */
	smsMode: (v('SMS_MODE') || 'simulated').toLowerCase(),
	twilioSid: v('TWILIO_ACCOUNT_SID'),
	twilioToken: v('TWILIO_AUTH_TOKEN'),
	twilioFrom: v('TWILIO_FROM_NUMBER')
};
