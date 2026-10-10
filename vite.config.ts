import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// Attaches the Gemini Live WebSocket proxy to the dev server (production: see server.js).
function geminiLiveProxy(): Plugin {
	return {
		name: 'gemini-live-proxy',
		configureServer(server) {
			const http = server.httpServer;
			if (!http) return;
			const env = loadEnv(server.config.mode, process.cwd(), '');
			void import('./src/lib/server/geminiLiveProxy.js').then(({ attachGeminiLiveProxy, cookieAuthorizer, cookieToolRunner }) => {
				const baseUrl = () => {
					const a = http.address();
					return `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 5173}`;
				};
				attachGeminiLiveProxy(http as import('node:http').Server, {
					apiKey: (env.GEMINI_API_KEY ?? '').trim(),
					authorize: cookieAuthorizer(baseUrl),
					runTool: cookieToolRunner(baseUrl)
				});
			});
		}
	};
}

export default defineConfig({
	server: {
		// Lets a tunnel (ngrok, cloudflared) reach the dev server for the Twilio webhook.
		allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io', '.trycloudflare.com']
	},
	plugins: [
		tailwindcss(),
		geminiLiveProxy(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	]
});
