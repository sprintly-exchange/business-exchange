'use client';
import { useEffect, useState } from 'react';
import { partnersApi, subscriptionsApi, integrationsApi, agentsApi } from '@/lib/api';
import { StatCard } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Card';
import { statusColor, fmtDateTime, getPartnerId } from '@/lib/utils';
import { Users, Link2, Send, Bot, CheckCircle, AlertCircle, TrendingUp, Activity, Clock } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell, RadialBarChart, RadialBar,
} from 'recharts';

interface DailyVolume { date: string; sent: number; received: number }
interface Stats { byStatus: Record<string, number>; byFormat: Record<string, number>; dailyVolume: DailyVolume[] }
interface Sub { status: string; subscriberPartnerId: string; providerPartnerId: string }

const STATUS_COLORS: Record<string, string> = {
  delivered: '#22c55e', processing: '#6366f1', received: '#94a3b8',
  failed: '#ef4444', dead_lettered: '#991b1b',
};
const FORMAT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6'];

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: <strong>{p.value}</strong></p>
      ))}
    </div>
  );
};

export default function DashboardPage() {
  const myId = getPartnerId() ?? '';
  const [stats, setStats] = useState({ partners: 0, subscriptions: 0, messages: 0, successRate: 0 });
  const [recentMessages, setRecentMessages] = useState<Record<string, unknown>[]>([]);
  const [agentEvents, setAgentEvents] = useState<Record<string, unknown>[]>([]);
  const [msgStats, setMsgStats] = useState<Stats | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerStatus, setPartnerStatus] = useState<string | null>(null);

  useEffect(() => {
    if (myId) {
      partnersApi.get(myId)
        .then(r => setPartnerStatus((r.data as { data: { status: string } }).data?.status ?? null))
        .catch(() => {});
    }
    Promise.all([
      partnersApi.list(1, 1),
      subscriptionsApi.list(),
      integrationsApi.listMessages({ limit: 5 }),
      agentsApi.listEvents(10),
      integrationsApi.getStats(),
    ]).then(([p, s, m, a, ms]) => {
      const msgData = (m.data as { data?: Record<string, unknown>[]; total?: number });
      const subsData: Sub[] = ((s.data as { data?: Sub[] }).data ?? []);
      const statsData: Stats | null = (ms.data as { data: Stats }).data ?? null;
      const total = Object.values(statsData?.byStatus ?? {}).reduce((a, b) => a + b, 0);
      const delivered = (statsData?.byStatus?.['delivered'] ?? 0) + (statsData?.byStatus?.['received'] ?? 0);
      setStats({
        partners: (p.data as { total?: number }).total ?? 0,
        subscriptions: subsData.filter(s => s.status === 'active').length,
        messages: msgData.total ?? 0,
        successRate: total > 0 ? Math.round((delivered / total) * 100) : 0,
      });
      setRecentMessages(msgData.data ?? []);
      setAgentEvents(((a.data as { data?: Record<string, unknown>[] }).data ?? []).slice(0, 5));
      setMsgStats(statsData);
      setSubs(subsData);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [myId]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading dashboard…</div>;

  const statusPieData = msgStats
    ? Object.entries(msgStats.byStatus).map(([name, value]) => ({ name, value }))
    : [];

  const formatBarData = msgStats
    ? Object.entries(msgStats.byFormat).map(([name, value]) => ({ name: name.toUpperCase(), value }))
    : [];

  const volumeData = (msgStats?.dailyVolume ?? []).map(d => ({ ...d, date: formatDate(d.date) }));

  const totalMessages = Object.values(msgStats?.byStatus ?? {}).reduce((a, b) => a + b, 0);

  const subStatusData = [
    { name: 'Active', value: subs.filter(s => s.status === 'active').length, fill: '#22c55e' },
    { name: 'Requested', value: subs.filter(s => s.status === 'requested').length, fill: '#f59e0b' },
    { name: 'Terminated', value: subs.filter(s => s.status === 'terminated').length, fill: '#94a3b8' },
  ].filter(d => d.value > 0);

  const successRateData = [{ name: 'Rate', value: stats.successRate, fill: stats.successRate > 80 ? '#22c55e' : stats.successRate > 50 ? '#f59e0b' : '#ef4444' }];

  return (
    <div className="space-y-6">
      {partnerStatus === 'pending' && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3">
          <Clock className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-800">Account pending approval</p>
            <p className="text-xs text-yellow-700 mt-0.5">
              You can configure your <a href="/settings" className="underline font-medium">Partner Settings</a> now.
              Sending and receiving messages will be enabled once an admin approves your account.
            </p>
          </div>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Overview of your integration platform</p>
      </div>

      {/* KPI stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Approved Partners" value={stats.partners} icon={<Users className="w-5 h-5" />} color="indigo" />
        <StatCard label="Active Subscriptions" value={stats.subscriptions} icon={<Link2 className="w-5 h-5" />} color="green" />
        <StatCard label="Total Messages" value={stats.messages} icon={<Send className="w-5 h-5" />} color="yellow" />
        <StatCard label="Delivery Success Rate" value={`${stats.successRate}%`} icon={<Activity className="w-5 h-5" />} color="indigo" />
      </div>

      {msgStats ? (
        <>
          {/* Row 1: Area volume chart + Status donut */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-indigo-500" />
                <h3 className="text-sm font-semibold text-gray-900">Message Volume — Last 14 Days</h3>
              </div>
              <p className="text-xs text-gray-400 mb-4">{totalMessages} total messages</p>
              {volumeData.length === 0 ? (
                <div className="flex items-center justify-center h-44 text-gray-400 text-sm">No data yet — send a message to get started</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={volumeData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="recvGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="sent" name="Sent" stroke="#6366f1" strokeWidth={2} fill="url(#sentGrad)" dot={{ r: 3, fill: '#6366f1' }} />
                    <Area type="monotone" dataKey="received" name="Received" stroke="#22c55e" strokeWidth={2} fill="url(#recvGrad)" dot={{ r: 3, fill: '#22c55e' }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Status donut */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Message Status</h3>
              <p className="text-xs text-gray-400 mb-3">{totalMessages} total</p>
              {statusPieData.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No data yet</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2} strokeWidth={0}>
                        {statusPieData.map((entry) => (
                          <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-1.5">
                    {statusPieData.map(entry => (
                      <div key={entry.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[entry.name] ?? '#94a3b8' }} />
                          <span className="text-gray-600 capitalize">{entry.name.replace('_', ' ')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-700">{entry.value}</span>
                          <span className="text-gray-400">{totalMessages > 0 ? Math.round((entry.value / totalMessages) * 100) : 0}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Row 2: Format bar + Subscriptions donut + Success rate gauge */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Format breakdown */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Messages by Format</h3>
              {formatBarData.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={formatBarData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} width={60} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="value" name="Messages" radius={[0, 4, 4, 0]} maxBarSize={18}>
                      {formatBarData.map((_, i) => <Cell key={i} fill={FORMAT_COLORS[i % FORMAT_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Subscription status */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Subscriptions</h3>
              <p className="text-xs text-gray-400 mb-3">{subs.length} total connections</p>
              {subStatusData.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No subscriptions yet</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={110}>
                    <PieChart>
                      <Pie data={subStatusData} cx="50%" cy="50%" outerRadius={50} dataKey="value" paddingAngle={2} strokeWidth={0}>
                        {subStatusData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-1.5">
                    {subStatusData.map(d => (
                      <div key={d.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                          <span className="text-gray-600">{d.name}</span>
                        </div>
                        <span className="font-semibold text-gray-700">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Success rate radial */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col items-center justify-center">
              <h3 className="text-sm font-semibold text-gray-900 mb-1 self-start">Delivery Success Rate</h3>
              <p className="text-xs text-gray-400 mb-3 self-start">Across all messages</p>
              <ResponsiveContainer width="100%" height={130}>
                <RadialBarChart cx="50%" cy="50%" innerRadius={40} outerRadius={65} data={successRateData} startAngle={210} endAngle={-30}>
                  <RadialBar dataKey="value" cornerRadius={6} background={{ fill: '#f3f4f6' }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <p className="text-3xl font-bold mt-[-40px]" style={{ color: successRateData[0]?.fill ?? '#6366f1' }}>{stats.successRate}%</p>
              <p className="text-xs text-gray-400 mt-1">
                {stats.successRate > 80 ? '✅ Excellent' : stats.successRate > 50 ? '⚠️ Needs attention' : '🔴 Low — check failed messages'}
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center h-48 text-gray-400 text-sm">
          No message data yet — send your first message to see analytics
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent messages */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <Send className="w-4 h-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Recent Messages</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {recentMessages.length === 0 && <p className="px-6 py-4 text-sm text-gray-400">No messages yet.</p>}
            {recentMessages.map((m) => (
              <div key={m['id'] as string} className="px-6 py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-mono text-xs text-gray-600">{(m['id'] as string).slice(0, 8)}…</p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {(m['source_partner_name'] as string) ?? '?'} → {(m['target_partner_name'] as string) ?? '?'}
                    &nbsp;·&nbsp;{fmtDateTime(m['created_at'] as string)}
                  </p>
                </div>
                <Badge label={m['status'] as string === 'delivered' && m['target_partner_id'] === myId ? 'received' : m['status'] as string} className={statusColor(m['status'] as string)} />
              </div>
            ))}
          </div>
        </div>

        {/* Agent events */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <Bot className="w-4 h-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Agent Activity</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {agentEvents.length === 0 && <p className="px-6 py-4 text-sm text-gray-400">No agent events yet.</p>}
            {agentEvents.map((e) => (
              <div key={e['id'] as string} className="px-6 py-3 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {e['outcome'] === 'success'
                    ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                  <div>
                    <p className="font-medium text-gray-800 text-xs">{e['agent_type'] as string} — {e['action'] as string}</p>
                    <p className="text-gray-400 text-xs">{fmtDateTime(e['created_at'] as string)}</p>
                  </div>
                </div>
                <Badge label={e['outcome'] as string} className={statusColor(e['outcome'] as string)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
