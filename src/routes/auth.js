export const sha256 = async (text) => {
	const encoder = new Uint8Array(new TextEncoder().encode(text));
	const hashBuffer = await crypto.subtle.digest('SHA-256', encoder);
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
};

export async function handleLogin(env) {
	const params = new URLSearchParams({
		client_id: env.GITHUB_CLIENT_ID,
		scope: 'repo read:user',
	});
	return Response.redirect(`https://github.com/login/oauth/authorize?${params}`, 302);
}

export async function handleCallback(request, env) {
	const code = new URL(request.url).searchParams.get('code');
	if (!code) return new Response('Auth Failed', { status: 400 });

	// 1. Swap Code for Token (This is where Client Secret is required)
	const res = await fetch('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_id: env.GITHUB_CLIENT_ID,
			client_secret: env.GITHUB_CLIENT_SECRET,
			code,
		}),
	});
	const { access_token } = await res.json();
	if (!access_token) return new Response('GitHub Token Error', { status: 401 });

	// 2. Get GitHub Username
	const userRes = await fetch('https://api.github.com/user', {
		headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'Worker' },
	});
	const { login: username } = await userRes.json();

	// 3. Star the Repo
	await fetch('https://api.github.com/user/starred/bittu5134/gh-follow-tracker', {
		method: 'PUT',
		headers: { Authorization: `Bearer ${access_token}`, 'Content-Length': '0', 'User-Agent': 'Worker' },
	});

	// 4. Save RAW token to DB
	await env.DB.prepare('INSERT INTO users (username, token) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET token = excluded.token')
		.bind(username, access_token)
		.run();

	// 5. Hash the token for the Browser Cookie
	const hash = await sha256(access_token);

	return new Response(null, {
		status: 302,
		headers: {
			Location: '/dashboard',
			'Set-Cookie': `session=${username}|${hash}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
		},
	});
}

export function handleLogout() {
	return new Response(null, {
		status: 302,
		headers: {
			Location: '/',
			'Set-Cookie': 'session=; Path=/; Max-Age=0; HttpOnly; Secure',
		},
	});
}
