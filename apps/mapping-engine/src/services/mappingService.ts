import jsonata from 'jsonata';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { getPool } from '@bx/database';
import { MessageFormat, MappingRule } from '@bx/shared-types';

interface TransformInput {
  payload: string;
  sourcePartnerId: string;
  targetPartnerId: string;
  format: MessageFormat;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',     // no prefix — attributes accessed by plain name (e.g. currencyID)
  removeNSPrefix: true,        // strips namespace prefixes (cbc:, cac:, etc.)
  parseTagValue: true,
  trimValues: true,
  textNodeName: 'value',       // text content of mixed elements (with attributes) stored as 'value'
                               // e.g. <Quantity unitCode="EA">10</Quantity> → { unitCode:"EA", value:10 }
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
});

export class MappingService {
  private db = getPool();

  async transform(input: TransformInput): Promise<{ mappedPayload: string; rulesApplied: number; schemaId?: string; outputFormat: MessageFormat }> {
    // ── Stage 1: Outbound mapping — sender's format → CDM ────────────────────
    const { rules: outboundRules, schemaId: outboundSchemaId } =
      await this.getDirectionalRules(input.sourcePartnerId, 'outbound', input.format);

    let cdmObj: Record<string, unknown>;
    if (outboundRules.length) {
      const sourceObj = this.parse(input.payload, input.format);
      cdmObj = await this.applyRules(sourceObj, outboundRules);
    } else {
      // No outbound schema — treat payload as CDM passthrough
      try { cdmObj = input.format === 'json' ? (JSON.parse(input.payload) as Record<string, unknown>) : {}; }
      catch { cdmObj = {}; }
    }

    // ── Stage 2: Inbound mapping — CDM → receiver's format ───────────────────
    const { rules: inboundRules, schemaId: inboundSchemaId, format: receiverFormat } =
      await this.getDirectionalRules(input.targetPartnerId, 'inbound', undefined);

    let deliveryPayload: string;
    let outputFormat: MessageFormat;
    if (inboundRules.length) {
      const receiverObj = await this.applyRules(cdmObj, inboundRules);
      outputFormat = (receiverFormat as MessageFormat) ?? 'json';
      deliveryPayload = this.serialize(receiverObj, outputFormat);
    } else {
      // No inbound schema — deliver CDM as JSON (universal fallback)
      outputFormat = 'json';
      deliveryPayload = JSON.stringify(cdmObj);
    }

    const schemaId = outboundSchemaId ?? inboundSchemaId;
    const rulesApplied = outboundRules.length + inboundRules.length;

    if (rulesApplied === 0) {
      // Nothing applied — pass through original payload unchanged
      return { mappedPayload: input.payload, rulesApplied: 0, outputFormat: input.format };
    }

    return { mappedPayload: deliveryPayload, rulesApplied, schemaId, outputFormat };
  }

  private async applyRules(sourceObj: unknown, rules: MappingRule[]): Promise<Record<string, unknown>> {
    const output: Record<string, unknown> = {};
    for (const rule of rules) {
      try {
        const expr = await jsonata(rule.sourceField);
        const value = await expr.evaluate(sourceObj);
        if (value !== undefined) {
          this.setNested(output, rule.targetField, rule.transform ? this.applyTransform(value, rule.transform) : value);
        }
      } catch { /* skip failed rule */ }
    }
    return output;
  }

  /** Fetch active schema rules filtered by partner + direction + optional format */
  async getDirectionalRules(
    partnerId: string,
    direction: 'outbound' | 'inbound',
    format?: MessageFormat
  ): Promise<{ rules: MappingRule[]; schemaId?: string; format?: string }> {
    const { rows } = await this.db.query<{ id: string; format: string; mapping_rules: MappingRule[] }>(
      `SELECT id, format, mapping_rules FROM schema_registry
       WHERE partner_id = $1
         AND schema_direction = $2
         AND is_active = true
         AND status IN ('auto_approved', 'approved')
         ${format ? 'AND format = $3' : ''}
       LIMIT 1`,
      format ? [partnerId, direction, format] : [partnerId, direction]
    );
    return rows.length
      ? { rules: rows[0].mapping_rules, schemaId: rows[0].id, format: rows[0].format }
      : { rules: [] };
  }

  /** @deprecated Use getDirectionalRules directly */
  async getMappingRulesWithId(sourcePartnerId: string, targetPartnerId: string, messageFormat?: MessageFormat): Promise<{ rules: MappingRule[]; schemaId?: string; targetPreferredFormat?: MessageFormat }> {
    const [src, tgt] = await Promise.all([
      this.getDirectionalRules(sourcePartnerId, 'outbound', messageFormat),
      this.getDirectionalRules(targetPartnerId, 'inbound', messageFormat),
    ]);
    if (src.rules.length) return { rules: src.rules, schemaId: src.schemaId, targetPreferredFormat: tgt.format as MessageFormat };
    if (tgt.rules.length) return { rules: tgt.rules, schemaId: tgt.schemaId, targetPreferredFormat: tgt.format as MessageFormat };
    return { rules: [] };
  }

  async getMappingRules(sourcePartnerId: string, targetPartnerId: string, messageFormat?: MessageFormat): Promise<MappingRule[]> {
    const { rules } = await this.getMappingRulesWithId(sourcePartnerId, targetPartnerId, messageFormat);
    return rules;
  }

  private serialize(obj: Record<string, unknown>, format: MessageFormat): string {
    if (format === 'xml') {
      return xmlBuilder.build({ CDM: obj }) as string;
    }
    if (format === 'csv') {
      const keys = Object.keys(obj);
      const header = keys.join(',');
      const row = keys.map(k => String(obj[k] ?? '')).join(',');
      return `${header}\n${row}`;
    }
    // json (default) and anything else
    return JSON.stringify(obj);
  }

  private parse(payload: string, format: MessageFormat): unknown {
    if (format === 'json') {
      return JSON.parse(payload);
    }
    if (format === 'xml') {
      // Parse XML → plain JS object with namespace prefixes stripped.
      // The root tag is included as the top-level key (e.g. { Order: { ID: "PO-1001", ... } })
      return xmlParser.parse(payload);
    }
    if (format === 'csv') {
      // Parse CSV into array of row objects using first row as headers
      const [headerLine, ...dataLines] = payload.trim().split('\n');
      const headers = headerLine.split(',').map(h => h.trim());
      return dataLines.map(line => {
        const vals = line.split(',').map(v => v.trim());
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
      });
    }
    // EDI and other formats — wrap as raw string for basic JSONata access
    return { raw: payload };
  }

  private setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!key) continue;
      if (!(key in current)) current[key] = {};
      current = current[key] as Record<string, unknown>;
    }
    const lastKey = keys[keys.length - 1];
    if (lastKey) current[lastKey] = value;
  }

  private applyTransform(value: unknown, transform: string): unknown {
    try {
      // eslint-disable-next-line no-new-func
      return new Function('value', `return ${transform}`)(value);
    } catch {
      return value;
    }
  }
}
