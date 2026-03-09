import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { MappingService } from '../services/mappingService';
import { getPool } from '@bx/database';

const router = Router();
const svc = new MappingService();
const db = getPool();

const transformSchema = z.object({
  payload: z.string(),
  sourcePartnerId: z.string().uuid(),
  targetPartnerId: z.string().uuid(),
  format: z.enum(['json', 'xml', 'csv', 'edi-x12', 'edifact']),
});

// POST /api/mappings/transform — transform a payload
router.post('/transform', async (req: Request, res: Response) => {
  const parsed = transformSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await svc.transform(parsed.data);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Transformation failed';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/mappings/capabilities/:partnerId — public capabilities of any partner
router.get('/capabilities/:partnerId', async (req: Request, res: Response) => {
  try {
    const { rows } = await db.query<{ format: string; message_type: string; schema_direction: string }>(
      `SELECT DISTINCT format, message_type, schema_direction
       FROM schema_registry
       WHERE partner_id = $1 AND is_active = true AND status = 'active'
       ORDER BY schema_direction, message_type, format`,
      [req.params.partnerId]
    );

    const outboundFormats  = [...new Set(rows.filter(r => r.schema_direction === 'outbound').map(r => r.format))];
    const inboundFormats   = [...new Set(rows.filter(r => r.schema_direction === 'inbound').map(r => r.format))];
    const outboundTypes    = [...new Set(rows.filter(r => r.schema_direction === 'outbound').map(r => r.message_type))];
    const inboundTypes     = [...new Set(rows.filter(r => r.schema_direction === 'inbound').map(r => r.message_type))];

    res.json({
      success: true,
      data: { outboundFormats, inboundFormats, outboundTypes, inboundTypes },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch capabilities';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/mappings/:sourcePartnerId/:targetPartnerId — get mapping rules
router.get('/:sourcePartnerId/:targetPartnerId', async (req: Request, res: Response) => {
  const rules = await svc.getMappingRules(req.params.sourcePartnerId, req.params.targetPartnerId);
  res.json({ success: true, data: rules });
});

export { router as mappingRoutes };
