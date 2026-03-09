import bcrypt from 'bcryptjs';
import { getPool } from '@bx/database';
import { generateId } from '@bx/shared-utils';

// ─── Demo Partner Definitions ────────────────────────────────────────────────

const DEMO_PARTNERS = [
  {
    key: 'globaltrade',
    name: 'GlobalTrade Logistics',
    domain: 'globaltrade-demo.io',
    contactEmail: 'api@globaltrade-demo.io',
    password: 'Demo@1234',
    webhookUrl: 'https://webhook.site/globaltrade',
    formats: ['json', 'xml', 'edi-x12'],
    messageTypes: ['order', 'shipment', 'invoice'],
    description: 'International freight & logistics provider',
  },
  {
    key: 'nexuspay',
    name: 'NexusPay Finance',
    domain: 'nexuspay-demo.io',
    contactEmail: 'connect@nexuspay-demo.io',
    password: 'Demo@1234',
    webhookUrl: 'https://webhook.site/nexuspay',
    formats: ['json', 'csv'],
    messageTypes: ['invoice', 'payment', 'remittance'],
    description: 'B2B payment processing & invoicing',
  },
  {
    key: 'agrosupply',
    name: 'AgroSupply Chain',
    domain: 'agrosupply-demo.io',
    contactEmail: 'edi@agrosupply-demo.io',
    password: 'Demo@1234',
    webhookUrl: null,
    formats: ['edi-x12', 'edifact', 'csv'],
    messageTypes: ['purchase_order', 'shipment', 'inventory'],
    description: 'Agricultural supply chain management',
  },
  {
    key: 'medicore',
    name: 'MediCore Systems',
    domain: 'medicore-demo.io',
    contactEmail: 'integration@medicore-demo.io',
    password: 'Demo@1234',
    webhookUrl: 'https://webhook.site/medicore',
    formats: ['xml', 'json'],
    messageTypes: ['purchase_order', 'invoice', 'catalogue'],
    description: 'Healthcare supply & procurement',
  },
  {
    key: 'retailsync',
    name: 'RetailSync Pro',
    domain: 'retailsync-demo.io',
    contactEmail: 'api@retailsync-demo.io',
    password: 'Demo@1234',
    webhookUrl: 'https://webhook.site/retailsync',
    formats: ['json', 'csv', 'xml'],
    messageTypes: ['order', 'inventory', 'invoice'],
    description: 'Retail inventory & order management',
  },
];

// Subscription flows: [subscriberKey, providerKey, message samples]
const DEMO_FLOWS: Array<{
  subscriber: string;
  provider: string;
  messages: Array<{ format: string; type: string; raw: string; status: string }>;
}> = [
  {
    subscriber: 'retailsync',
    provider: 'globaltrade',
    messages: [
      {
        format: 'json',
        type: 'order',
        status: 'delivered',
        raw: JSON.stringify({
          orderId: 'ORD-2025-0001',
          shipTo: { name: 'RetailSync Warehouse', address: '100 Commerce St, Chicago IL 60601' },
          items: [{ sku: 'SKU-A001', qty: 500, weight: '1250kg' }],
          requestedDelivery: '2025-09-10',
        }),
      },
      {
        format: 'xml',
        type: 'shipment',
        status: 'processing',
        raw: `<?xml version="1.0"?><Shipment><ID>SHP-00291</ID><Carrier>DHL</Carrier><TrackingNo>1Z999AA10123456784</TrackingNo><ETA>2025-09-08</ETA></Shipment>`,
      },
      {
        format: 'json',
        type: 'invoice',
        status: 'failed',
        raw: JSON.stringify({
          invoiceId: 'INV-2025-GT-088',
          amount: 48750.0,
          currency: 'USD',
          dueDate: '2025-10-01',
        }),
      },
    ],
  },
  {
    subscriber: 'globaltrade',
    provider: 'nexuspay',
    messages: [
      {
        format: 'json',
        type: 'payment',
        status: 'delivered',
        raw: JSON.stringify({
          paymentId: 'PAY-NX-5521',
          fromAccount: 'GT-CORP-001',
          toAccount: 'NX-RECV-99',
          amount: 48750.0,
          currency: 'USD',
          reference: 'INV-2025-GT-088',
        }),
      },
      {
        format: 'csv',
        type: 'remittance',
        status: 'delivered',
        raw: `payment_id,invoice_id,amount,currency,date\nPAY-NX-5521,INV-2025-GT-088,48750.00,USD,2025-09-01\nPAY-NX-5522,INV-2025-GT-089,12300.00,USD,2025-09-01`,
      },
    ],
  },
  {
    subscriber: 'medicore',
    provider: 'agrosupply',
    messages: [
      {
        format: 'edi-x12',
        type: 'purchase_order',
        status: 'delivered',
        raw: `ISA*00*          *00*          *ZZ*MEDICORE       *ZZ*AGROSUPPLY     *250901*1200*^*00501*000000905*0*P*:~GS*PO*MEDICORE*AGROSUPPLY*20250901*1200*1*X*005010~ST*850*0001~BEG*00*SA*PO-MC-2025-0041**20250901~PO1*1*200*EA*12.50*PE*VP*ITEM-HERB-001~CTT*1~SE*5*0001~GE*1*1~IEA*1*000000905~`,
      },
      {
        format: 'xml',
        type: 'invoice',
        status: 'processing',
        raw: `<?xml version="1.0"?><Invoice><ID>INV-AS-20250901</ID><PO>PO-MC-2025-0041</PO><Items><Item><Code>ITEM-HERB-001</Code><Qty>200</Qty><UnitPrice>12.50</UnitPrice></Item></Items><Total>2500.00</Total></Invoice>`,
      },
    ],
  },
  {
    subscriber: 'nexuspay',
    provider: 'retailsync',
    messages: [
      {
        format: 'json',
        type: 'invoice',
        status: 'delivered',
        raw: JSON.stringify({
          invoiceId: 'INV-RS-2025-0071',
          vendorId: 'NEXUSPAY-001',
          lineItems: [
            { description: 'Payment Processing Fee - Aug 2025', amount: 1850.0 },
            { description: 'FX Conversion Fee', amount: 320.5 },
          ],
          total: 2170.5,
          currency: 'USD',
          dueDate: '2025-10-15',
        }),
      },
    ],
  },
  {
    subscriber: 'agrosupply',
    provider: 'globaltrade',
    messages: [
      {
        format: 'edifact',
        type: 'shipment',
        status: 'delivered',
        raw: `UNB+UNOA:1+AGROSUPPLY+GLOBALTRADE+250902:0900+1'UNH+1+IFTMIN:D:95B:UN'BGM+340+SHP-AG-0041+9'DTM+137:20250902:102'NAD+CZ+AGROSUPPLY::91'NAD+CN+GLOBALTRADE::91'GID+1+100:BX'UNT+7+1'UNZ+1+1'`,
      },
    ],
  },
];

// ─── Demo Schema Definitions ─────────────────────────────────────────────────

interface DemoSchema {
  partnerKey: string;
  format: string;
  messageType: string;
  direction: 'outbound' | 'inbound';
  samplePayload: string;
  inferredSchema: Record<string, unknown>;
  mappingRules: Array<{ sourceField: string; targetField: string; transform?: string; confidence: number }>;
}

const DEMO_SCHEMAS: DemoSchema[] = [
  // ── RetailSync Pro ─────────────────────────────────────────────────────────
  {
    partnerKey: 'retailsync',
    format: 'json',
    messageType: 'order',
    direction: 'outbound',
    samplePayload: JSON.stringify({
      orderId: 'ORD-2025-0001',
      shipTo: { name: 'RetailSync Warehouse', address: '100 Commerce St, Chicago IL 60601' },
      items: [{ sku: 'SKU-A001', qty: 500, weight: '1250kg' }],
      requestedDelivery: '2025-09-10',
    }),
    inferredSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        shipTo: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: { type: 'string' },
          },
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              qty: { type: 'integer' },
              weight: { type: 'string' },
            },
          },
        },
        requestedDelivery: { type: 'string', format: 'date' },
      },
      required: ['orderId', 'shipTo', 'items'],
    },
    mappingRules: [
      { sourceField: 'orderId',                 targetField: 'order.id',                   confidence: 0.98 },
      { sourceField: 'shipTo.name',             targetField: 'receiver.name',              confidence: 0.95 },
      { sourceField: 'shipTo.address',          targetField: 'receiver.address.street',    confidence: 0.88 },
      { sourceField: 'items[0].sku',            targetField: 'order.lineItems[0].sku',     confidence: 0.96 },
      { sourceField: 'items[0].qty',            targetField: 'order.lineItems[0].quantity',confidence: 0.97 },
      { sourceField: 'items[0].weight',         targetField: 'order.lineItems[0].weight',  confidence: 0.90 },
      { sourceField: 'requestedDelivery',       targetField: 'order.requestedDelivery',    confidence: 0.99 },
    ],
  },
  {
    partnerKey: 'retailsync',
    format: 'json',
    messageType: 'invoice',
    direction: 'outbound',
    samplePayload: JSON.stringify({
      invoiceId: 'INV-RS-2025-0071',
      vendorId: 'NEXUSPAY-001',
      lineItems: [
        { description: 'Payment Processing Fee - Aug 2025', amount: 1850.0 },
        { description: 'FX Conversion Fee', amount: 320.5 },
      ],
      total: 2170.5,
      currency: 'USD',
      dueDate: '2025-10-15',
    }),
    inferredSchema: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string' },
        vendorId: { type: 'string' },
        lineItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              amount: { type: 'number' },
            },
          },
        },
        total: { type: 'number' },
        currency: { type: 'string', minLength: 3, maxLength: 3 },
        dueDate: { type: 'string', format: 'date' },
      },
      required: ['invoiceId', 'total', 'currency'],
    },
    mappingRules: [
      { sourceField: 'invoiceId',               targetField: 'invoice.id',                 confidence: 0.99 },
      { sourceField: 'vendorId',                targetField: 'sender.id',                  confidence: 0.92 },
      { sourceField: 'lineItems[0].description',targetField: 'invoice.lineItems[0].description', confidence: 0.94 },
      { sourceField: 'lineItems[0].amount',     targetField: 'invoice.lineItems[0].amount',confidence: 0.97 },
      { sourceField: 'total',                   targetField: 'invoice.totalAmount',         confidence: 0.99 },
      { sourceField: 'currency',                targetField: 'invoice.currency',            confidence: 0.99 },
      { sourceField: 'dueDate',                 targetField: 'invoice.dueDate',             confidence: 0.98 },
    ],
  },

  // ── GlobalTrade Logistics ──────────────────────────────────────────────────
  {
    partnerKey: 'globaltrade',
    format: 'json',
    messageType: 'order',
    direction: 'inbound',
    samplePayload: JSON.stringify({
      orderId: 'ORD-2025-0001',
      shipTo: { name: 'RetailSync Warehouse', address: '100 Commerce St, Chicago IL 60601' },
      items: [{ sku: 'SKU-A001', qty: 500, weight: '1250kg' }],
      requestedDelivery: '2025-09-10',
    }),
    inferredSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        shipTo: { type: 'object', properties: { name: { type: 'string' }, address: { type: 'string' } } },
        items: { type: 'array', items: { type: 'object' } },
        requestedDelivery: { type: 'string', format: 'date' },
      },
      required: ['orderId', 'items'],
    },
    mappingRules: [
      { sourceField: 'orderId',           targetField: 'order.id',                   confidence: 0.98 },
      { sourceField: 'shipTo.name',       targetField: 'receiver.name',              confidence: 0.95 },
      { sourceField: 'shipTo.address',    targetField: 'receiver.address.street',    confidence: 0.88 },
      { sourceField: 'items[0].sku',      targetField: 'order.lineItems[0].sku',     confidence: 0.96 },
      { sourceField: 'items[0].qty',      targetField: 'order.lineItems[0].quantity',confidence: 0.97 },
      { sourceField: 'requestedDelivery', targetField: 'order.requestedDelivery',    confidence: 0.99 },
    ],
  },
  {
    partnerKey: 'globaltrade',
    format: 'xml',
    messageType: 'shipment',
    direction: 'outbound',
    samplePayload: `<?xml version="1.0"?><Shipment><ID>SHP-00291</ID><Carrier>DHL</Carrier><TrackingNo>1Z999AA10123456784</TrackingNo><ETA>2025-09-08</ETA></Shipment>`,
    inferredSchema: {
      type: 'object',
      properties: {
        Shipment: {
          type: 'object',
          properties: {
            ID:         { type: 'string' },
            Carrier:    { type: 'string' },
            TrackingNo: { type: 'string' },
            ETA:        { type: 'string', format: 'date' },
          },
          required: ['ID', 'Carrier', 'TrackingNo'],
        },
      },
    },
    mappingRules: [
      { sourceField: 'Shipment.ID',         targetField: 'shipment.id',             confidence: 0.97 },
      { sourceField: 'Shipment.Carrier',    targetField: 'shipment.carrier',        confidence: 0.99 },
      { sourceField: 'Shipment.TrackingNo', targetField: 'shipment.trackingNumber', confidence: 0.98 },
      { sourceField: 'Shipment.ETA',        targetField: 'shipment.eta',            confidence: 0.96 },
    ],
  },
  {
    partnerKey: 'globaltrade',
    format: 'json',
    messageType: 'invoice',
    direction: 'outbound',
    samplePayload: JSON.stringify({
      invoiceId: 'INV-2025-GT-088',
      amount: 48750.0,
      currency: 'USD',
      dueDate: '2025-10-01',
    }),
    inferredSchema: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string' },
        amount:    { type: 'number' },
        currency:  { type: 'string', minLength: 3, maxLength: 3 },
        dueDate:   { type: 'string', format: 'date' },
      },
      required: ['invoiceId', 'amount', 'currency'],
    },
    mappingRules: [
      { sourceField: 'invoiceId', targetField: 'invoice.id',          confidence: 0.99 },
      { sourceField: 'amount',    targetField: 'invoice.totalAmount',  confidence: 0.98 },
      { sourceField: 'currency',  targetField: 'invoice.currency',     confidence: 0.99 },
      { sourceField: 'dueDate',   targetField: 'invoice.dueDate',      confidence: 0.98 },
    ],
  },

  // ── NexusPay Finance ───────────────────────────────────────────────────────
  {
    partnerKey: 'nexuspay',
    format: 'json',
    messageType: 'payment',
    direction: 'outbound',
    samplePayload: JSON.stringify({
      paymentId: 'PAY-NX-5521',
      fromAccount: 'GT-CORP-001',
      toAccount: 'NX-RECV-99',
      amount: 48750.0,
      currency: 'USD',
      reference: 'INV-2025-GT-088',
    }),
    inferredSchema: {
      type: 'object',
      properties: {
        paymentId:   { type: 'string' },
        fromAccount: { type: 'string' },
        toAccount:   { type: 'string' },
        amount:      { type: 'number' },
        currency:    { type: 'string', minLength: 3, maxLength: 3 },
        reference:   { type: 'string' },
      },
      required: ['paymentId', 'amount', 'currency'],
    },
    mappingRules: [
      { sourceField: 'paymentId',   targetField: 'payment.id',          confidence: 0.99 },
      { sourceField: 'fromAccount', targetField: 'sender.accountId',    confidence: 0.93 },
      { sourceField: 'toAccount',   targetField: 'receiver.accountId',  confidence: 0.93 },
      { sourceField: 'amount',      targetField: 'payment.amount',      confidence: 0.99 },
      { sourceField: 'currency',    targetField: 'payment.currency',    confidence: 0.99 },
      { sourceField: 'reference',   targetField: 'payment.reference',   confidence: 0.97 },
    ],
  },
  {
    partnerKey: 'nexuspay',
    format: 'csv',
    messageType: 'remittance',
    direction: 'outbound',
    samplePayload: `payment_id,invoice_id,amount,currency,date\nPAY-NX-5521,INV-2025-GT-088,48750.00,USD,2025-09-01`,
    inferredSchema: {
      type: 'object',
      properties: {
        payment_id: { type: 'string' },
        invoice_id: { type: 'string' },
        amount:     { type: 'number' },
        currency:   { type: 'string' },
        date:       { type: 'string', format: 'date' },
      },
      required: ['payment_id', 'invoice_id', 'amount', 'currency'],
    },
    mappingRules: [
      { sourceField: 'payment_id', targetField: 'payment.id',         confidence: 0.98 },
      { sourceField: 'invoice_id', targetField: 'invoice.id',         confidence: 0.97 },
      { sourceField: 'amount',     targetField: 'payment.amount',     confidence: 0.99 },
      { sourceField: 'currency',   targetField: 'payment.currency',   confidence: 0.99 },
      { sourceField: 'date',       targetField: 'envelope.timestamp', confidence: 0.91 },
    ],
  },

  // ── MediCore Systems ───────────────────────────────────────────────────────
  {
    partnerKey: 'medicore',
    format: 'edi-x12',
    messageType: 'purchase_order',
    direction: 'outbound',
    samplePayload: `ISA*00*          *00*          *ZZ*MEDICORE       *ZZ*AGROSUPPLY     *250901*1200*^*00501*000000905*0*P*:~GS*PO*MEDICORE*AGROSUPPLY*20250901*1200*1*X*005010~ST*850*0001~BEG*00*SA*PO-MC-2025-0041**20250901~PO1*1*200*EA*12.50*PE*VP*ITEM-HERB-001~CTT*1~SE*5*0001~GE*1*1~IEA*1*000000905~`,
    inferredSchema: {
      type: 'object',
      description: 'ANSI X12 850 Purchase Order',
      properties: {
        'ISA.06': { type: 'string', description: 'Sender ID' },
        'ISA.08': { type: 'string', description: 'Receiver ID' },
        'BEG.03': { type: 'string', description: 'Purchase Order Number' },
        'BEG.05': { type: 'string', description: 'Purchase Order Date' },
        'PO1.02': { type: 'string', description: 'Quantity Ordered' },
        'PO1.04': { type: 'string', description: 'Unit Price' },
        'PO1.07': { type: 'string', description: 'Vendor Product ID' },
      },
    },
    mappingRules: [
      { sourceField: 'ISA.06',  targetField: 'sender.id',                   confidence: 0.95 },
      { sourceField: 'ISA.08',  targetField: 'receiver.id',                 confidence: 0.95 },
      { sourceField: 'BEG.03',  targetField: 'order.id',                    confidence: 0.97 },
      { sourceField: 'BEG.05',  targetField: 'order.date',                  confidence: 0.96 },
      { sourceField: 'PO1.02',  targetField: 'order.lineItems[0].quantity', confidence: 0.94 },
      { sourceField: 'PO1.04',  targetField: 'order.lineItems[0].unitPrice',confidence: 0.94 },
      { sourceField: 'PO1.07',  targetField: 'order.lineItems[0].sku',      confidence: 0.91 },
    ],
  },
  {
    partnerKey: 'medicore',
    format: 'xml',
    messageType: 'invoice',
    direction: 'inbound',
    samplePayload: `<?xml version="1.0"?><Invoice><ID>INV-AS-20250901</ID><PO>PO-MC-2025-0041</PO><Items><Item><Code>ITEM-HERB-001</Code><Qty>200</Qty><UnitPrice>12.50</UnitPrice></Item></Items><Total>2500.00</Total></Invoice>`,
    inferredSchema: {
      type: 'object',
      properties: {
        Invoice: {
          type: 'object',
          properties: {
            ID:    { type: 'string' },
            PO:    { type: 'string' },
            Items: { type: 'object' },
            Total: { type: 'number' },
          },
          required: ['ID', 'Total'],
        },
      },
    },
    mappingRules: [
      { sourceField: 'Invoice.ID',                    targetField: 'invoice.id',                    confidence: 0.99 },
      { sourceField: 'Invoice.PO',                    targetField: 'order.id',                      confidence: 0.93 },
      { sourceField: 'Invoice.Items.Item.Code',       targetField: 'invoice.lineItems[0].sku',      confidence: 0.91 },
      { sourceField: 'Invoice.Items.Item.Qty',        targetField: 'invoice.lineItems[0].quantity', confidence: 0.94 },
      { sourceField: 'Invoice.Items.Item.UnitPrice',  targetField: 'invoice.lineItems[0].unitPrice',confidence: 0.94 },
      { sourceField: 'Invoice.Total',                 targetField: 'invoice.totalAmount',           confidence: 0.99 },
    ],
  },

  // ── AgroSupply Chain ───────────────────────────────────────────────────────
  {
    partnerKey: 'agrosupply',
    format: 'edi-x12',
    messageType: 'purchase_order',
    direction: 'inbound',
    samplePayload: `ISA*00*          *00*          *ZZ*MEDICORE       *ZZ*AGROSUPPLY     *250901*1200*^*00501*000000905*0*P*:~GS*PO*MEDICORE*AGROSUPPLY*20250901*1200*1*X*005010~ST*850*0001~BEG*00*SA*PO-MC-2025-0041**20250901~PO1*1*200*EA*12.50*PE*VP*ITEM-HERB-001~CTT*1~SE*5*0001~GE*1*1~IEA*1*000000905~`,
    inferredSchema: {
      type: 'object',
      description: 'ANSI X12 850 Purchase Order (inbound from MediCore)',
      properties: {
        'ISA.06': { type: 'string', description: 'Sender ID' },
        'ISA.08': { type: 'string', description: 'Receiver ID' },
        'BEG.03': { type: 'string', description: 'Purchase Order Number' },
        'PO1.02': { type: 'string', description: 'Quantity Ordered' },
        'PO1.04': { type: 'string', description: 'Unit Price' },
        'PO1.07': { type: 'string', description: 'Product ID' },
      },
    },
    mappingRules: [
      { sourceField: 'ISA.06',  targetField: 'sender.id',                   confidence: 0.95 },
      { sourceField: 'ISA.08',  targetField: 'receiver.id',                 confidence: 0.95 },
      { sourceField: 'BEG.03',  targetField: 'order.id',                    confidence: 0.97 },
      { sourceField: 'BEG.05',  targetField: 'order.date',                  confidence: 0.96 },
      { sourceField: 'PO1.02',  targetField: 'order.lineItems[0].quantity', confidence: 0.94 },
      { sourceField: 'PO1.04',  targetField: 'order.lineItems[0].unitPrice',confidence: 0.94 },
      { sourceField: 'PO1.07',  targetField: 'order.lineItems[0].sku',      confidence: 0.91 },
    ],
  },
  {
    partnerKey: 'agrosupply',
    format: 'edifact',
    messageType: 'shipment',
    direction: 'outbound',
    samplePayload: `UNB+UNOA:1+AGROSUPPLY+GLOBALTRADE+250902:0900+1'UNH+1+IFTMIN:D:95B:UN'BGM+340+SHP-AG-0041+9'DTM+137:20250902:102'NAD+CZ+AGROSUPPLY::91'NAD+CN+GLOBALTRADE::91'GID+1+100:BX'UNT+7+1'UNZ+1+1'`,
    inferredSchema: {
      type: 'object',
      description: 'UN/EDIFACT IFTMIN Shipment Instruction',
      properties: {
        'UNB.2': { type: 'string', description: 'Sender identification' },
        'UNB.3': { type: 'string', description: 'Recipient identification' },
        'UNB.4': { type: 'string', description: 'Date/time of preparation' },
        'BGM.2': { type: 'string', description: 'Document number (Shipment ID)' },
        'DTM.2': { type: 'string', description: 'Date/time value' },
        'GID.2': { type: 'string', description: 'Number and type of packages' },
      },
    },
    mappingRules: [
      { sourceField: 'UNB.2',  targetField: 'sender.id',             confidence: 0.94 },
      { sourceField: 'UNB.3',  targetField: 'receiver.id',           confidence: 0.94 },
      { sourceField: 'UNB.4',  targetField: 'envelope.timestamp',    confidence: 0.90 },
      { sourceField: 'BGM.2',  targetField: 'shipment.id',           confidence: 0.96 },
      { sourceField: 'DTM.2',  targetField: 'shipment.departureDate',confidence: 0.89 },
      { sourceField: 'GID.2',  targetField: 'shipment.packageCount', confidence: 0.87 },
    ],
  },
];

export class DemoService {
  private db = getPool();

  async getSetting(key: string): Promise<string | null> {
    const { rows } = await this.db.query(
      'SELECT value FROM system_settings WHERE key = $1', [key]
    );
    return rows.length ? (rows[0] as { value: string }).value : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const { rows } = await this.db.query('SELECT key, value FROM system_settings ORDER BY key');
    return Object.fromEntries((rows as { key: string; value: string }[]).map(r => [r.key, r.value]));
  }

  async isDemoEnabled(): Promise<boolean> {
    const val = await this.getSetting('demo_mode');
    return val === 'true';
  }

  async enableDemo(): Promise<{ added: number }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const passwordHash = await bcrypt.hash('Demo@1234', 10);

      // Create demo partners and collect their IDs
      const partnerIdByKey: Record<string, string> = {};
      let added = 0;

      for (const p of DEMO_PARTNERS) {
        const exists = await client.query('SELECT id FROM partners WHERE domain = $1', [p.domain]);
        if (exists.rows.length) {
          partnerIdByKey[p.key] = (exists.rows[0] as { id: string }).id;
          continue;
        }

        const partnerId = generateId();
        partnerIdByKey[p.key] = partnerId;

        await client.query(
          `INSERT INTO partners
             (id, name, domain, contact_email, webhook_url, supported_formats,
              supported_message_types, status, is_demo, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',true,NOW(),NOW())`,
          [partnerId, p.name, p.domain, p.contactEmail, p.webhookUrl, p.formats, p.messageTypes]
        );
        await client.query(
          `INSERT INTO auth_users (id, partner_id, email, password_hash, scopes)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (email) DO NOTHING`,
          [
            generateId(), partnerId, p.contactEmail, passwordHash,
            ['partner:read', 'partner:write', 'subscription:read', 'subscription:write',
             'integration:send', 'mapping:read', 'mapping:write', 'agent:read'],
          ]
        );
        added++;
      }

      // Create subscriptions and seed messages
      for (const flow of DEMO_FLOWS) {
        const subscriberId = partnerIdByKey[flow.subscriber];
        const providerId = partnerIdByKey[flow.provider];
        if (!subscriberId || !providerId) continue;

        // Upsert subscription (ignore duplicate pair)
        const subRes = await client.query(
          `INSERT INTO subscriptions
             (subscriber_partner_id, provider_partner_id, status, approved_at, created_at, updated_at)
           VALUES ($1,$2,'active',NOW(),NOW(),NOW())
           ON CONFLICT (subscriber_partner_id, provider_partner_id) DO UPDATE
             SET status = 'active', approved_at = NOW(), updated_at = NOW()
           RETURNING id`,
          [subscriberId, providerId]
        );
        const subscriptionId = (subRes.rows[0] as { id: string }).id;

        for (const msg of flow.messages) {
          await client.query(
            `INSERT INTO messages
               (source_partner_id, target_partner_id, subscription_id,
                format, raw_payload, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
            [subscriberId, providerId, subscriptionId, msg.format, msg.raw, msg.status]
          );
        }
      }

      // Seed schema_registry for each demo partner
      for (const schema of DEMO_SCHEMAS) {
        const partnerId = partnerIdByKey[schema.partnerKey];
        if (!partnerId) continue;

        // Determine status: auto_approved if all rules ≥ 0.85, else pending_review
        const allConfident = schema.mappingRules.every(r => r.confidence >= 0.85);
        const status = allConfident ? 'auto_approved' : 'pending_review';

        await client.query(
          `INSERT INTO schema_registry
             (partner_id, format, message_type, schema_direction, sample_payload,
              inferred_schema, mapping_rules, version, status, is_active, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,true,NOW(),NOW())
           ON CONFLICT DO NOTHING`,
          [
            partnerId,
            schema.format,
            schema.messageType,
            schema.direction,
            schema.samplePayload,
            JSON.stringify(schema.inferredSchema),
            JSON.stringify(schema.mappingRules),
            status,
          ]
        );
      }

      await this.setSetting('demo_mode', 'true');
      await client.query('COMMIT');
      return { added };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async disableDemo(): Promise<{ removed: number }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Get demo partner IDs first
      const { rows: demoRows } = await client.query(
        'SELECT id FROM partners WHERE is_demo = true'
      );
      const demoIds = (demoRows as { id: string }[]).map(r => r.id);

      if (demoIds.length > 0) {
        // Delete in FK order: messages → subscriptions → schema_registry → auth_users → partners
        await client.query(
          `DELETE FROM messages
           WHERE source_partner_id = ANY($1) OR target_partner_id = ANY($1)`,
          [demoIds]
        );
        await client.query(
          `DELETE FROM subscriptions
           WHERE subscriber_partner_id = ANY($1) OR provider_partner_id = ANY($1)`,
          [demoIds]
        );
        await client.query(
          `DELETE FROM schema_registry WHERE partner_id = ANY($1)`,
          [demoIds]
        );
        await client.query('DELETE FROM partners WHERE is_demo = true');
      }

      await this.setSetting('demo_mode', 'false');
      await client.query('COMMIT');
      return { removed: demoIds.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  getDemoPartners() {
    return DEMO_PARTNERS.map(p => ({
      name: p.name,
      domain: p.domain,
      email: p.contactEmail,
      password: p.password,
      formats: p.formats,
      description: p.description,
    }));
  }
}
