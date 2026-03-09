'use client';
import { useEffect, useState } from 'react';
import { partnersApi, brandingApi, BrandingConfig } from '@/lib/api';
import { getPartnerId } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Webhook, CheckCircle2, AlertCircle, Info, Plus, X, Palette } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

const ALL_FORMATS = ['json', 'xml', 'csv', 'edi-x12', 'edifact'];

const STANDARD_MESSAGE_TYPES = ['ORDERS', 'INVOICES', 'SHIPMENTS', 'PRODUCTS', 'PAYMENTS', 'INVENTORY', 'ACKNOWLEDGMENTS'];

interface PartnerProfile {
  id: string;
  name: string;
  contactEmail: string;
  domain: string;
  webhookUrl?: string;
  supportedFormats?: string[];
  supportedMessageTypes?: string[];
  status: string;
}

export default function SettingsPage() {
  const myId = getPartnerId() ?? '';
  const { refresh: refreshTheme, platformBranding, branding: themeBranding } = useTheme();
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [messageTypes, setMessageTypes] = useState<string[]>([]);
  const [customTypeInput, setCustomTypeInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Branding — seeded from ThemeProvider (already fetched), no extra call needed
  const [branding, setBranding] = useState<BrandingConfig>({});
  const [brandingSaving, setBrandingSaving] = useState(false);

  // Sync branding from ThemeProvider once it loads
  useEffect(() => { setBranding(themeBranding); }, [themeBranding]);

  useEffect(() => {
    if (!myId) return;
    partnersApi.get(myId)
      .then((r) => {
        const p = (r.data as { data: PartnerProfile }).data;
        setProfile(p);
        setWebhookUrl(p.webhookUrl ?? '');
        setMessageTypes(p.supportedMessageTypes ?? []);
      })
      .catch(() => setResult({ ok: false, text: 'Failed to load profile' }))
      .finally(() => setLoading(false));
  }, [myId]);

  const toggleMessageType = (t: string) =>
    setMessageTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const addCustomType = () => {
    const val = customTypeInput.trim().toUpperCase();
    if (val && !messageTypes.includes(val)) {
      setMessageTypes(prev => [...prev, val]);
    }
    setCustomTypeInput('');
  };

  const removeMessageType = (t: string) =>
    setMessageTypes(prev => prev.filter(x => x !== t));

  const saveBranding = async () => {
    setBrandingSaving(true);
    try {
      await brandingApi.updatePartner(myId, branding);
      await refreshTheme();
      setResult({ ok: true, text: 'Branding saved' });
    } catch {
      setResult({ ok: false, text: 'Failed to save branding' });
    } finally {
      setBrandingSaving(false);
    }
  };

  const resetBranding = async () => {
    setBranding({});
    await brandingApi.updatePartner(myId, {});
    await refreshTheme();
  };

  const save = async () => {
    setResult(null);
    if (webhookUrl && !webhookUrl.startsWith('http')) {
      setResult({ ok: false, text: 'Webhook URL must start with http:// or https://' });
      return;
    }
    setSaving(true);
    try {
      await partnersApi.updateProfile(myId, {
        webhook_url: webhookUrl || undefined,
        supported_formats: [...ALL_FORMATS],
        supported_message_types: messageTypes,
      });
      setResult({ ok: true, text: 'Settings saved successfully' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setResult({ ok: false, text: msg });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  const customTypes = messageTypes.filter(t => !STANDARD_MESSAGE_TYPES.includes(t));

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Partner Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure how you receive messages from partners</p>
      </div>

      {/* Profile info (read-only) */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Partner Profile</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-gray-400 mb-0.5">Company Name</p><p className="font-medium text-gray-800">{profile?.name}</p></div>
          <div><p className="text-xs text-gray-400 mb-0.5">Status</p><p className="font-medium text-gray-800 capitalize">{profile?.status}</p></div>
          <div><p className="text-xs text-gray-400 mb-0.5">Contact Email</p><p className="font-medium text-gray-800">{profile?.contactEmail}</p></div>
          <div><p className="text-xs text-gray-400 mb-0.5">Domain</p><p className="font-medium text-gray-800">{profile?.domain}</p></div>
          <div className="col-span-2"><p className="text-xs text-gray-400 mb-0.5">Partner ID</p><p className="font-mono text-xs text-gray-500">{profile?.id}</p></div>
        </div>
      </Card>

      {/* Webhook URL */}
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <Webhook className="w-5 h-5 text-indigo-500 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Webhook URL</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              When partners send you a message, we POST it to this URL. Leave blank if you only send messages.
            </p>
          </div>
        </div>

        <input
          type="url"
          value={webhookUrl}
          onChange={e => setWebhookUrl(e.target.value)}
          placeholder="https://your-system.example.com/webhooks/bx"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono"
        />

        <div className="mt-3 flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
          <span>
            We&apos;ll send a <code className="bg-gray-200 px-1 rounded">POST</code> request with the message payload and headers:
            {' '}<code className="bg-gray-200 px-1 rounded">X-BX-Message-Id</code>,{' '}
            <code className="bg-gray-200 px-1 rounded">X-BX-Source-Partner</code>,{' '}
            <code className="bg-gray-200 px-1 rounded">X-BX-Signature</code>.
            Respond with <code className="bg-gray-200 px-1 rounded">2xx</code> to acknowledge.
          </span>
        </div>
      </Card>

      {/* Supported message types */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Supported Message Types</h2>
        <p className="text-xs text-gray-500 mb-4">
          Which business document types can your system handle? Partners will see these when setting up integrations with you.
        </p>

        {/* Standard types */}
        <div className="flex flex-wrap gap-2 mb-4">
          {STANDARD_MESSAGE_TYPES.map(t => (
            <button
              key={t}
              onClick={() => toggleMessageType(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                messageTypes.includes(t)
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-emerald-400'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Custom types */}
        {customTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {customTypes.map(t => (
              <span key={t} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-violet-100 text-violet-700 border border-violet-300">
                {t}
                <button onClick={() => removeMessageType(t)} className="hover:text-violet-900 ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Add custom type */}
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={customTypeInput}
            onChange={e => setCustomTypeInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomType()}
            placeholder="Add custom type (e.g. PURCHASE_ORDERS)"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none uppercase placeholder:normal-case placeholder:text-gray-400"
          />
          <button
            onClick={addCustomType}
            disabled={!customTypeInput.trim()}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {messageTypes.length === 0 && (
          <p className="text-xs text-gray-400 mt-2">No message types selected — partners won&apos;t see any supported types.</p>
        )}
      </Card>

      {/* Branding */}
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <Palette className="w-5 h-5 text-indigo-500 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Portal Branding</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Customize your portal accent colors. Leave blank to use platform defaults.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Primary Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={branding.primaryColor || platformBranding.primaryColor || '#6366f1'}
                onChange={e => setBranding(b => ({ ...b, primaryColor: e.target.value }))}
                className="h-10 w-14 rounded-lg border border-gray-300 cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={branding.primaryColor || ''}
                onChange={e => setBranding(b => ({ ...b, primaryColor: e.target.value }))}
                placeholder={platformBranding.primaryColor || '#6366f1'}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Accent Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={branding.accentColor || platformBranding.accentColor || '#4f46e5'}
                onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))}
                className="h-10 w-14 rounded-lg border border-gray-300 cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={branding.accentColor || ''}
                onChange={e => setBranding(b => ({ ...b, accentColor: e.target.value }))}
                placeholder={platformBranding.accentColor || '#4f46e5'}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-gray-600 mb-2">Logo URL (optional)</label>
          <input
            type="url"
            value={branding.logoUrl || ''}
            onChange={e => setBranding(b => ({ ...b, logoUrl: e.target.value }))}
            placeholder="https://your-company.com/logo.png"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
          />
        </div>

        {/* Preview swatch */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-lg shadow-sm border border-gray-200" style={{ backgroundColor: branding.primaryColor || platformBranding.primaryColor || '#6366f1' }} title="Primary" />
            <div className="w-8 h-8 rounded-lg shadow-sm border border-gray-200" style={{ backgroundColor: branding.accentColor || platformBranding.accentColor || '#4f46e5' }} title="Accent" />
          </div>
          <span className="text-xs text-gray-400">Preview</span>
          <button onClick={resetBranding} className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline">
            Reset to platform defaults
          </button>
        </div>

        <div className="flex justify-end mt-4">
          <Button onClick={saveBranding} loading={brandingSaving}>Save Branding</Button>
        </div>
      </Card>

      {/* Save */}
      {result && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {result.text}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}

