// Minimal LLM wrapper. Returns parsed JSON, or null if no API key is set or
// anything goes wrong — callers always have a rule-based fallback, so the demo
// keeps working offline or if the API is slow.
import { config } from './config.ts';

const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';

export function llmEnabled() {
	switch (config.llmProvider) {
		case 'openrouter':
			return Boolean(config.openrouterApiKey || config.llmApiKey);
		case 'ollama':
			return Boolean(config.ollamaModel || config.llmModel);
		default:
			return Boolean(config.llmApiKey);
	}
}

type ChatMessage = { role: 'system' | 'user'; content: string };

/** OpenAI-compatible chat completions (OpenAI, OpenRouter, Ollama's /v1 endpoint). */
async function chatCompletions(
	label: string,
	url: string,
	headers: Record<string, string>,
	model: string,
	messages: ChatMessage[],
	signal: AbortSignal
): Promise<string> {
	const send = (strict: boolean) =>
		fetch(url, {
			method: 'POST',
			signal,
			headers: { ...headers, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model,
				...(strict ? { response_format: { type: 'json_object' }, temperature: 0 } : {}),
				messages
			})
		});
	let res = await send(true);
	// Some models (many free OpenRouter / local Ollama ones, newer OpenAI ones) reject
	// JSON mode or `temperature`; the prompt already asks for JSON only, so retry bare.
	if (res.status === 400 || res.status === 404 || res.status === 422) res = await send(false);
	if (!res.ok) throw new Error(`${label} ${res.status}: ${await res.text()}`);
	const j = await res.json();
	return j.choices?.[0]?.message?.content ?? '';
}

let announced = false;

export async function llmJson<T>(system: string, user: string): Promise<T | null> {
	if (!llmEnabled()) {
		if (!announced) {
			announced = true;
			console.warn(`[llm] disabled (provider "${config.llmProvider}" has no credentials); using rule-based parsing only.`);
		}
		return null;
	}
	if (!announced) {
		announced = true;
		console.log(`[llm] using ${config.llmProvider}`);
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.llmProvider === 'ollama' ? 60_000 : 12_000);
	const messages: ChatMessage[] = [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];
	try {
		let text = '';
		if (config.llmProvider === 'openai') {
			text = await chatCompletions(
				'OpenAI',
				'https://api.openai.com/v1/chat/completions',
				{ Authorization: `Bearer ${config.llmApiKey}` },
				config.llmModel || 'gpt-4o-mini',
				messages,
				controller.signal
			);
		} else if (config.llmProvider === 'openrouter') {
			text = await chatCompletions(
				'OpenRouter',
				'https://openrouter.ai/api/v1/chat/completions',
				{ Authorization: `Bearer ${config.openrouterApiKey || config.llmApiKey}` },
				config.openrouterModel || config.llmModel || OPENROUTER_DEFAULT_MODEL,
				messages,
				controller.signal
			);
		} else if (config.llmProvider === 'ollama') {
			text = await chatCompletions(
				'Ollama',
				`${config.ollamaHost}/v1/chat/completions`,
				{},
				config.ollamaModel || config.llmModel,
				messages,
				controller.signal
			);
		} else {
			const res = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				signal: controller.signal,
				headers: {
					'x-api-key': config.llmApiKey,
					'anthropic-version': '2023-06-01',
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: config.llmModel || 'claude-haiku-5-5',
					max_tokens: 600,
					// No `temperature`: newer Claude models reject it with a 400.
					system,
					messages: [{ role: 'user', content: user }]
				})
			});
			if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
			const j = await res.json();
			text = (j.content ?? []).find((b: { type: string }) => b.type === 'text')?.text ?? '';
		}
		const match = text.match(/\{[\s\S]*\}/);
		return match ? (JSON.parse(match[0]) as T) : null;
	} catch (e) {
		console.error('[llm] falling back to rules:', e instanceof Error ? e.message : e);
		return null;
	} finally {
		clearTimeout(timer);
	}
}
