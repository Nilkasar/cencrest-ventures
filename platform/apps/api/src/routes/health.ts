import { Hono } from 'hono';
import type { AppEnv } from '../types/context.js';

const health = new Hono<AppEnv>();

health.get('/', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

export default health;
