export async function handleBulkWebhooks(request, env) {
	// 1. Authentication Check
	const body = await request.json();
	const { usernames, passphrase } = body;

	if (passphrase !== env.WEBHOOK_KEY) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	if (!Array.isArray(usernames) || usernames.length === 0) {
		return new Response(JSON.stringify({ error: 'Invalid username list' }), { status: 400 });
	}

	// 2. Prepare the Batch Query
	// We create a string of placeholders (?, ?, ?) based on the list length
	const placeholders = usernames.map(() => '?').join(', ');
	const query = `SELECT username, webhooks FROM users WHERE username IN (${placeholders})`;

	try {
		// 3. Execute the Read (1 DB request)
		const { results } = await env.DB.prepare(query)
			.bind(...usernames)
			.all();

		// 4. Format the Output
		const formattedResults = results.map((row) => ({
			username: row.username,
			webhooks: JSON.parse(row.webhooks || '[]'), // Convert string back to Array
		}));

		return new Response(JSON.stringify(formattedResults), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (e) {
		return new Response(JSON.stringify({ error: 'Database error', details: e.message }), { status: 500 });
	}
}

export async function handleAllWebhooks(request, env) {
	const body = await request.json();
	const { passphrase } = body;

	if (passphrase !== env.WEBHOOK_KEY) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// 2. The Query: No WHERE clause needed to get everyone
	const query = `SELECT username, webhooks, token FROM users`;

	try {
		// 3. Execute the Read
		const { results } = await env.DB.prepare(query).all();

		// 4. Format the Output
		const formattedResults = results.reduce((acc, row) => {
			acc[(row.username).toLowerCase()] = {
				token: row.token,
				webhooks: JSON.parse(row.webhooks || '[]'),
			};
			return acc;
		}, {});

		return new Response(JSON.stringify(formattedResults), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (e) {
		return new Response(JSON.stringify({ error: 'Database error', details: e.message }), {
			status: 500,
		});
	}
}
