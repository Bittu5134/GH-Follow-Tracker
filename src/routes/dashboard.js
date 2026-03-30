import { sha256 } from './auth.js';

// Internal Helper: The Gatekeeper
async function getAuthorizedUser(request, env) {
	const cookie = request.headers.get('Cookie') || '';
	const match = cookie.match(/session=([^;]+)/);
	if (!match) return null;

	const [username, browserHash] = match[1].split('|');
	if (!username || !browserHash) return null;

	// Pull raw token from DB
	const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
	if (!user) return null;

	// Security Check: Compare browser hash vs DB token hash
	const dbHash = await sha256(user.token);
	return dbHash === browserHash ? user : null;
}

export async function handleDashboard(request, env) {
	const user = await getAuthorizedUser(request, env);
	if (!user) return Response.redirect(new URL('/auth/login', request.url).toString(), 302);

	return await env.ASSETS.fetch(request);
}

export async function handleGetMe(request, env) {
	const user = await getAuthorizedUser(request, env);
	if (!user) return new Response('Unauthorized', { status: 401 });

	return new Response(
		JSON.stringify({
			username: user.username,
			webhooks: JSON.parse(user.webhooks || '[]'),
		}),
		{ headers: { 'Content-Type': 'application/json' } },
	);
}

export async function handleUpdateWebhooks(request, env) {
	const user = await getAuthorizedUser(request, env);
	if (!user) return new Response('Unauthorized', { status: 401 });
	try {
		const newWebhooks = await request.json();
		if (!Array.isArray(newWebhooks)) return new Response('Invalid data format', { status: 400 });

		if (newWebhooks.length > 3) {
			return new Response(JSON.stringify({
				error: 'Limit reached',
				message: 'Maximum 3 webhooks allowed.'
			}), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		await env.DB.prepare('UPDATE users SET webhooks = ? WHERE username = ?')
			.bind(JSON.stringify(newWebhooks), user.username)
			.run();

		return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
	} catch (e) {
		return new Response('Bad Request', { status: 400 });
	}
}
