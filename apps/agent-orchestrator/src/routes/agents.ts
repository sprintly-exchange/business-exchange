import { Router, Request, Response } from 'express';
import { getPool } from '@bx/database';

const router = Router();
const db = getPool();

// GET /api/agents/events — recent agent events
router.get('/events', async (req: Request, res: Response) => {
  const limit = parseInt(req.query['limit'] as string ?? '50');
  const { rows } = await db.query(
    'SELECT * FROM agent_events ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  res.json({ success: true, data: rows });
});

// GET /api/agents/events/:entityId — events for a specific entity
router.get('/events/:entityId', async (req: Request, res: Response) => {
  const { rows } = await db.query(
    'SELECT * FROM agent_events WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 20',
    [req.params.entityId]
  );
  res.json({ success: true, data: rows });
});

export { router as agentRoutes };
