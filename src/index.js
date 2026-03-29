import { handleLogin, handleCallback, handleLogout } from './routes/auth.js';
import { handleDashboard, handleGetMe, handleUpdateWebhooks } from './routes/dashboard.js';
import { handleBulkWebhooks, handleAllWebhooks } from './routes/getWebhhoks.js';
import { generateChartSVG } from './utils/generate.js';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const method = request.method;
		let pathname = url.pathname;
		if (url.pathname.endsWith('/') && url.pathname.length > 1) pathname = url.pathname.slice(0, -1);

		// OTHER
		if (pathname === '/') return Response.redirect('https://github.com/Bittu5134/GH-Follow-Tracker#github-follow-tracker', 302);
		if (pathname === '/test') console.log(await request.json());
		if (pathname.startsWith('/user/') && pathname.endsWith('.svg')) {
			const username = pathname.split('/')[2].replace('.svg', '');
			const usernameLower = username.toLowerCase();
			const headers = {
				Authorization: `token ${env.GITHUB_PAT}`,
				'User-Agent': 'Cloudflare-Worker-SVG-Generator',
			};
			let dataset;
			try {
				const rawUrl = `https://raw.githubusercontent.com/Bittu5134/GH-Follow-Tracker/refs/heads/meta/data/user/${usernameLower}.json`;
				const githubResponse = await fetch(rawUrl, { headers });

				if (githubResponse.ok) {
					dataset = await githubResponse.json();
				} else {
					const userApiUrl = `https://api.github.com/users/${username}`;
					const apiRes = await fetch(userApiUrl, { headers });

					if (!apiRes.ok) throw new Error('User not found on GitHub');

					const userData = await apiRes.json();
					const now = new Date().toISOString();

					dataset = {
						username: userData.login,
						id: userData.id,
						createdAt: userData.created_at,
						firstTracked: now,
						history: [
							{
								timestamp: now,
								followerCount: userData.followers,
							},
						],
					};
				}
			} catch (err) {
				return new Response(`Error: ${err.message}`, { status: 500 });
			}

			const options = {
				username,
				dataset,
			};

			url.searchParams.forEach((val, key) => {
				if (val === 'true' || val === 'false') {
					options[key] = val === 'true';
				} else if (!isNaN(val) && val.trim() !== '' && !key.startsWith('col_')) {
					options[key] = Number(val);
				} else {
					options[key] = val;
				}
			});

			return new Response(generateChartSVG(options), {
				headers: {
					'Cache-Control': 'public, max-age=14400',
					'Content-Type': 'image/svg+xml;charset=utf-8',
					'Access-Control-Allow-Origin': '*',
					'X-Content-Type-Options': 'nosniff',
				},
			});
		}
		if (pathname.startsWith('/user/') && !pathname.endsWith('.svg')) {
			const userPathRequest = new Request(new URL('/profile.html', url), request);
			const userPathResponse = await env.ASSETS.fetch(userPathRequest.url);

			return new Response(userPathResponse.body);
		}

		// AUTH
		if (pathname === '/auth/login') return handleLogin(env);
		if (pathname === '/auth/callback') return await handleCallback(request, env);
		if (pathname === '/auth/logout') return handleLogout();

		// DASHBOARD
		if (pathname === '/dashboard') return await handleDashboard(request, env);

		// API
		if (pathname === '/api/me') return await handleGetMe(request, env);
		if (pathname === '/api/update_webhooks' && method === 'POST') return await handleUpdateWebhooks(request, env);
		if (pathname === '/api/v1/webhooks' && method === 'POST') return await handleBulkWebhooks(request, env);
		if (pathname === '/api/v1/all_webhooks') return await handleAllWebhooks(request, env);

		const errorRequest = new Request(new URL('/404.html', url.origin), request);
		const errorResponse = await env.ASSETS.fetch(errorRequest.url);

		return new Response(errorResponse.body, {
			status: 404,
			headers: { 'Content-Type': 'text/html; charset=UTF-8' },
		});
	},
};
