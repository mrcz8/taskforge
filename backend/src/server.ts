import { Hono } from 'hono';

const app = new Hono();

app.get('/api/health', (c) => {
    return c.json({ ok: true });
});

export default {
    port: 3000,
    fetch: app.fetch,
};