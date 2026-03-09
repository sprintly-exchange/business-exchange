'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { integrationsApi, subscriptionsApi, mappingsApi } from '@/lib/api';
import { getPartnerId } from '@/lib/utils';
import { Badge, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { statusColor, fmtDateTime, cn } from '@/lib/utils';
import {
  Send, RefreshCw, Search, X, ArrowUpRight, ArrowDownLeft, ChevronRight,
  Zap, AlertCircle, CheckCircle, AlertTriangle, Activity, Package,
} from 'lucide-react';

interface Message {
  id: string;
  sourcePartnerId: string;
  targetPartnerId: string;
  sourcePartnerName?: string;
  targetPartnerName?: string;
  format: string;
  status: string;
  retries: number;
  rawPayload?: string;
  mappedPayload?: string;
  errorMessage?: string;
  schemaId?: string;
  schemaVersion?: number;
  schemaFormat?: string;
  createdAt: string;
  updatedAt: string;
}

interface SendTarget { partnerId: string; companyName: string; subscriptionId: string }
interface SchemaReg { id: string; format: string; status: string; isActive: boolean; version: number }
interface Stats { total: number; delivered: number; failed: number; processing: number }

const STATUSES = ['', 'received', 'processing', 'delivered', 'failed', 'dead_lettered'];
const FORMATS = ['json', 'xml', 'csv', 'edi-x12', 'edifact'];
const PAGE_SIZE = 20;

const FORMAT_LABELS: Record<string, string> = {
  json: 'JSON', xml: 'XML', csv: 'CSV', 'edi-x12': 'EDI X12', edifact: 'EDIFACT',
};

const FORMAT_EXAMPLES: Record<string, string> = {
  json: '{\n  "orderId": "ORD-001",\n  "total": 99.99\n}',
  xml: '<Order>\n  <OrderId>ORD-001</OrderId>\n  <Total>99.99</Total>\n</Order>',
  csv: 'orderId,total\nORD-001,99.99',
  'edi-x12': 'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *230101*1200*^*00501*000000001*0*P*>~',
  edifact: "UNA:+.? 'UNB+UNOA:1+SENDER+RECEIVER+230101:1200+1'",
};

const FORMAT_COLORS: Record<string, string> = {
  json: 'bg-blue-100 text-blue-700',
  xml: 'bg-purple-100 text-purple-700',
  csv: 'bg-orange-100 text-orange-700',
  'edi-x12': 'bg-teal-100 text-teal-700',
  edifact: 'bg-pink-100 text-pink-700',
};

function isEmptyCdm(mappedPayload?: string): boolean {
  if (!mappedPayload) return true;
  const t = mappedPayload.trim();
  return t === '{}' || t === '"{}"';
}

function fmtLabel(f: string) { return FORMAT_LABELS[f] ?? f.toUpperCase(); }
function fmtColor(f: string) { return FORMAT_COLORS[f] ?? 'bg-gray-100 text-gray-600'; }

/* ── Format badge shown in table rows ──────────────────────────────────────── */
function FormatBadge({ format, schemaFormat, schemaId }: { format: string; schemaFormat?: string; schemaId?: string }) {
  if (schemaId && schemaFormat && schemaFormat !== format) {
    return (
      <span className="flex items-center gap-1 flex-wrap">
        <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded', fmtColor(schemaFormat))}>{fmtLabel(schemaFormat)}</span>
        <span className="text-gray-400 text-xs">→</span>
        <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded', fmtColor(format))}>{fmtLabel(format)}</span>
      </span>
    );
  }
  if (schemaId) {
    return (
      <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1', fmtColor(format))}>
        <Zap className="w-3 h-3" />{fmtLabel(format)}
      </span>
    );
  }
  return <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded', fmtColor(format))}>{fmtLabel(format)}</span>;
}

/* ── Mapping quality badge shown in table rows ─────────────────────────────── */
function MappingBadge({ schemaId, mappedPayload }: { schemaId?: string; mappedPayload?: string }) {
  if (!schemaId) return <span className="text-gray-300 text-xs">—</span>;
  if (isEmptyCdm(mappedPayload)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle className="w-3 h-3" />Empty CDM
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
      <Zap className="w-3 h-3" />Mapped
    </span>
  );
}

/* ── Stats card ────────────────────────────────────────────────────────────── */
function StatCard({ label, value, colorCls, icon }: { label: string; value: number; colorCls: string; icon: React.ReactNode }) {
  return (
    <div className={cn('rounded-xl border px-5 py-4 flex items-center gap-4', colorCls)}>
      <div className="shrink-0">{icon}</div>
      <div>
        <p className="text-2xl font-bold leading-none">{(value ?? 0).toLocaleString()}</p>
        <p className="text-xs font-medium mt-1 opacity-70">{label}</p>
      </div>
    </div>
  );
}

/* ── Detail Panel ──────────────────────────────────────────────────────────── */
function DetailPanel({ msg, myId, onClose }: { msg: Message; myId: string; onClose: () => void }) {
  const tryPretty = (s?: string) => {
    try { return JSON.stringify(JSON.parse(s ?? ''), null, 2); } catch { return s ?? '—'; }
  };
  const displayStatus = (status: string) =>
    status === 'delivered' && msg.targetPartnerId === myId ? 'received' : status;

  const hasFormatTransform = !!msg.schemaId && !!msg.schemaFormat && msg.schemaFormat !== msg.format;
  const emptyCdm = isEmptyCdm(msg.mappedPayload);
  const hasMappingWarning = msg.errorMessage?.startsWith('Mapping warning:');

  let cdmFieldCount = 0;
  if (!emptyCdm && msg.mappedPayload) {
    try { cdmFieldCount = Object.keys(JSON.parse(msg.mappedPayload)).length; } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Message Detail</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-5 text-sm">
          {/* ── a) Format Flow ─────────────────────────────────────────── */}
          <div className="border border-gray-100 rounded-lg p-4 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Format Flow</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('font-mono text-sm font-semibold px-2.5 py-1 rounded-lg', fmtColor(msg.schemaFormat ?? msg.format))}>
                {fmtLabel(msg.schemaFormat ?? msg.format)}
              </span>
              {hasFormatTransform ? (
                <>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                    <Zap className="w-3 h-3" />CDM
                  </span>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className={cn('font-mono text-sm font-semibold px-2.5 py-1 rounded-lg', fmtColor(msg.format))}>
                    {fmtLabel(msg.format)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className="text-xs text-gray-400 italic">as-is</span>
                  <span className="text-gray-400 text-xs">→</span>
                  <span className={cn('font-mono text-sm font-semibold px-2.5 py-1 rounded-lg', fmtColor(msg.format))}>
                    {fmtLabel(msg.format)}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
              <span className="font-medium">{msg.sourcePartnerName ?? msg.sourcePartnerId.slice(0, 8) + '…'}</span>
              <span className="text-gray-300">→</span>
              <span className="font-medium">{msg.targetPartnerName ?? msg.targetPartnerId.slice(0, 8) + '…'}</span>
            </div>
          </div>

          {/* ── Core meta grid ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs text-gray-400 mb-0.5">Message ID</p><p className="font-mono text-xs text-gray-700 break-all">{msg.id}</p></div>
            <div><p className="text-xs text-gray-400 mb-0.5">Status</p><Badge label={displayStatus(msg.status)} className={statusColor(msg.status)} /></div>
            <div><p className="text-xs text-gray-400 mb-0.5">Retries</p><p className="text-gray-700">{msg.retries}</p></div>
            <div><p className="text-xs text-gray-400 mb-0.5">Sent at</p><p className="text-gray-700 text-xs">{fmtDateTime(msg.createdAt)}</p></div>
            <div><p className="text-xs text-gray-400 mb-0.5">Updated at</p><p className="text-gray-700 text-xs">{fmtDateTime(msg.updatedAt)}</p></div>
            <div className="col-span-2"><p className="text-xs text-gray-400 mb-0.5">From (Sender)</p><p className="font-semibold text-gray-800">{msg.sourcePartnerName ?? '—'}</p><p className="font-mono text-xs text-gray-400 break-all">{msg.sourcePartnerId}</p></div>
            <div className="col-span-2"><p className="text-xs text-gray-400 mb-0.5">To (Receiver)</p><p className="font-semibold text-gray-800">{msg.targetPartnerName ?? '—'}</p><p className="font-mono text-xs text-gray-400 break-all">{msg.targetPartnerId}</p></div>
          </div>

          {/* ── b) Mapping Diagnosis ───────────────────────────────────── */}
          {msg.schemaId ? (
            <div className="border border-indigo-100 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-indigo-50 flex items-center gap-2">
                <Zap className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Mapping Diagnosis</span>
              </div>
              <div className="px-4 py-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-gray-400">Schema ID</span><p className="font-mono text-gray-700">{msg.schemaId.slice(0, 12)}…</p></div>
                  <div><span className="text-gray-400">Version</span><p className="text-gray-700">v{msg.schemaVersion ?? '?'}</p></div>
                  <div><span className="text-gray-400">Schema Format</span><p className="font-mono text-gray-700">{(msg.schemaFormat ?? msg.format).toUpperCase()}</p></div>
                  <div><span className="text-gray-400">Output Format</span><p className="font-mono text-gray-700">{msg.format.toUpperCase()}</p></div>
                </div>
                {emptyCdm ? (
                  <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-amber-700 mb-1">⚠ CDM output is empty</p>
                      <p className="text-xs text-amber-600">
                        All mapping rules failed to match. Check that your schema was registered with a sample payload
                        matching this message format. The payload was delivered as-is.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 bg-green-50 border border-green-200 rounded-lg p-2.5 flex gap-2 items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    <p className="text-xs text-green-700 font-medium">
                      ✓ CDM mapping produced {cdmFieldCount} field{cdmFieldCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-500">
              No mapping applied — payload delivered as-is (no active schema found for this partner/format)
            </div>
          )}

          {/* ── c) Error / Warning section ─────────────────────────────── */}
          {msg.status === 'failed' && msg.errorMessage && !hasMappingWarning && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-red-700 mb-0.5">Failure Reason</p>
                <p className="text-xs text-red-600 break-all">{msg.errorMessage}</p>
              </div>
            </div>
          )}
          {hasMappingWarning && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-0.5">Mapping Warning</p>
                <p className="text-xs text-amber-600 break-all">{msg.errorMessage}</p>
              </div>
            </div>
          )}

          {/* ── d) Payload sections ─────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Raw Payload (Original)</p>
              {hasFormatTransform && (
                <span className="text-xs text-indigo-500 font-medium">Source: {fmtLabel(msg.schemaFormat!)}</span>
              )}
            </div>
            <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-auto max-h-60 whitespace-pre-wrap">
              {tryPretty(msg.rawPayload)}
            </pre>
          </div>
          {msg.mappedPayload && msg.mappedPayload !== msg.rawPayload && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mapped Payload (CDM Output)</p>
                {hasFormatTransform && (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <Zap className="w-3 h-3" />Transformed → {fmtLabel(msg.format)}
                  </span>
                )}
              </div>
              <pre className={cn(
                'border rounded-lg p-3 text-xs overflow-auto max-h-60 whitespace-pre-wrap',
                emptyCdm ? 'bg-amber-50 border-amber-200' : 'bg-indigo-50 border-indigo-100',
              )}>
                {tryPretty(msg.mappedPayload)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Page
══════════════════════════════════════════════════════════════════════════════ */
export default function IntegrationsPage() {
  const myId = getPartnerId() ?? '';
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Send form state
  const [sendTargets, setSendTargets] = useState<SendTarget[]>([]);
  const [activeSchemas, setActiveSchemas] = useState<SchemaReg[]>([]);
  const [targetPartnerId, setTargetPartnerId] = useState('');
  const [format, setFormat] = useState('json');
  const [payload, setPayload] = useState(FORMAT_EXAMPLES['json']);

  // Filters
  const [direction, setDirection] = useState<'all' | 'sent' | 'received'>('all');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFormat, setFilterFormat] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedSearch(search), 400);
  }, [search]);

  // Load send form data + stats once
  useEffect(() => {
    Promise.all([
      subscriptionsApi.getSendTargets(),
      mappingsApi.listSchemas(getPartnerId() ?? ''),
    ]).then(([tRes, sRes]) => {
      setSendTargets((tRes.data as { data: SendTarget[] }).data ?? []);
      const schemas = (sRes.data as { data: SchemaReg[] }).data ?? [];
      setActiveSchemas(schemas.filter(s => s.isActive));
    }).catch(() => {});

    integrationsApi.getStats()
      .then(r => {
        const d = r.data as { data?: { byStatus: Record<string, number> } };
        if (d.data?.byStatus) {
          const s = d.data.byStatus;
          const total = Object.values(s).reduce((a, b) => a + b, 0);
          setStats({
            total,
            delivered: (s['delivered'] ?? 0) + (s['received'] ?? 0),
            failed: (s['failed'] ?? 0) + (s['dead_lettered'] ?? 0),
            processing: s['processing'] ?? 0,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { setPayload(FORMAT_EXAMPLES[format] ?? ''); }, [format]);

  const load = useCallback(() => {
    setLoading(true);
    integrationsApi.listMessages({
      direction, status: filterStatus || undefined, format: filterFormat || undefined,
      search: debouncedSearch || undefined, from: from || undefined, to: to || undefined,
      limit: PAGE_SIZE, offset: page * PAGE_SIZE,
    }).then(r => {
      const res = r.data as { data: Message[]; total: number };
      setMessages(res.data ?? []);
      setTotal(res.total ?? 0);
    }).finally(() => setLoading(false));
  }, [direction, filterStatus, filterFormat, debouncedSearch, from, to, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  // Stats — prefer API response; fall back to counting current page
  const derivedStats: Stats = stats ?? {
    total,
    delivered: messages.filter(m => m.status === 'delivered').length,
    failed: messages.filter(m => m.status === 'failed' || m.status === 'dead_lettered').length,
    processing: messages.filter(m => m.status === 'processing').length,
  };

  const activeMapping = activeSchemas.find(s => s.format === format);
  const selectedTarget = sendTargets.find(t => t.partnerId === targetPartnerId);

  const sendMsg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPartnerId) return;
    setSending(true);
    setResult(null);
    try {
      const body = format === 'json' ? JSON.parse(payload) : payload;
      const res = await integrationsApi.sendMessage(targetPartnerId, body, format);
      const d = res.data as { data?: { messageId?: string } };
      setResult({ ok: true, text: `✓ Message sent — ID: ${d.data?.messageId ?? 'ok'}` });
      setTimeout(load, 800);
    } catch (err: unknown) {
      setResult({ ok: false, text: (err as { message?: string }).message ?? 'Failed to send' });
    } finally {
      setSending(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {selected && <DetailPanel msg={selected} myId={myId} onClose={() => setSelected(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
          <p className="text-gray-500 text-sm mt-1">Send, track and inspect partner messages</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${autoRefresh ? 'bg-green-50 border-green-300 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
          >
            {autoRefresh ? '⏱ Auto-refresh on' : 'Auto-refresh'}
          </button>
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
        </div>
      </div>

      {/* Send form */}
      <Card title="Send a Message">
        {sendTargets.length === 0 ? (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>No active subscribers yet. Partners must subscribe to you and be approved before you can send them messages.</span>
          </div>
        ) : (
          <form onSubmit={sendMsg} className="space-y-4">
            {/* Target partner */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Partner</label>
              <select
                value={targetPartnerId}
                onChange={e => setTargetPartnerId(e.target.value)}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-700"
              >
                <option value="">— Select a partner —</option>
                {sendTargets.map(t => (
                  <option key={t.partnerId} value={t.partnerId}>{t.companyName}</option>
                ))}
              </select>
            </div>

            {/* Format selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message Format</label>
              <div className="flex flex-wrap gap-2">
                {FORMATS.map(f => {
                  const mapped = activeSchemas.find(s => s.format === f);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormat(f)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        format === f
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
                      }`}
                    >
                      {FORMAT_LABELS[f]}
                      {mapped && (
                        <span className={`flex items-center gap-0.5 text-xs ${format === f ? 'text-indigo-200' : 'text-green-600'}`}>
                          <Zap className="w-3 h-3" />AI
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {activeMapping ? (
                <p className="mt-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                  ⚡ Active AI mapping (v{activeMapping.version}) will auto-transform this message to CDM format before delivery.
                </p>
              ) : (
                <p className="mt-2 text-xs text-gray-400">
                  No AI mapping for {FORMAT_LABELS[format]}. Message will be delivered as-is.{' '}
                  <a href="/mappings" className="text-indigo-500 hover:underline">Set up a mapping →</a>
                </p>
              )}

              {/* Partner + format delivery hint */}
              {selectedTarget && (
                <div className="mt-2 flex items-center gap-2 text-xs px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-700">
                  <Activity className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                  <span>
                    <span className="font-semibold">{selectedTarget.companyName}</span> will receive your{' '}
                    <span className="font-mono font-semibold">{FORMAT_LABELS[format]}</span> payload
                    {activeMapping
                      ? <> — <span className="text-green-700 font-medium">mapped to CDM (JSON)</span> via active schema v{activeMapping.version}</>
                      : <> — <span className="text-gray-500">delivered as-is</span> (no mapping active for this format)</>
                    }
                  </span>
                </div>
              )}
            </div>

            <Textarea
              label="Payload"
              value={payload}
              onChange={e => setPayload(e.target.value)}
              rows={5}
              className="font-mono text-xs"
              required
            />

            {result && (
              <div className={`text-sm px-3 py-2 rounded-lg border ${result.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {result.text}
              </div>
            )}

            <Button type="submit" loading={sending} disabled={!targetPartnerId}>
              <Send className="w-4 h-4 mr-1.5" />Send Message
            </Button>
          </form>
        )}
      </Card>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['all', 'sent', 'received'] as const).map(d => (
              <button key={d} onClick={() => { setDirection(d); setPage(0); }}
                className={`px-4 py-1.5 font-medium capitalize transition-colors ${direction === d ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {d === 'sent' ? <><ArrowUpRight className="w-3.5 h-3.5 inline mr-1" />Sent</> : d === 'received' ? <><ArrowDownLeft className="w-3.5 h-3.5 inline mr-1" />Received</> : 'All'}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search message content…"
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>}
          </div>

          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0); }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-600">
            <option value="">All statuses</option>
            {STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={filterFormat} onChange={e => { setFilterFormat(e.target.value); setPage(0); }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-600">
            <option value="">All formats</option>
            {FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
          </select>

          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(0); }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(0); }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />

          {(filterStatus || filterFormat || search || from || to) && (
            <button onClick={() => { setFilterStatus(''); setFilterFormat(''); setSearch(''); setFrom(''); setTo(''); setPage(0); }}
              className="text-xs text-red-500 hover:text-red-700 font-medium">Clear filters</button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Messages" value={stats?.total ?? total} colorCls="bg-gray-50 border-gray-200 text-gray-700" icon={<Package className="w-6 h-6 text-gray-400" />} />
        <StatCard label="Delivered" value={derivedStats.delivered} colorCls="bg-green-50 border-green-200 text-green-800" icon={<CheckCircle className="w-6 h-6 text-green-400" />} />
        <StatCard label="Failed" value={derivedStats.failed} colorCls="bg-red-50 border-red-200 text-red-800" icon={<AlertCircle className="w-6 h-6 text-red-400" />} />
        <StatCard label="Processing" value={derivedStats.processing} colorCls="bg-amber-50 border-amber-200 text-amber-800" icon={<Activity className="w-6 h-6 text-amber-400" />} />
      </div>

      {/* Message log */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">
            Message Log <span className="text-gray-400 font-normal text-sm ml-1">({total} total)</span>
          </h2>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">←</button>
              <span className="text-gray-500">Page {page + 1} / {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">→</button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-12">Loading…</div>
        ) : messages.length === 0 ? (
          <Card><div className="text-center py-8 text-gray-400">No messages match your filters.</div></Card>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['', 'Message ID', 'From', 'To', 'Format', 'Status', 'Mapping', 'Retries', 'Timestamp', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {messages.map(m => (
                  <tr key={m.id} onClick={() => setSelected(m)} className="hover:bg-indigo-50 cursor-pointer transition-colors">
                    <td className="px-3 py-3 w-6">
                      {m.sourcePartnerId === myId
                        ? <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" />
                        : <ArrowDownLeft className="w-3.5 h-3.5 text-green-500" />}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{m.id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[120px] truncate" title={m.sourcePartnerId}>
                      {m.sourcePartnerName ?? m.sourcePartnerId.slice(0, 8) + '…'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[120px] truncate" title={m.targetPartnerId}>
                      {m.targetPartnerName ?? m.targetPartnerId.slice(0, 8) + '…'}
                    </td>
                    <td className="px-4 py-3">
                      <FormatBadge format={m.format} schemaFormat={m.schemaFormat} schemaId={m.schemaId} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={m.status === 'delivered' && m.targetPartnerId === myId ? 'received' : m.status}
                        className={statusColor(m.status)}
                      />
                      {m.status === 'failed' && m.errorMessage && (
                        <p className="text-xs text-red-500 mt-0.5 max-w-[160px] truncate" title={m.errorMessage}>
                          {m.errorMessage.slice(0, 60)}{m.errorMessage.length > 60 ? '…' : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <MappingBadge schemaId={m.schemaId} mappedPayload={m.mappedPayload} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">{m.retries}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDateTime(m.createdAt)}</td>
                    <td className="px-4 py-3 text-gray-300"><ChevronRight className="w-4 h-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
