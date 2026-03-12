import bcrypt from 'bcryptjs';
import { getPool } from '@bx/database';
import { generateId } from '@bx/shared-utils';

// ─── Demo Partner Definitions ────────────────────────────────────────────────
//
// Trade Relationships:
//   RetailSync Pro  (Buyer)    →  GlobalTrade Logistics (Shipper/Supplier)
//   GlobalTrade Logistics      →  NexusPay Finance      (Payment Processor)
//   MediCore Systems (Buyer)   →  AgroSupply Chain      (Supplier)
//   AgroSupply Chain           →  GlobalTrade Logistics (3PL Carrier)
//
// Each partner operates in BOTH buyer and supplier roles.

const DEMO_PARTNERS = [
  {
    key: 'globaltrade',
    name: 'GlobalTrade Logistics',
    domain: 'globaltrade-demo.io',
    contactEmail: 'api@globaltrade-demo.io',
    password: 'Demo@1234',
    webhookUrl: 'https://webhook.site/globaltrade',
    formats: ['json', 'xml', 'edifact'],
    // Supplier of: shipment, invoice  |  Buyer of: payment services
    messageTypes: ['order', 'shipment', 'invoice', 'shipment_instruction', 'payment', 'remittance'],
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
    // Supplier of: remittance, payment_confirmation
    messageTypes: ['payment', 'remittance', 'invoice'],
    description: 'B2B payment processing & settlement',
  },
  {
    key: 'agrosupply',
    name: 'AgroSupply Chain',
    domain: 'agrosupply-demo.io',
    contactEmail: 'edi@agrosupply-demo.io',
    password: 'Demo@1234',
    webhookUrl: null,
    formats: ['edi-x12', 'edifact', 'xml'],
    // Supplier of: invoice, shipment  |  Buyer of: 3PL logistics
    messageTypes: ['purchase_order', 'invoice', 'shipment', 'shipment_instruction'],
    description: 'Agricultural supply chain — grains, organics & bulk commodities',
  },
  {
    key: 'medicore',
    name: 'MediCore Systems',
    domain: 'medicore-demo.io',
    contactEmail: 'integration@medicore-demo.io',
    password: 'Demo@1234',
    webhookUrl: 'https://webhook.site/medicore',
    formats: ['edi-x12', 'xml', 'json'],
    // Buyer of: agricultural raw materials
    messageTypes: ['purchase_order', 'invoice', 'shipment'],
    description: 'Healthcare nutraceutical procurement & supply',
  },
  {
    key: 'retailsync',
    name: 'RetailSync Pro',
    domain: 'retailsync-demo.io',
    contactEmail: 'api@retailsync-demo.io',
    password: 'Demo@1234',
    webhookUrl: 'https://webhook.site/retailsync',
    formats: ['json', 'csv', 'xml'],
    // Buyer of: logistics services
    messageTypes: ['order', 'shipment', 'invoice', 'inventory'],
    description: 'Retail inventory & order management platform',
  },
];

// ─── Demo Message Flows ──────────────────────────────────────────────────────
//
// subscriber = the partner SENDING messages in this flow
// provider   = the partner RECEIVING messages in this flow
//
// Bidirectional trade is modelled as two separate flows per pair.

// Payload constants (reused across flows + schemas)
const RS_ORDER_JSON = JSON.stringify({
  rs_order_ref: 'RS-ORD-2025-08821',
  raised_date: '2025-09-01',
  required_delivery: '2025-09-15',
  ship_to: {
    site_code: 'RS-CHI-WH01',
    site_name: 'RS Chicago Warehouse',
    address_1: '100 Commerce St',
    city: 'Chicago',
    state: 'IL',
    postcode: '60601',
    country: 'US',
  },
  vendor_id: 'GT-VEND-001',
  line_items: [
    { pos: 1, art_code: 'AG-WHEAT-HRW-001', art_desc: 'Hard Red Winter Wheat 50kg Bag', qty_ordered: 500, uom: 'BAG', net_price: 47.5 },
    { pos: 2, art_code: 'AG-CORN-YLW-001',  art_desc: 'Yellow Dent Corn 50kg Bag',       qty_ordered: 250, uom: 'BAG', net_price: 32.0 },
  ],
  total_net: 31750.0,
  currency: 'USD',
  payment_terms_code: 'NET30',
  notes: 'Deliver to Dock 4. Contact receiving@rs-demo.io 30 min ahead.',
}, null, 2);

const GT_SHIPMENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<FreightNotification version="2.0">
  <Header>
    <FN_Ref>GT-SHP-2025-00891</FN_Ref>
    <ClientOrderRef>RS-ORD-2025-08821</ClientOrderRef>
    <NotifyDate>2025-09-03</NotifyDate>
    <StatusCode>DEPARTED</StatusCode>
  </Header>
  <Carrier>
    <CarrierName>DHL Express</CarrierName>
    <ServiceMode>AIR_FREIGHT</ServiceMode>
    <AWBNumber>1Z999AA10123456784</AWBNumber>
    <ProNumber>PRO-2025-44821</ProNumber>
  </Carrier>
  <Route>
    <OriginPortCode>ORD</OriginPortCode>
    <DestPortCode>CHI</DestPortCode>
    <DepartureDate>2025-09-03</DepartureDate>
    <ETADate>2025-09-08</ETADate>
  </Route>
  <Cargo>
    <TotalWeight uom="KG">12500</TotalWeight>
    <TotalPkgs>25</TotalPkgs>
    <CargoItems>
      <Item seq="1"><ItemRef>AG-WHEAT-HRW-001</ItemRef><Desc>Hard Red Winter Wheat</Desc><Qty uom="BAG">500</Qty></Item>
      <Item seq="2"><ItemRef>AG-CORN-YLW-001</ItemRef><Desc>Yellow Dent Corn</Desc><Qty uom="BAG">250</Qty></Item>
    </CargoItems>
  </Cargo>
  <Consignee>
    <ClientCode>RS-001</ClientCode>
    <CompanyName>RetailSync Pro</CompanyName>
    <DeliveryAddress>100 Commerce St, Chicago IL 60601</DeliveryAddress>
  </Consignee>
</FreightNotification>`;

const GT_INVOICE_JSON = JSON.stringify({
  gt_inv_no: 'GT-INV-2025-04421',
  inv_date: '2025-09-10',
  payment_due_dt: '2025-10-10',
  billed_to: { client_code: 'RS-001', company_name: 'RetailSync Pro', billing_addr: { street: '100 Commerce St', city: 'Chicago', state: 'IL', zip: '60601', country: 'US' } },
  billed_from: { entity: 'GlobalTrade Logistics', entity_code: 'GT-CORP-001', tax_id: 'US-EIN-47-9921345' },
  svc_lines: [
    { line_no: 1, svc_code: 'AIRFREIGHT', description: 'Air Freight — ORD to CHI',            qty: 1, unit_rate: 42000.0, line_total: 42000.0 },
    { line_no: 2, svc_code: 'HANDLING',   description: 'Cargo Handling & Documentation',       qty: 1, unit_rate: 3750.0,  line_total: 3750.0  },
    { line_no: 3, svc_code: 'INSURANCE',  description: 'Cargo Insurance 0.5% of declared value', qty: 1, unit_rate: 3000.0, line_total: 3000.0 },
  ],
  net_total: 48750.0,
  vat_pct: 0,
  vat_amt: 0.0,
  gross_total: 48750.0,
  ccy: 'USD',
  po_ref: 'RS-ORD-2025-08821',
  bank_details: { bank: 'First Commerce Bank', acct: '****8821', routing: '021000021' },
}, null, 2);

const MC_PO_EDI = `ISA*00*          *00*          *ZZ*MEDICORE       *ZZ*AGROSUPPLY     *250901*1200*^*00501*000000905*0*P*:~
GS*PO*MEDICORE*AGROSUPPLY*20250901*1200*905*X*005010~
ST*850*0001~
BEG*00*SA*PO-MC-2025-0041**20250901~
CUR*BY*USD~
DTM*002*20250915~
N1*BY*MediCore Systems*92*MEDICORE-001~
N3*200 MedTech Blvd~
N4*Boston*MA*02101*US~
PER*BD*Procurement*EM*integration@medicore-demo.io~
N1*SE*AgroSupply Chain*92*AGROSUPPLY-001~
N3*Rural Route 7~
N4*Fresno*CA*93706*US~
PO1*1*200*EA*12.50*PE*VP*ITEM-HERB-001*PI*AGRO-HERB-001~
PID*F****Organic Herbal Extract 500ml~
PO1*2*100*EA*28.75*PE*VP*ITEM-HERB-002*PI*AGRO-HERB-002~
PID*F****Cold-Pressed Flaxseed Oil 1L~
PO1*3*50*KG*45.00*PE*VP*ITEM-GRAIN-001*PI*AGRO-GRAIN-001~
PID*F****Certified Organic Quinoa~
CTT*3*350~
AMT*TT*7612.50~
SE*22*0001~
GE*1*905~
IEA*1*000000905~`;

const AS_INVOICE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AgroInvoice xmlns="http://agrosupply-demo.io/invoice/v1">
  <InvHdr>
    <InvNo>AS-INV-2025-0041</InvNo>
    <InvDate>2025-09-05</InvDate>
    <DueDt>2025-10-05</DueDt>
    <CCY>USD</CCY>
    <PORef>PO-MC-2025-0041</PORef>
    <PayTerms>NET30</PayTerms>
  </InvHdr>
  <Supplier>
    <SuppCode>AGROSUPPLY-001</SuppCode>
    <SuppName>AgroSupply Chain</SuppName>
    <TaxRegNo>US-EIN-38-4412901</TaxRegNo>
    <BankAcct>AS-BANK-WF-001</BankAcct>
  </Supplier>
  <Customer>
    <CustCode>MEDICORE-001</CustCode>
    <CustName>MediCore Systems</CustName>
    <BillAddr>
      <Line1>200 MedTech Blvd</Line1>
      <City>Boston</City>
      <State>MA</State>
      <PostCode>02101</PostCode>
      <Country>US</Country>
    </BillAddr>
  </Customer>
  <InvLines>
    <Line seq="1">
      <AgroPartNo>AGRO-HERB-001</AgroPartNo>
      <BuyerPartNo>ITEM-HERB-001</BuyerPartNo>
      <Descr>Organic Herbal Extract 500ml</Descr>
      <ShipQty>200</ShipQty>
      <UOM>EA</UOM>
      <UnitPrice>12.50</UnitPrice>
      <LineAmt>2500.00</LineAmt>
    </Line>
    <Line seq="2">
      <AgroPartNo>AGRO-HERB-002</AgroPartNo>
      <BuyerPartNo>ITEM-HERB-002</BuyerPartNo>
      <Descr>Cold-Pressed Flaxseed Oil 1L</Descr>
      <ShipQty>100</ShipQty>
      <UOM>EA</UOM>
      <UnitPrice>28.75</UnitPrice>
      <LineAmt>2875.00</LineAmt>
    </Line>
    <Line seq="3">
      <AgroPartNo>AGRO-GRAIN-001</AgroPartNo>
      <BuyerPartNo>ITEM-GRAIN-001</BuyerPartNo>
      <Descr>Certified Organic Quinoa</Descr>
      <ShipQty>50</ShipQty>
      <UOM>KG</UOM>
      <UnitPrice>45.00</UnitPrice>
      <LineAmt>2250.00</LineAmt>
    </Line>
  </InvLines>
  <InvTotals>
    <SubTotal>7625.00</SubTotal>
    <TaxAmt>0.00</TaxAmt>
    <TotalAmt>7625.00</TotalAmt>
  </InvTotals>
</AgroInvoice>`;

const AS_DESADV_EDIFACT = `UNB+UNOA:3+AGROSUPPLY:ZZ+MEDICORE:ZZ+250905:0800+42'
UNH+1+DESADV:D:96A:UN'
BGM+351+SHP-AG-2025-0041+9'
DTM+137:20250905:102'
DTM+2:20250910:102'
RFF+ON:PO-MC-2025-0041'
NAD+SE+AGROSUPPLY::92++AgroSupply Chain+Rural Route 7+Fresno+CA+93706+US'
CTA+SD+:Shipping Dept'
COM+edi@agrosupply-demo.io:EM'
NAD+CN+MEDICORE::92++MediCore Systems+200 MedTech Blvd+Boston+MA+02101+US'
TOD+6++CFR'
PAC+3++BX'
MEA+PD+AAB+KGM:485.5'
LIN+1++AGRO-HERB-001:SA'
IMD+F++:::Organic Herbal Extract 500ml'
QTY+12:200:EA'
PRI+AAA:12.50:CA:1:EA'
LIN+2++AGRO-HERB-002:SA'
IMD+F++:::Cold-Pressed Flaxseed Oil 1L'
QTY+12:100:EA'
PRI+AAA:28.75:CA:1:EA'
LIN+3++AGRO-GRAIN-001:SA'
IMD+F++:::Certified Organic Quinoa'
QTY+12:50:KG'
PRI+AAA:45.00:CA:1:KG'
UNS+S'
CNT+2:3'
MOA+128:7625.00'
UNT+30+1'
UNZ+1+42'`;

const AS_IFTMIN_EDIFACT = `UNB+UNOA:3+AGROSUPPLY:ZZ+GLOBALTRADE:ZZ+250905:0600+99'
UNH+1+IFTMIN:D:95B:UN'
BGM+340+IFTMIN-AG-2025-0099+9'
DTM+137:20250905:102'
DTM+2:20250910:102'
TSR+1++3'
RFF+CR:PO-MC-2025-0041'
NAD+CZ+AGROSUPPLY::92++AgroSupply Chain+Rural Route 7+Fresno+CA+93706+US'
CTA+SD+:Dispatch Dept'
COM+edi@agrosupply-demo.io:EM'
NAD+CN+MEDICORE::92++MediCore Systems+200 MedTech Blvd+Boston+MA+02101+US'
NAD+CA+GLOBALTRADE::92++GlobalTrade Logistics'
GID+1+25:BX'
FTX+AAI+++Handle with care — perishable organic goods'
MEA+PD+AAB+KGM:485.5'
MEA+PD+VOL+MTQ:2.4'
SGP+CONT-GT-88821+1'
UNT+17+1'
UNZ+1+99'`;

const GT_PAYMENT_JSON = JSON.stringify({
  gt_pmt_ref: 'GT-PAY-2025-NX-0088',
  pmt_type: 'ACH_CREDIT',
  value_date: '2025-09-12',
  gross_amt: 48750.0,
  ccy: 'USD',
  debit_party:  { entity: 'GlobalTrade Logistics', acct_no: 'GT-CORP-CHK-001', bank_bic: 'FCBKUS33' },
  credit_party: { entity: 'NexusPay Finance',       acct_no: 'NX-RECV-9900',   bank_bic: 'NEXBKUS33' },
  pmt_ref_1: 'GT-INV-2025-04421',
  pmt_ref_2: 'RS-ORD-2025-08821',
  remittance_text: 'Settlement for Invoice GT-INV-2025-04421 re: RS-ORD-2025-08821',
}, null, 2);

const NX_REMITTANCE_CSV =
  `nx_remit_id,gt_pmt_ref,payer_code,payer_name,invoice_ref,invoice_dt,paid_amt,ccy,settlement_dt,settlement_status,nx_txn_id\n` +
  `NX-REM-2025-0088,GT-PAY-2025-NX-0088,GT-CORP-001,GlobalTrade Logistics,GT-INV-2025-04421,2025-09-10,48750.00,USD,2025-09-12,SETTLED,NX-TXN-88821\n` +
  `NX-REM-2025-0089,GT-PAY-2025-NX-0089,GT-CORP-001,GlobalTrade Logistics,GT-INV-2025-GT-089,2025-09-10,12300.00,USD,2025-09-12,SETTLED,NX-TXN-88822`;

// Subscription flows: [subscriberKey → providerKey] with direction comments
const DEMO_FLOWS: Array<{
  subscriber: string;
  provider: string;
  messages: Array<{ format: string; type: string; raw: string; status: string }>;
}> = [
  // ── Flow 1: RetailSync (Buyer) → GlobalTrade (Shipper) ───────────────────
  // RS sends purchase orders for logistics services
  {
    subscriber: 'retailsync',
    provider: 'globaltrade',
    messages: [
      { format: 'json', type: 'order',    status: 'delivered',  raw: RS_ORDER_JSON },
      { format: 'json', type: 'order',    status: 'delivered',
        raw: JSON.stringify({ rs_order_ref: 'RS-ORD-2025-08890', raised_date: '2025-09-05',
          ship_to: { site_code: 'RS-LA-WH02', site_name: 'RS Los Angeles DC', address_1: '800 Harbor Blvd', city: 'Los Angeles', state: 'CA', postcode: '90021', country: 'US' },
          vendor_id: 'GT-VEND-001', line_items: [{ pos: 1, art_code: 'AG-SOYA-001', art_desc: 'Soybean Meal 25kg Bag', qty_ordered: 1000, uom: 'BAG', net_price: 18.5 }],
          total_net: 18500.0, currency: 'USD', payment_terms_code: 'NET30' }, null, 2) },
    ],
  },

  // ── Flow 2: GlobalTrade (Shipper) → RetailSync (Buyer) ───────────────────
  // GT sends shipment confirmations and invoices back to RS
  {
    subscriber: 'globaltrade',
    provider: 'retailsync',
    messages: [
      { format: 'xml',  type: 'shipment', status: 'delivered',  raw: GT_SHIPMENT_XML },
      { format: 'json', type: 'invoice',  status: 'delivered',  raw: GT_INVOICE_JSON },
      { format: 'json', type: 'invoice',  status: 'failed',
        raw: JSON.stringify({ gt_inv_no: 'GT-INV-2025-04422', inv_date: '2025-09-12',
          payment_due_dt: '2025-10-12', billed_to: { client_code: 'RS-001', company_name: 'RetailSync Pro' },
          svc_lines: [{ line_no: 1, svc_code: 'SEAFREIGHT', description: 'Sea Freight — LAX to LA Port', qty: 1, unit_rate: 16200.0, line_total: 16200.0 }],
          gross_total: 18500.0, ccy: 'USD', po_ref: 'RS-ORD-2025-08890' }, null, 2) },
    ],
  },

  // ── Flow 3: MediCore (Buyer) → AgroSupply (Supplier) ────────────────────
  // MC sends EDI X12 850 Purchase Orders for agricultural raw materials
  {
    subscriber: 'medicore',
    provider: 'agrosupply',
    messages: [
      { format: 'edi-x12', type: 'purchase_order', status: 'delivered', raw: MC_PO_EDI },
      { format: 'edi-x12', type: 'purchase_order', status: 'processing',
        raw: `ISA*00*          *00*          *ZZ*MEDICORE       *ZZ*AGROSUPPLY     *250910*0900*^*00501*000000906*0*P*:~\nGS*PO*MEDICORE*AGROSUPPLY*20250910*0900*906*X*005010~\nST*850*0001~\nBEG*00*SA*PO-MC-2025-0042**20250910~\nCUR*BY*USD~\nDTM*002*20250930~\nN1*BY*MediCore Systems*92*MEDICORE-001~\nN1*SE*AgroSupply Chain*92*AGROSUPPLY-001~\nPO1*1*500*KG*3.80*PE*VP*ITEM-GRAIN-002*PI*AGRO-GRAIN-002~\nPID*F****Organic Chia Seeds — Premium Grade~\nCTT*1*500~\nAMT*TT*1900.00~\nSE*12*0001~\nGE*1*906~\nIEA*1*000000906~` },
    ],
  },

  // ── Flow 4: AgroSupply (Supplier) → MediCore (Buyer) ────────────────────
  // AS sends invoices (XML) and shipment notices (EDIFACT DESADV) back to MC
  {
    subscriber: 'agrosupply',
    provider: 'medicore',
    messages: [
      { format: 'xml',      type: 'invoice',  status: 'delivered',  raw: AS_INVOICE_XML },
      { format: 'edifact',  type: 'shipment', status: 'delivered',  raw: AS_DESADV_EDIFACT },
    ],
  },

  // ── Flow 5: AgroSupply → GlobalTrade (3PL Carrier) ──────────────────────
  // AS instructs GT to collect and ship their goods to MediCore
  {
    subscriber: 'agrosupply',
    provider: 'globaltrade',
    messages: [
      { format: 'edifact', type: 'shipment_instruction', status: 'delivered', raw: AS_IFTMIN_EDIFACT },
    ],
  },

  // ── Flow 6: GlobalTrade → NexusPay (Payment Processor) ──────────────────
  // GT sends payments to NexusPay for processing
  {
    subscriber: 'globaltrade',
    provider: 'nexuspay',
    messages: [
      { format: 'json', type: 'payment', status: 'delivered', raw: GT_PAYMENT_JSON },
      { format: 'json', type: 'payment', status: 'delivered',
        raw: JSON.stringify({ gt_pmt_ref: 'GT-PAY-2025-NX-0089', pmt_type: 'ACH_CREDIT',
          value_date: '2025-09-12', gross_amt: 12300.0, ccy: 'USD',
          debit_party: { entity: 'GlobalTrade Logistics', acct_no: 'GT-CORP-CHK-001', bank_bic: 'FCBKUS33' },
          credit_party: { entity: 'NexusPay Finance', acct_no: 'NX-RECV-9900', bank_bic: 'NEXBKUS33' },
          pmt_ref_1: 'GT-INV-2025-GT-089', remittance_text: 'Settlement for Invoice GT-INV-2025-GT-089' }, null, 2) },
    ],
  },

  // ── Flow 7: NexusPay → GlobalTrade (Settlement Confirmation) ────────────
  // NX sends remittance advice (CSV) back to GT after settling payments
  {
    subscriber: 'nexuspay',
    provider: 'globaltrade',
    messages: [
      { format: 'csv', type: 'remittance', status: 'delivered', raw: NX_REMITTANCE_CSV },
    ],
  },
];

// ─── Demo Schema Definitions ─────────────────────────────────────────────────
//
// Each partner has DISTINCT field naming conventions.
// The platform maps between these via CDM (Canonical Data Model) target fields.
// Schemas are paired: partner A outbound ↔ partner B inbound (same payload, different mappings).

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

  // ══════════════════════════════════════════════════════════════════════════
  // TRADE LANE 1: RetailSync (Buyer) ↔ GlobalTrade (Shipper)
  // Message: ORDER  |  Format: JSON
  // RetailSync uses rs_order_ref, raised_date, line_items[].art_code
  // GlobalTrade expects: order.id, order.date, order.lineItems[].sku
  // ══════════════════════════════════════════════════════════════════════════

  // RetailSync → outbound order (RS's own JSON field naming)
  {
    partnerKey: 'retailsync',
    format: 'json',
    messageType: 'order',
    direction: 'outbound',
    samplePayload: RS_ORDER_JSON,
    inferredSchema: {
      type: 'object',
      description: 'RetailSync purchase order — RS internal field naming',
      properties: {
        rs_order_ref:      { type: 'string',  description: 'RS internal order reference' },
        raised_date:       { type: 'string',  format: 'date' },
        required_delivery: { type: 'string',  format: 'date' },
        ship_to: {
          type: 'object',
          properties: {
            site_code: { type: 'string' }, site_name: { type: 'string' },
            address_1: { type: 'string' }, city: { type: 'string' },
            state: { type: 'string' }, postcode: { type: 'string' }, country: { type: 'string' },
          },
          required: ['site_code', 'site_name', 'address_1', 'city'],
        },
        vendor_id:          { type: 'string' },
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pos:         { type: 'integer' },
              art_code:    { type: 'string',  description: 'RS article code = SKU' },
              art_desc:    { type: 'string' },
              qty_ordered: { type: 'integer' },
              uom:         { type: 'string' },
              net_price:   { type: 'number' },
            },
            required: ['pos', 'art_code', 'qty_ordered', 'net_price'],
          },
        },
        total_net:          { type: 'number' },
        currency:           { type: 'string', minLength: 3, maxLength: 3 },
        payment_terms_code: { type: 'string' },
        notes:              { type: 'string' },
      },
      required: ['rs_order_ref', 'ship_to', 'line_items', 'total_net'],
    },
    mappingRules: [
      { sourceField: 'rs_order_ref',              targetField: 'order.id',                    confidence: 0.98 },
      { sourceField: 'raised_date',               targetField: 'order.date',                  confidence: 0.97 },
      { sourceField: 'required_delivery',         targetField: 'order.requestedDelivery',     confidence: 0.96 },
      { sourceField: 'vendor_id',                 targetField: 'sender.id',                   confidence: 0.91 },
      { sourceField: 'ship_to.site_name',         targetField: 'receiver.name',               confidence: 0.94 },
      { sourceField: 'ship_to.address_1',         targetField: 'receiver.address.street',     confidence: 0.93 },
      { sourceField: 'ship_to.city',              targetField: 'receiver.address.city',       confidence: 0.99 },
      { sourceField: 'ship_to.state',             targetField: 'receiver.address.state',      confidence: 0.99 },
      { sourceField: 'ship_to.postcode',          targetField: 'receiver.address.zip',        confidence: 0.98 },
      { sourceField: 'ship_to.country',           targetField: 'receiver.address.country',    confidence: 0.99 },
      { sourceField: 'line_items[0].art_code',    targetField: 'order.lineItems[0].sku',      confidence: 0.95 },
      { sourceField: 'line_items[0].art_desc',    targetField: 'order.lineItems[0].description', confidence: 0.92 },
      { sourceField: 'line_items[0].qty_ordered', targetField: 'order.lineItems[0].quantity', confidence: 0.97 },
      { sourceField: 'line_items[0].net_price',   targetField: 'order.lineItems[0].unitPrice',confidence: 0.96 },
      { sourceField: 'total_net',                 targetField: 'order.total',                 confidence: 0.98 },
      { sourceField: 'currency',                  targetField: 'order.currency',              confidence: 0.99 },
      { sourceField: 'payment_terms_code',        targetField: 'order.paymentTerms',          confidence: 0.90 },
    ],
  },

  // GlobalTrade ← inbound order (same RS JSON, GT's mapping perspective)
  // GT maps rs_order_ref → order.id, vendor_id → receiver.id (GT is the vendor/receiver)
  {
    partnerKey: 'globaltrade',
    format: 'json',
    messageType: 'order',
    direction: 'inbound',
    samplePayload: RS_ORDER_JSON,
    inferredSchema: {
      type: 'object',
      description: 'Inbound RS order received by GlobalTrade — GT CDM mapping',
      properties: {
        rs_order_ref: { type: 'string' }, raised_date: { type: 'string', format: 'date' },
        ship_to:      { type: 'object' }, vendor_id: { type: 'string' },
        line_items:   { type: 'array', items: { type: 'object' } },
        total_net:    { type: 'number' }, currency: { type: 'string' },
      },
    },
    mappingRules: [
      { sourceField: 'rs_order_ref',              targetField: 'order.id',                    confidence: 0.98 },
      { sourceField: 'raised_date',               targetField: 'order.date',                  confidence: 0.97 },
      { sourceField: 'required_delivery',         targetField: 'order.requestedDelivery',     confidence: 0.95 },
      { sourceField: 'vendor_id',                 targetField: 'receiver.id',                 confidence: 0.88, transform: 'GT vendor code' },
      { sourceField: 'ship_to.site_code',         targetField: 'receiver.locationCode',       confidence: 0.91 },
      { sourceField: 'ship_to.site_name',         targetField: 'receiver.name',               confidence: 0.94 },
      { sourceField: 'ship_to.address_1',         targetField: 'receiver.address.street',     confidence: 0.93 },
      { sourceField: 'ship_to.city',              targetField: 'receiver.address.city',       confidence: 0.99 },
      { sourceField: 'ship_to.country',           targetField: 'receiver.address.country',    confidence: 0.99 },
      { sourceField: 'line_items[0].art_code',    targetField: 'order.lineItems[0].sku',      confidence: 0.92 },
      { sourceField: 'line_items[0].qty_ordered', targetField: 'order.lineItems[0].quantity', confidence: 0.97 },
      { sourceField: 'line_items[0].uom',         targetField: 'order.lineItems[0].uom',      confidence: 0.95 },
      { sourceField: 'total_net',                 targetField: 'order.total',                 confidence: 0.98 },
      { sourceField: 'currency',                  targetField: 'order.currency',              confidence: 0.99 },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TRADE LANE 1: SHIPMENT  |  Format: XML
  // GlobalTrade uses FN_Ref, AWBNumber, ETADate, CarrierName
  // RetailSync expects: shipment.id, shipment.trackingNumber, shipment.estimatedDelivery
  // ══════════════════════════════════════════════════════════════════════════

  // GlobalTrade → outbound shipment (GT's XML field naming)
  {
    partnerKey: 'globaltrade',
    format: 'xml',
    messageType: 'shipment',
    direction: 'outbound',
    samplePayload: GT_SHIPMENT_XML,
    inferredSchema: {
      type: 'object',
      description: 'GT FreightNotification XML — GT field naming for shipment events',
      properties: {
        FreightNotification: {
          type: 'object',
          properties: {
            Header: {
              type: 'object',
              properties: {
                FN_Ref:         { type: 'string', description: 'GT internal freight ref' },
                ClientOrderRef: { type: 'string', description: 'Client purchase order ref' },
                NotifyDate:     { type: 'string', format: 'date' },
                StatusCode:     { type: 'string' },
              },
              required: ['FN_Ref', 'StatusCode'],
            },
            Carrier: {
              type: 'object',
              properties: {
                CarrierName: { type: 'string' }, ServiceMode: { type: 'string' },
                AWBNumber:   { type: 'string', description: 'Air Waybill / tracking number' },
                ProNumber:   { type: 'string' },
              },
            },
            Route: {
              type: 'object',
              properties: {
                OriginPortCode: { type: 'string' }, DestPortCode: { type: 'string' },
                DepartureDate:  { type: 'string', format: 'date' },
                ETADate:        { type: 'string', format: 'date' },
              },
            },
            Cargo: {
              type: 'object',
              properties: {
                TotalWeight: { type: 'string' }, TotalPkgs: { type: 'integer' },
                CargoItems: { type: 'object' },
              },
            },
            Consignee: {
              type: 'object',
              properties: {
                ClientCode: { type: 'string' }, CompanyName: { type: 'string' },
                DeliveryAddress: { type: 'string' },
              },
            },
          },
        },
      },
    },
    mappingRules: [
      { sourceField: 'FreightNotification.Header.FN_Ref',          targetField: 'shipment.id',                confidence: 0.97 },
      { sourceField: 'FreightNotification.Header.ClientOrderRef',  targetField: 'order.id',                   confidence: 0.95 },
      { sourceField: 'FreightNotification.Header.NotifyDate',      targetField: 'envelope.timestamp',         confidence: 0.92 },
      { sourceField: 'FreightNotification.Header.StatusCode',      targetField: 'shipment.status',            confidence: 0.93 },
      { sourceField: 'FreightNotification.Carrier.CarrierName',    targetField: 'shipment.carrier',           confidence: 0.99 },
      { sourceField: 'FreightNotification.Carrier.AWBNumber',      targetField: 'shipment.trackingNumber',    confidence: 0.98 },
      { sourceField: 'FreightNotification.Route.ETADate',          targetField: 'shipment.estimatedDelivery', confidence: 0.97 },
      { sourceField: 'FreightNotification.Route.DepartureDate',    targetField: 'shipment.departureDate',     confidence: 0.96 },
      { sourceField: 'FreightNotification.Cargo.TotalWeight',      targetField: 'shipment.totalWeight',       confidence: 0.89, transform: 'strip uom attribute' },
      { sourceField: 'FreightNotification.Consignee.ClientCode',   targetField: 'receiver.id',                confidence: 0.91 },
      { sourceField: 'FreightNotification.Consignee.CompanyName',  targetField: 'receiver.name',              confidence: 0.95 },
    ],
  },

  // RetailSync ← inbound shipment (same GT XML, RS's mapping — different CDM targets)
  {
    partnerKey: 'retailsync',
    format: 'xml',
    messageType: 'shipment',
    direction: 'inbound',
    samplePayload: GT_SHIPMENT_XML,
    inferredSchema: {
      type: 'object',
      description: 'GT FreightNotification received by RetailSync — RS CDM mapping',
      properties: {
        FreightNotification: { type: 'object' },
      },
    },
    mappingRules: [
      { sourceField: 'FreightNotification.Header.FN_Ref',          targetField: 'shipment.id',                confidence: 0.97 },
      { sourceField: 'FreightNotification.Header.ClientOrderRef',  targetField: 'order.id',                   confidence: 0.94 },
      { sourceField: 'FreightNotification.Header.StatusCode',      targetField: 'shipment.status',            confidence: 0.90, transform: 'map: DEPARTED→in_transit, DELIVERED→delivered' },
      { sourceField: 'FreightNotification.Carrier.AWBNumber',      targetField: 'shipment.trackingNumber',    confidence: 0.98 },
      { sourceField: 'FreightNotification.Carrier.CarrierName',    targetField: 'shipment.carrier',           confidence: 0.99 },
      { sourceField: 'FreightNotification.Carrier.ServiceMode',    targetField: 'shipment.serviceLevel',      confidence: 0.88 },
      { sourceField: 'FreightNotification.Route.ETADate',          targetField: 'shipment.estimatedDelivery', confidence: 0.97 },
      { sourceField: 'FreightNotification.Consignee.DeliveryAddress', targetField: 'receiver.address.street', confidence: 0.82 },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TRADE LANE 1: INVOICE  |  Format: JSON
  // GlobalTrade uses gt_inv_no, svc_lines[], gross_total, ccy
  // RetailSync expects: invoice.id, invoice.lineItems[], invoice.totalAmount, invoice.currency
  // ══════════════════════════════════════════════════════════════════════════

  // GlobalTrade → outbound invoice (GT's JSON field naming)
  {
    partnerKey: 'globaltrade',
    format: 'json',
    messageType: 'invoice',
    direction: 'outbound',
    samplePayload: GT_INVOICE_JSON,
    inferredSchema: {
      type: 'object',
      description: 'GT invoice — GT internal field naming (gt_inv_no, svc_lines, gross_total, ccy)',
      properties: {
        gt_inv_no:      { type: 'string' },
        inv_date:       { type: 'string', format: 'date' },
        payment_due_dt: { type: 'string', format: 'date' },
        billed_to: {
          type: 'object',
          properties: {
            client_code:  { type: 'string' }, company_name: { type: 'string' },
            billing_addr: { type: 'object' },
          },
        },
        billed_from: {
          type: 'object',
          properties: { entity: { type: 'string' }, entity_code: { type: 'string' }, tax_id: { type: 'string' } },
        },
        svc_lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              line_no: { type: 'integer' }, svc_code: { type: 'string' },
              description: { type: 'string' }, unit_rate: { type: 'number' }, line_total: { type: 'number' },
            },
          },
        },
        net_total:   { type: 'number' }, vat_pct: { type: 'number' },
        gross_total: { type: 'number' }, ccy: { type: 'string', minLength: 3, maxLength: 3 },
        po_ref:      { type: 'string' },
      },
      required: ['gt_inv_no', 'gross_total', 'ccy'],
    },
    mappingRules: [
      { sourceField: 'gt_inv_no',                   targetField: 'invoice.id',                    confidence: 0.99 },
      { sourceField: 'inv_date',                     targetField: 'invoice.date',                  confidence: 0.98 },
      { sourceField: 'payment_due_dt',               targetField: 'invoice.dueDate',               confidence: 0.97 },
      { sourceField: 'billed_from.entity_code',      targetField: 'sender.id',                     confidence: 0.93 },
      { sourceField: 'billed_from.entity',           targetField: 'sender.name',                   confidence: 0.95 },
      { sourceField: 'billed_to.client_code',        targetField: 'receiver.id',                   confidence: 0.94 },
      { sourceField: 'billed_to.company_name',       targetField: 'receiver.name',                 confidence: 0.96 },
      { sourceField: 'svc_lines[0].svc_code',        targetField: 'invoice.lineItems[0].sku',      confidence: 0.88 },
      { sourceField: 'svc_lines[0].description',     targetField: 'invoice.lineItems[0].description', confidence: 0.95 },
      { sourceField: 'svc_lines[0].line_total',      targetField: 'invoice.lineItems[0].amount',   confidence: 0.97 },
      { sourceField: 'gross_total',                  targetField: 'invoice.totalAmount',           confidence: 0.99 },
      { sourceField: 'ccy',                          targetField: 'invoice.currency',              confidence: 0.99 },
      { sourceField: 'po_ref',                       targetField: 'order.id',                      confidence: 0.93 },
    ],
  },

  // RetailSync ← inbound invoice (same GT JSON, RS's mapping)
  // RS uses different CDM field names and maps ccy → invoice.currency differently
  {
    partnerKey: 'retailsync',
    format: 'json',
    messageType: 'invoice',
    direction: 'inbound',
    samplePayload: GT_INVOICE_JSON,
    inferredSchema: {
      type: 'object',
      description: 'GT invoice received by RetailSync — RS CDM mapping (note: ccy vs currency)',
    },
    mappingRules: [
      { sourceField: 'gt_inv_no',               targetField: 'invoice.id',                    confidence: 0.99 },
      { sourceField: 'inv_date',                 targetField: 'invoice.date',                  confidence: 0.98 },
      { sourceField: 'payment_due_dt',           targetField: 'invoice.dueDate',               confidence: 0.96 },
      { sourceField: 'billed_to.client_code',    targetField: 'receiver.id',                   confidence: 0.93 },
      { sourceField: 'billed_from.entity',       targetField: 'sender.name',                   confidence: 0.95 },
      { sourceField: 'svc_lines[0].description', targetField: 'invoice.lineItems[0].description', confidence: 0.94 },
      { sourceField: 'svc_lines[0].unit_rate',   targetField: 'invoice.lineItems[0].unitPrice',confidence: 0.92 },
      { sourceField: 'svc_lines[0].line_total',  targetField: 'invoice.lineItems[0].amount',   confidence: 0.97 },
      { sourceField: 'net_total',                targetField: 'invoice.subtotal',              confidence: 0.91 },
      { sourceField: 'gross_total',              targetField: 'invoice.totalAmount',           confidence: 0.99 },
      { sourceField: 'ccy',                      targetField: 'invoice.currency',              confidence: 0.98, transform: 'passthrough (GT uses "ccy", RS CDM uses "currency")' },
      { sourceField: 'po_ref',                   targetField: 'order.id',                      confidence: 0.92 },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TRADE LANE 2: MediCore (Buyer) ↔ AgroSupply (Supplier)
  // Message: PURCHASE ORDER  |  Format: EDI X12 850
  // MediCore sends standard 850; AgroSupply receives and maps to its own fields
  // ══════════════════════════════════════════════════════════════════════════

  // MediCore → outbound purchase_order (EDI X12 850)
  {
    partnerKey: 'medicore',
    format: 'edi-x12',
    messageType: 'purchase_order',
    direction: 'outbound',
    samplePayload: MC_PO_EDI,
    inferredSchema: {
      type: 'object',
      description: 'ANSI X12 850 Purchase Order — MediCore → AgroSupply',
      properties: {
        'ISA.06': { type: 'string', description: 'Sender ID (MEDICORE)' },
        'ISA.08': { type: 'string', description: 'Receiver ID (AGROSUPPLY)' },
        'BEG.03': { type: 'string', description: 'Purchase Order Number' },
        'BEG.05': { type: 'string', description: 'Purchase Order Date (YYYYMMDD)' },
        'CUR.02': { type: 'string', description: 'Currency Code' },
        'DTM.02[002]': { type: 'string', description: 'Required Delivery Date' },
        'N1.02[BY]':   { type: 'string', description: 'Buyer Name' },
        'N1.04[BY]':   { type: 'string', description: 'Buyer ID' },
        'N1.02[SE]':   { type: 'string', description: 'Seller Name' },
        'PO1.02[1]':   { type: 'string', description: 'Line 1 Qty Ordered' },
        'PO1.04[1]':   { type: 'string', description: 'Line 1 Unit Price' },
        'PO1.07[1]':   { type: 'string', description: 'Line 1 Buyer Part No (VP qualifier)' },
        'PO1.09[1]':   { type: 'string', description: 'Line 1 Supplier Part No (PI qualifier)' },
        'AMT.02':      { type: 'string', description: 'Total Order Amount' },
      },
    },
    mappingRules: [
      { sourceField: 'ISA.06',      targetField: 'sender.id',                    confidence: 0.95 },
      { sourceField: 'N1.02[BY]',   targetField: 'sender.name',                  confidence: 0.92 },
      { sourceField: 'ISA.08',      targetField: 'receiver.id',                  confidence: 0.95 },
      { sourceField: 'N1.02[SE]',   targetField: 'receiver.name',                confidence: 0.92 },
      { sourceField: 'BEG.03',      targetField: 'order.id',                     confidence: 0.97 },
      { sourceField: 'BEG.05',      targetField: 'order.date',                   confidence: 0.96, transform: 'YYYYMMDD → ISO date' },
      { sourceField: 'CUR.02',      targetField: 'order.currency',               confidence: 0.97 },
      { sourceField: 'DTM.02[002]', targetField: 'order.requestedDelivery',      confidence: 0.93, transform: 'YYYYMMDD → ISO date' },
      { sourceField: 'PO1.02[1]',   targetField: 'order.lineItems[0].quantity',  confidence: 0.94 },
      { sourceField: 'PO1.04[1]',   targetField: 'order.lineItems[0].unitPrice', confidence: 0.94 },
      { sourceField: 'PO1.07[1]',   targetField: 'order.lineItems[0].sku',       confidence: 0.91, transform: 'VP qualifier = buyer part#' },
      { sourceField: 'PO1.09[1]',   targetField: 'order.lineItems[0].supplierSku', confidence: 0.89, transform: 'PI qualifier = supplier part#' },
      { sourceField: 'AMT.02',      targetField: 'order.total',                  confidence: 0.96 },
    ],
  },

  // AgroSupply ← inbound purchase_order (same 850, AS's mapping — prefers PI/supplier SKUs)
  {
    partnerKey: 'agrosupply',
    format: 'edi-x12',
    messageType: 'purchase_order',
    direction: 'inbound',
    samplePayload: MC_PO_EDI,
    inferredSchema: {
      type: 'object',
      description: 'X12 850 received by AgroSupply — AS maps PI qualifier as primary SKU',
    },
    mappingRules: [
      { sourceField: 'ISA.06',      targetField: 'sender.id',                     confidence: 0.95 },
      { sourceField: 'N1.02[BY]',   targetField: 'sender.name',                   confidence: 0.92 },
      { sourceField: 'N1.04[BY]',   targetField: 'sender.buyerCode',              confidence: 0.90 },
      { sourceField: 'BEG.03',      targetField: 'order.id',                      confidence: 0.97 },
      { sourceField: 'BEG.05',      targetField: 'order.date',                    confidence: 0.95, transform: 'YYYYMMDD → ISO date' },
      { sourceField: 'DTM.02[002]', targetField: 'order.requestedDelivery',       confidence: 0.92, transform: 'YYYYMMDD → ISO date' },
      // AS prefers their own part# (PI qualifier) as the primary SKU
      { sourceField: 'PO1.09[1]',   targetField: 'order.lineItems[0].sku',        confidence: 0.93, transform: 'PI qualifier = AS internal SKU' },
      { sourceField: 'PO1.07[1]',   targetField: 'order.lineItems[0].buyerSku',   confidence: 0.91, transform: 'VP qualifier = buyer part# for cross-ref' },
      { sourceField: 'PO1.02[1]',   targetField: 'order.lineItems[0].quantity',   confidence: 0.94 },
      { sourceField: 'PO1.03[1]',   targetField: 'order.lineItems[0].uom',        confidence: 0.92 },
      { sourceField: 'PO1.04[1]',   targetField: 'order.lineItems[0].agreedPrice',confidence: 0.94 },
      { sourceField: 'AMT.02',      targetField: 'order.total',                   confidence: 0.96 },
      { sourceField: 'CUR.02',      targetField: 'order.currency',                confidence: 0.97 },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TRADE LANE 2: INVOICE  |  Format: XML
  // AgroSupply uses AgroInvoice/InvHdr/InvLines/InvTotals with AS-specific tags
  // MediCore expects: invoice.id, invoice.lineItems[].sku (buyer part#), invoice.totalAmount
  // ══════════════════════════════════════════════════════════════════════════

  // AgroSupply → outbound invoice (AS's XML naming)
  {
    partnerKey: 'agrosupply',
    format: 'xml',
    messageType: 'invoice',
    direction: 'outbound',
    samplePayload: AS_INVOICE_XML,
    inferredSchema: {
      type: 'object',
      description: 'AgroSupply invoice XML — AS field naming (InvHdr, InvLines, AgroPartNo, BuyerPartNo)',
      properties: {
        AgroInvoice: {
          type: 'object',
          properties: {
            InvHdr: {
              type: 'object',
              properties: {
                InvNo:    { type: 'string' }, InvDate: { type: 'string', format: 'date' },
                DueDt:    { type: 'string', format: 'date' }, CCY: { type: 'string' },
                PORef:    { type: 'string' }, PayTerms: { type: 'string' },
              },
              required: ['InvNo', 'InvDate', 'CCY'],
            },
            Supplier: {
              type: 'object',
              properties: {
                SuppCode: { type: 'string' }, SuppName: { type: 'string' },
                TaxRegNo: { type: 'string' }, BankAcct: { type: 'string' },
              },
            },
            Customer: {
              type: 'object',
              properties: {
                CustCode: { type: 'string' }, CustName: { type: 'string' },
                BillAddr: { type: 'object' },
              },
            },
            InvLines: {
              type: 'object',
              properties: {
                Line: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      AgroPartNo: { type: 'string', description: 'AS internal part number' },
                      BuyerPartNo: { type: 'string', description: 'Buyer (MediCore) part number' },
                      Descr: { type: 'string' }, ShipQty: { type: 'integer' },
                      UOM: { type: 'string' }, UnitPrice: { type: 'number' }, LineAmt: { type: 'number' },
                    },
                  },
                },
              },
            },
            InvTotals: {
              type: 'object',
              properties: {
                SubTotal: { type: 'number' }, TaxAmt: { type: 'number' }, TotalAmt: { type: 'number' },
              },
            },
          },
        },
      },
    },
    mappingRules: [
      { sourceField: 'AgroInvoice.InvHdr.InvNo',             targetField: 'invoice.id',                    confidence: 0.99 },
      { sourceField: 'AgroInvoice.InvHdr.InvDate',           targetField: 'invoice.date',                  confidence: 0.98 },
      { sourceField: 'AgroInvoice.InvHdr.DueDt',             targetField: 'invoice.dueDate',               confidence: 0.97 },
      { sourceField: 'AgroInvoice.InvHdr.PORef',             targetField: 'order.id',                      confidence: 0.95 },
      { sourceField: 'AgroInvoice.InvHdr.CCY',               targetField: 'invoice.currency',              confidence: 0.99 },
      { sourceField: 'AgroInvoice.Supplier.SuppCode',        targetField: 'sender.id',                     confidence: 0.94 },
      { sourceField: 'AgroInvoice.Supplier.SuppName',        targetField: 'sender.name',                   confidence: 0.97 },
      { sourceField: 'AgroInvoice.Customer.CustCode',        targetField: 'receiver.id',                   confidence: 0.94 },
      { sourceField: 'AgroInvoice.Customer.CustName',        targetField: 'receiver.name',                 confidence: 0.97 },
      { sourceField: 'AgroInvoice.InvLines.Line[0].AgroPartNo',  targetField: 'invoice.lineItems[0].sku',         confidence: 0.91 },
      { sourceField: 'AgroInvoice.InvLines.Line[0].BuyerPartNo', targetField: 'invoice.lineItems[0].buyerSku',    confidence: 0.93 },
      { sourceField: 'AgroInvoice.InvLines.Line[0].ShipQty',     targetField: 'invoice.lineItems[0].quantity',    confidence: 0.96 },
      { sourceField: 'AgroInvoice.InvLines.Line[0].UnitPrice',   targetField: 'invoice.lineItems[0].unitPrice',   confidence: 0.97 },
      { sourceField: 'AgroInvoice.InvLines.Line[0].LineAmt',     targetField: 'invoice.lineItems[0].amount',      confidence: 0.98 },
      { sourceField: 'AgroInvoice.InvTotals.TotalAmt',       targetField: 'invoice.totalAmount',           confidence: 0.99 },
    ],
  },

  // MediCore ← inbound invoice (same AS XML, MC's mapping — prefers BuyerPartNo as SKU)
  {
    partnerKey: 'medicore',
    format: 'xml',
    messageType: 'invoice',
    direction: 'inbound',
    samplePayload: AS_INVOICE_XML,
    inferredSchema: {
      type: 'object',
      description: 'AS invoice received by MediCore — MC maps BuyerPartNo as primary SKU for internal matching',
    },
    mappingRules: [
      { sourceField: 'AgroInvoice.InvHdr.InvNo',             targetField: 'invoice.id',                    confidence: 0.99 },
      { sourceField: 'AgroInvoice.InvHdr.InvDate',           targetField: 'invoice.date',                  confidence: 0.98 },
      { sourceField: 'AgroInvoice.InvHdr.DueDt',             targetField: 'invoice.dueDate',               confidence: 0.97 },
      { sourceField: 'AgroInvoice.InvHdr.PORef',             targetField: 'order.id',                      confidence: 0.96 },
      { sourceField: 'AgroInvoice.InvHdr.CCY',               targetField: 'invoice.currency',              confidence: 0.99 },
      { sourceField: 'AgroInvoice.Supplier.SuppCode',        targetField: 'sender.id',                     confidence: 0.93 },
      { sourceField: 'AgroInvoice.Customer.CustCode',        targetField: 'receiver.id',                   confidence: 0.94 },
      // MC maps BuyerPartNo (their own part#) as the primary SKU for internal system matching
      { sourceField: 'AgroInvoice.InvLines.Line[0].BuyerPartNo', targetField: 'invoice.lineItems[0].sku',         confidence: 0.94, transform: 'BuyerPartNo = MC internal part# (ITEM-HERB-*)' },
      { sourceField: 'AgroInvoice.InvLines.Line[0].AgroPartNo',  targetField: 'invoice.lineItems[0].supplierSku', confidence: 0.90 },
      { sourceField: 'AgroInvoice.InvLines.Line[0].ShipQty',     targetField: 'invoice.lineItems[0].quantity',    confidence: 0.96 },
      { sourceField: 'AgroInvoice.InvLines.Line[0].UnitPrice',   targetField: 'invoice.lineItems[0].unitPrice',   confidence: 0.97 },
      { sourceField: 'AgroInvoice.InvTotals.TotalAmt',       targetField: 'invoice.totalAmount',           confidence: 0.99 },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TRADE LANE 2: SHIPMENT NOTICE  |  Format: EDIFACT DESADV
  // AgroSupply uses DESADV D:96A with UNB, BGM, NAD, LIN, QTY, MOA segments
  // MediCore expects: shipment.id, order.id, shipment.estimatedDelivery, lineItems
  // ══════════════════════════════════════════════════════════════════════════

  // AgroSupply → outbound shipment / EDIFACT DESADV
  {
    partnerKey: 'agrosupply',
    format: 'edifact',
    messageType: 'shipment',
    direction: 'outbound',
    samplePayload: AS_DESADV_EDIFACT,
    inferredSchema: {
      type: 'object',
      description: 'UN/EDIFACT DESADV D:96A — AgroSupply despatch advice to MediCore',
      properties: {
        'UNB.2':      { type: 'string', description: 'Sender (AGROSUPPLY)' },
        'UNB.3':      { type: 'string', description: 'Recipient (MEDICORE)' },
        'UNB.4':      { type: 'string', description: 'Date/time of preparation' },
        'BGM.2':      { type: 'string', description: 'Shipment/despatch notice number' },
        'DTM.2[137]': { type: 'string', description: 'Document date' },
        'DTM.2[2]':   { type: 'string', description: 'Expected delivery date' },
        'RFF.2[ON]':  { type: 'string', description: 'Buyer PO reference' },
        'NAD.2[SE]':  { type: 'string', description: 'Supplier party ID' },
        'NAD.2[CN]':  { type: 'string', description: 'Consignee party ID' },
        'PAC.1':      { type: 'string', description: 'Number of packages' },
        'MEA.3.2[AAB]': { type: 'string', description: 'Gross weight in KGM' },
        'LIN.2':      { type: 'string', description: 'Line item article number' },
        'QTY.2[12]':  { type: 'string', description: 'Despatch quantity' },
        'MOA.2[128]': { type: 'string', description: 'Invoice amount' },
      },
    },
    mappingRules: [
      { sourceField: 'UNB.2',       targetField: 'sender.id',                    confidence: 0.94 },
      { sourceField: 'UNB.3',       targetField: 'receiver.id',                  confidence: 0.94 },
      { sourceField: 'UNB.4',       targetField: 'envelope.timestamp',           confidence: 0.90, transform: 'YYMMDD:HHMM → ISO datetime' },
      { sourceField: 'BGM.2',       targetField: 'shipment.id',                  confidence: 0.96 },
      { sourceField: 'DTM.2[2]',    targetField: 'shipment.estimatedDelivery',   confidence: 0.93, transform: 'YYYYMMDD:102 → ISO date' },
      { sourceField: 'RFF.2[ON]',   targetField: 'order.id',                     confidence: 0.95 },
      { sourceField: 'NAD.2[SE]',   targetField: 'sender.partyCode',             confidence: 0.91 },
      { sourceField: 'NAD.2[CN]',   targetField: 'receiver.partyCode',           confidence: 0.91 },
      { sourceField: 'PAC.1',       targetField: 'shipment.packageCount',        confidence: 0.90 },
      { sourceField: 'MEA.3.2',     targetField: 'shipment.totalWeightKg',       confidence: 0.88 },
      { sourceField: 'LIN.2[1]',    targetField: 'order.lineItems[0].sku',       confidence: 0.89, transform: 'SA qualifier = AS article number' },
      { sourceField: 'QTY.2[1]',    targetField: 'order.lineItems[0].quantity',  confidence: 0.92, transform: 'QTY+12 = despatch qty' },
      { sourceField: 'MOA.2[128]',  targetField: 'invoice.totalAmount',          confidence: 0.87 },
    ],
  },

  // MediCore ← inbound shipment notice (same DESADV, MC's mapping)
  {
    partnerKey: 'medicore',
    format: 'edifact',
    messageType: 'shipment',
    direction: 'inbound',
    samplePayload: AS_DESADV_EDIFACT,
    inferredSchema: {
      type: 'object',
      description: 'AS DESADV received by MediCore — MC mapping focuses on PO cross-ref and ETA',
    },
    mappingRules: [
      { sourceField: 'BGM.2',       targetField: 'shipment.id',                  confidence: 0.95 },
      { sourceField: 'DTM.2[137]',  targetField: 'envelope.timestamp',           confidence: 0.90, transform: 'YYYYMMDD:102 → ISO datetime' },
      { sourceField: 'DTM.2[2]',    targetField: 'shipment.estimatedDelivery',   confidence: 0.93 },
      { sourceField: 'RFF.2[ON]',   targetField: 'order.id',                     confidence: 0.96, transform: 'Cross-ref to MC PO number' },
      { sourceField: 'NAD.2[SE]',   targetField: 'sender.id',                    confidence: 0.91 },
      { sourceField: 'NAD.2[CN]',   targetField: 'receiver.id',                  confidence: 0.91 },
      { sourceField: 'MEA.3.2',     targetField: 'shipment.totalWeightKg',       confidence: 0.87 },
      { sourceField: 'LIN.2[1]',    targetField: 'order.lineItems[0].supplierSku', confidence: 0.86 },
      { sourceField: 'QTY.2[1]',    targetField: 'order.lineItems[0].shippedQty', confidence: 0.92 },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TRADE LANE 3: AgroSupply → GlobalTrade (3PL)
  // Message: SHIPMENT INSTRUCTION  |  Format: EDIFACT IFTMIN
  // AS instructs GT to collect cargo and deliver to MediCore
  // ══════════════════════════════════════════════════════════════════════════

  // AgroSupply → outbound shipment_instruction / EDIFACT IFTMIN
  {
    partnerKey: 'agrosupply',
    format: 'edifact',
    messageType: 'shipment_instruction',
    direction: 'outbound',
    samplePayload: AS_IFTMIN_EDIFACT,
    inferredSchema: {
      type: 'object',
      description: 'UN/EDIFACT IFTMIN D:95B — AgroSupply freight booking instruction to GlobalTrade',
      properties: {
        'UNB.2':      { type: 'string', description: 'Sender (AGROSUPPLY)' },
        'UNB.3':      { type: 'string', description: 'Recipient (GLOBALTRADE)' },
        'BGM.2':      { type: 'string', description: 'Shipment instruction reference' },
        'DTM.2[2]':   { type: 'string', description: 'Required pickup/delivery date' },
        'TSR.1':      { type: 'string', description: 'Transport service requirement' },
        'RFF.2[CR]':  { type: 'string', description: 'Customer reference (PO number)' },
        'NAD.2[CZ]':  { type: 'string', description: 'Consignor (shipper) party ID' },
        'NAD.2[CN]':  { type: 'string', description: 'Consignee (receiver) party ID' },
        'NAD.2[CA]':  { type: 'string', description: 'Carrier party ID' },
        'GID.1':      { type: 'string', description: 'Goods item number' },
        'GID.2':      { type: 'string', description: 'Package count and type' },
        'MEA.3.2[AAB]': { type: 'string', description: 'Gross weight in KGM' },
        'MEA.3.2[VOL]': { type: 'string', description: 'Volume in MTQ' },
      },
    },
    mappingRules: [
      { sourceField: 'UNB.2',      targetField: 'sender.id',                    confidence: 0.94 },
      { sourceField: 'UNB.3',      targetField: 'receiver.id',                  confidence: 0.94 },
      { sourceField: 'BGM.2',      targetField: 'shipment.id',                  confidence: 0.96 },
      { sourceField: 'DTM.2[137]', targetField: 'envelope.timestamp',           confidence: 0.90, transform: 'YYYYMMDD:102 → ISO datetime' },
      { sourceField: 'DTM.2[2]',   targetField: 'shipment.estimatedDelivery',   confidence: 0.93 },
      { sourceField: 'RFF.2[CR]',  targetField: 'order.id',                     confidence: 0.94, transform: 'Customer reference = buyer PO' },
      { sourceField: 'NAD.2[CZ]',  targetField: 'sender.partyCode',             confidence: 0.91, transform: 'CZ = consignor (shipper)' },
      { sourceField: 'NAD.2[CN]',  targetField: 'receiver.partyCode',           confidence: 0.91, transform: 'CN = consignee (final recipient)' },
      { sourceField: 'NAD.2[CA]',  targetField: 'shipment.carrierId',           confidence: 0.92, transform: 'CA = carrier/3PL' },
      { sourceField: 'GID.2',      targetField: 'shipment.packageCount',        confidence: 0.88, transform: 'format: count:type (e.g. 25:BX)' },
      { sourceField: 'MEA.3.2',    targetField: 'shipment.totalWeightKg',       confidence: 0.87 },
    ],
  },

  // GlobalTrade ← inbound shipment_instruction (same IFTMIN, GT's mapping)
  {
    partnerKey: 'globaltrade',
    format: 'edifact',
    messageType: 'shipment_instruction',
    direction: 'inbound',
    samplePayload: AS_IFTMIN_EDIFACT,
    inferredSchema: {
      type: 'object',
      description: 'AS IFTMIN received by GlobalTrade — GT maps to freight booking fields',
    },
    mappingRules: [
      { sourceField: 'UNB.2',      targetField: 'sender.id',                    confidence: 0.94 },
      { sourceField: 'BGM.2',      targetField: 'shipment.id',                  confidence: 0.96 },
      { sourceField: 'DTM.2[2]',   targetField: 'shipment.requiredPickupDate',  confidence: 0.93 },
      { sourceField: 'RFF.2[CR]',  targetField: 'order.id',                     confidence: 0.93 },
      { sourceField: 'NAD.2[CZ]',  targetField: 'sender.id',                    confidence: 0.90, transform: 'CZ = consignor = cargo origin party' },
      { sourceField: 'NAD.2[CN]',  targetField: 'receiver.id',                  confidence: 0.90, transform: 'CN = consignee = final destination party' },
      { sourceField: 'GID.2',      targetField: 'shipment.packageCount',        confidence: 0.87 },
      { sourceField: 'MEA.3.2',    targetField: 'shipment.grossWeightKg',       confidence: 0.87 },
      { sourceField: 'TSR.1',      targetField: 'shipment.serviceLevel',        confidence: 0.82 },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TRADE LANE 4: GlobalTrade → NexusPay (Payment)
  // Message: PAYMENT  |  Format: JSON
  // GlobalTrade uses gt_pmt_ref, gross_amt, ccy, debit_party/credit_party
  // NexusPay expects: payment.id, payment.amount, payment.currency, sender/receiver
  // ══════════════════════════════════════════════════════════════════════════

  // GlobalTrade → outbound payment (GT's JSON naming)
  {
    partnerKey: 'globaltrade',
    format: 'json',
    messageType: 'payment',
    direction: 'outbound',
    samplePayload: GT_PAYMENT_JSON,
    inferredSchema: {
      type: 'object',
      description: 'GT payment instruction — GT naming (gt_pmt_ref, gross_amt, ccy, debit_party, credit_party)',
      properties: {
        gt_pmt_ref:  { type: 'string', description: 'GT payment reference' },
        pmt_type:    { type: 'string', enum: ['ACH_CREDIT', 'WIRE', 'SWIFT'] },
        value_date:  { type: 'string', format: 'date' },
        gross_amt:   { type: 'number' },
        ccy:         { type: 'string', minLength: 3, maxLength: 3 },
        debit_party: {
          type: 'object',
          properties: {
            entity: { type: 'string' }, acct_no: { type: 'string' }, bank_bic: { type: 'string' },
          },
        },
        credit_party: {
          type: 'object',
          properties: {
            entity: { type: 'string' }, acct_no: { type: 'string' }, bank_bic: { type: 'string' },
          },
        },
        pmt_ref_1:       { type: 'string', description: 'Invoice reference' },
        pmt_ref_2:       { type: 'string', description: 'PO reference' },
        remittance_text: { type: 'string' },
      },
      required: ['gt_pmt_ref', 'gross_amt', 'ccy'],
    },
    mappingRules: [
      { sourceField: 'gt_pmt_ref',        targetField: 'payment.id',          confidence: 0.98 },
      { sourceField: 'pmt_type',          targetField: 'payment.method',      confidence: 0.95 },
      { sourceField: 'value_date',        targetField: 'payment.date',        confidence: 0.97 },
      { sourceField: 'gross_amt',         targetField: 'payment.amount',      confidence: 0.99 },
      { sourceField: 'ccy',              targetField: 'payment.currency',     confidence: 0.99, transform: 'GT uses "ccy", CDM uses "currency"' },
      { sourceField: 'debit_party.entity',  targetField: 'sender.name',       confidence: 0.95 },
      { sourceField: 'debit_party.acct_no', targetField: 'sender.accountId',  confidence: 0.93 },
      { sourceField: 'credit_party.entity', targetField: 'receiver.name',     confidence: 0.95 },
      { sourceField: 'credit_party.acct_no',targetField: 'receiver.accountId',confidence: 0.93 },
      { sourceField: 'pmt_ref_1',         targetField: 'payment.reference',   confidence: 0.94 },
      { sourceField: 'remittance_text',   targetField: 'payment.description', confidence: 0.88 },
    ],
  },

  // NexusPay ← inbound payment (same GT JSON, NX mapping — NX uses standard field names internally)
  {
    partnerKey: 'nexuspay',
    format: 'json',
    messageType: 'payment',
    direction: 'inbound',
    samplePayload: GT_PAYMENT_JSON,
    inferredSchema: {
      type: 'object',
      description: 'GT payment received by NexusPay — NX maps to NX processing fields',
    },
    mappingRules: [
      { sourceField: 'gt_pmt_ref',          targetField: 'payment.id',           confidence: 0.98 },
      { sourceField: 'pmt_type',            targetField: 'payment.method',       confidence: 0.94 },
      { sourceField: 'value_date',          targetField: 'payment.valueDate',    confidence: 0.97 },
      { sourceField: 'gross_amt',           targetField: 'payment.amount',       confidence: 0.99 },
      { sourceField: 'ccy',                targetField: 'payment.currency',      confidence: 0.99 },
      { sourceField: 'debit_party.acct_no', targetField: 'sender.accountId',     confidence: 0.93 },
      { sourceField: 'debit_party.bank_bic',targetField: 'sender.bankBic',       confidence: 0.92 },
      { sourceField: 'credit_party.acct_no',targetField: 'receiver.accountId',   confidence: 0.93 },
      { sourceField: 'pmt_ref_1',           targetField: 'payment.invoiceRef',   confidence: 0.94, transform: 'GT pmt_ref_1 = invoice number' },
      { sourceField: 'remittance_text',     targetField: 'payment.remittanceInfo',confidence: 0.87 },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TRADE LANE 4: NexusPay → GlobalTrade (Remittance)
  // Message: REMITTANCE  |  Format: CSV
  // NexusPay uses nx_remit_id, gt_pmt_ref, paid_amt, settlement_dt, nx_txn_id
  // GlobalTrade expects: payment.id, payment.reference, payment.amount, payment.date
  // ══════════════════════════════════════════════════════════════════════════

  // NexusPay → outbound remittance (NX CSV naming)
  {
    partnerKey: 'nexuspay',
    format: 'csv',
    messageType: 'remittance',
    direction: 'outbound',
    samplePayload: NX_REMITTANCE_CSV,
    inferredSchema: {
      type: 'object',
      description: 'NexusPay remittance CSV — NX naming (nx_remit_id, gt_pmt_ref, paid_amt, nx_txn_id)',
      properties: {
        nx_remit_id:       { type: 'string', description: 'NX internal remittance ID' },
        gt_pmt_ref:        { type: 'string', description: 'Original GT payment reference' },
        payer_code:        { type: 'string' },
        payer_name:        { type: 'string' },
        invoice_ref:       { type: 'string' },
        invoice_dt:        { type: 'string', format: 'date' },
        paid_amt:          { type: 'number' },
        ccy:               { type: 'string' },
        settlement_dt:     { type: 'string', format: 'date' },
        settlement_status: { type: 'string', enum: ['SETTLED', 'PENDING', 'FAILED'] },
        nx_txn_id:         { type: 'string', description: 'NX transaction ID for bank reconciliation' },
      },
      required: ['nx_remit_id', 'gt_pmt_ref', 'paid_amt', 'ccy', 'settlement_dt'],
    },
    mappingRules: [
      { sourceField: 'nx_remit_id',       targetField: 'payment.id',            confidence: 0.97 },
      { sourceField: 'gt_pmt_ref',        targetField: 'payment.reference',     confidence: 0.98 },
      { sourceField: 'payer_code',        targetField: 'sender.id',             confidence: 0.94 },
      { sourceField: 'payer_name',        targetField: 'sender.name',           confidence: 0.96 },
      { sourceField: 'invoice_ref',       targetField: 'invoice.id',            confidence: 0.96 },
      { sourceField: 'paid_amt',          targetField: 'payment.amount',        confidence: 0.99 },
      { sourceField: 'ccy',              targetField: 'payment.currency',       confidence: 0.99 },
      { sourceField: 'settlement_dt',     targetField: 'payment.date',          confidence: 0.97 },
      { sourceField: 'settlement_status', targetField: 'payment.status',        confidence: 0.95, transform: 'SETTLED→completed, PENDING→processing, FAILED→failed' },
      { sourceField: 'nx_txn_id',         targetField: 'payment.transactionId', confidence: 0.93 },
    ],
  },

  // GlobalTrade ← inbound remittance (same NX CSV, GT's mapping)
  {
    partnerKey: 'globaltrade',
    format: 'csv',
    messageType: 'remittance',
    direction: 'inbound',
    samplePayload: NX_REMITTANCE_CSV,
    inferredSchema: {
      type: 'object',
      description: 'NX remittance received by GlobalTrade — GT maps nx_remit_id and gt_pmt_ref for reconciliation',
    },
    mappingRules: [
      { sourceField: 'nx_remit_id',       targetField: 'payment.id',            confidence: 0.96 },
      { sourceField: 'gt_pmt_ref',        targetField: 'payment.reference',     confidence: 0.99, transform: 'Cross-ref to original GT payment ref for reconciliation' },
      { sourceField: 'invoice_ref',       targetField: 'invoice.id',            confidence: 0.97 },
      { sourceField: 'paid_amt',          targetField: 'payment.amount',        confidence: 0.99 },
      { sourceField: 'ccy',              targetField: 'payment.currency',       confidence: 0.99 },
      { sourceField: 'settlement_dt',     targetField: 'payment.date',          confidence: 0.97 },
      { sourceField: 'settlement_status', targetField: 'payment.status',        confidence: 0.94 },
      { sourceField: 'nx_txn_id',         targetField: 'payment.bankTransactionId', confidence: 0.91 },
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
