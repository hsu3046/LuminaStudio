// SeedDream CORS Proxy — Vercel Serverless Function
// SeedDream (BytePlus) API does not set Access-Control-Allow-Headers: Authorization
// in preflight responses, so browser-level fetch is blocked by CORS.
// This proxy forwards the request server-side to bypass the restriction.

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header required' });
    }

    try {
        const response = await fetch(
            'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: authHeader,
                },
                body: JSON.stringify(req.body),
            }
        );

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err: any) {
        console.error('[SeedDream Proxy] Error:', err);
        res.status(500).json({ error: err.message || 'Proxy error' });
    }
}
