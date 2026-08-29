'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Copy,
  Check,
  Upload,
  UserMinus,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  AlertTriangle,
  Key,
  Plug,
  Link,
  Link2Off,
  RefreshCw,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn, relativeTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { spring } from '@/design-system/motion'

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = 'owner' | 'admin' | 'member'

interface OrgMember {
  id: string
  name: string
  email: string
  role: Role
  avatar?: string
}

interface PendingInvite {
  id: string
  email: string
  role: Role
  sent_at: string
}

interface Integration {
  id: string
  name: string
  status: 'connected' | 'disconnected'
  connected_at?: string
}

interface ApiKey {
  id: string
  name: string
  created_at: string
  last_used?: string
  masked: string
}

interface OrgData {
  id: string
  name: string
  slug: string
  website?: string
  logo_url?: string
  members: OrgMember[]
  pending_invites: PendingInvite[]
  integrations: Integration[]
  api_keys: ApiKey[]
}

// ─── Integration metadata ────────────────────────────────────────────────────
const INTEGRATION_META: Record<string, { color: string; abbr: string }> = {
  'Google Search Console': { color: '#4285F4', abbr: 'GSC' },
  'Google Analytics':      { color: '#E37400', abbr: 'GA4' },
  'Semrush':               { color: '#FF6900', abbr: 'SEM' },
  'Ahrefs':                { color: '#1D6ADE', abbr: 'AHR' },
  'HubSpot':               { color: '#FF7A59', abbr: 'HUB' },
  'Salesforce':            { color: '#00A1E0', abbr: 'SF'  },
}

// ─── Copy button ─────────────────────────────────────────────────────────────
function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      }}
      className="inline-flex items-center gap-1.5 text-xs text-dim hover:text-ember transition-colors font-sans"
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span key="c" initial={{ scale: 0.7 }} animate={{ scale: 1 }} exit={{ scale: 0.7 }} className="flex items-center gap-1 text-success">
            <Check className="h-3.5 w-3.5" /> Copied
          </motion.span>
        ) : (
          <motion.span key="n" initial={{ scale: 0.7 }} animate={{ scale: 1 }} exit={{ scale: 0.7 }} className="flex items-center gap-1">
            <Copy className="h-3.5 w-3.5" /> {label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

// ─── Role badge ──────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: Role }) {
  const map: Record<Role, 'ember' | 'info' | 'outline'> = { owner: 'ember', admin: 'info', member: 'outline' }
  return <Badge variant={map[role]} size="sm" className="capitalize">{role}</Badge>
}

// ─── General Tab ─────────────────────────────────────────────────────────────
function GeneralTab({ org, slug }: { org: OrgData; slug: string }) {
  const [name, setName] = React.useState(org.name)
  const [website, setWebsite] = React.useState(org.website ?? '')
  const [dragging, setDragging] = React.useState(false)
  const { toast } = useToast()
  const qc = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: () => api.patch(routes.org(slug), { name, website }),
    onSuccess: () => {
      toast({ title: 'Settings saved', variant: 'success' })
      qc.invalidateQueries({ queryKey: ['org', slug] })
    },
    onError: () => toast({ title: 'Failed to save', variant: 'error' }),
  })

  return (
    <div className="max-w-lg space-y-6">
      <Input
        label="Organization name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-ink font-sans">Slug</label>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={org.slug}
            className="h-10 flex-1 rounded-md border border-border bg-surface px-3 text-sm font-mono text-dim cursor-default"
          />
          <CopyButton value={org.slug} />
        </div>
        <p className="text-xs text-dim font-sans">Used in URLs — cannot be changed.</p>
      </div>
      <Input
        label="Website URL"
        type="url"
        placeholder="https://example.com"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />

      {/* Logo upload */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-ink font-sans">Logo</label>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false) }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 h-28 rounded-lg border-2 border-dashed transition-colors duration-150 cursor-pointer',
            dragging ? 'border-ember bg-ember/5' : 'border-border hover:border-border-strong hover:bg-surface'
          )}
        >
          <Upload className={cn('h-5 w-5 transition-colors', dragging ? 'text-ember' : 'text-dim')} />
          <p className="text-sm text-dim font-sans">Drag &amp; drop or <span className="text-ember underline">browse</span></p>
          <p className="text-xs text-dim/70">PNG, JPG — max 2 MB</p>
        </div>
      </div>

      <Button
        onClick={() => saveMutation.mutate()}
        loading={saveMutation.isPending}
        size="md"
      >
        Save changes
      </Button>
    </div>
  )
}

// ─── Team Tab ────────────────────────────────────────────────────────────────
function TeamTab({ org, slug }: { org: OrgData; slug: string }) {
  const [inviteEmail, setInviteEmail] = React.useState('')
  const [inviteRole, setInviteRole] = React.useState<Role>('member')
  const { toast } = useToast()
  const qc = useQueryClient()

  const inviteMutation = useMutation({
    mutationFn: () => api.post(`/api/orgs/${slug}/invites`, { email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      toast({ title: 'Invite sent', variant: 'success' })
      setInviteEmail('')
      qc.invalidateQueries({ queryKey: ['org', slug] })
    },
    onError: () => toast({ title: 'Failed to send invite', variant: 'error' }),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/orgs/${slug}/invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', slug] }),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/orgs/${slug}/members/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', slug] }),
  })

  return (
    <div className="space-y-8">
      {/* Members list */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {org.members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-6 py-3">
                <Avatar name={m.name} src={m.avatar} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink font-sans truncate">{m.name}</p>
                  <p className="text-xs text-dim truncate">{m.email}</p>
                </div>
                <RoleBadge role={m.role} />
                {m.role !== 'owner' && (
                  <button
                    onClick={() => removeMutation.mutate(m.id)}
                    className="p-1.5 rounded text-dim hover:text-danger hover:bg-danger-muted transition-colors"
                    aria-label="Remove member"
                  >
                    <UserMinus className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Invite form */}
      <Card>
        <CardHeader>
          <CardTitle>Invite Member</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1"
            />
            <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => inviteMutation.mutate()}
              loading={inviteMutation.isPending}
              disabled={!inviteEmail}
            >
              Send Invite
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pending invites */}
      {org.pending_invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Invites</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {org.pending_invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-6 py-3 opacity-70">
                  <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-dim shrink-0">
                    <span className="text-xs font-mono">{inv.email[0].toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink truncate">{inv.email}</p>
                    <p className="text-xs text-dim">Sent {relativeTime(inv.sent_at)}</p>
                  </div>
                  <RoleBadge role={inv.role} />
                  <button
                    onClick={() => revokeMutation.mutate(inv.id)}
                    className="p-1.5 rounded text-dim hover:text-danger hover:bg-danger-muted transition-colors"
                    aria-label="Revoke invite"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const X = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

// ─── Integrations Tab ─────────────────────────────────────────────────────────
function IntegrationsTab({ org, slug }: { org: OrgData; slug: string }) {
  const [connectTarget, setConnectTarget] = React.useState<Integration | null>(null)
  const [apiKey, setApiKey] = React.useState('')
  const { toast } = useToast()
  const qc = useQueryClient()

  const connectMutation = useMutation({
    mutationFn: (id: string) => api.post(`${routes.integrations(slug)}/${id}/connect`, { api_key: apiKey }),
    onSuccess: () => {
      toast({ title: 'Integration connected', variant: 'success' })
      setConnectTarget(null)
      setApiKey('')
      qc.invalidateQueries({ queryKey: ['org', slug] })
    },
    onError: () => toast({ title: 'Connection failed', variant: 'error' }),
  })

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => api.delete(`${routes.integrations(slug)}/${id}/connect`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', slug] }),
  })

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {org.integrations.map((integ) => {
          const meta = INTEGRATION_META[integ.name] ?? { color: '#6B6760', abbr: integ.name.slice(0, 3).toUpperCase() }
          const connected = integ.status === 'connected'
          return (
            <motion.div
              key={integ.id}
              layout
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring}
              className="flex flex-col gap-4 p-4 rounded-xl border border-border bg-paper hover:border-border-strong transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-mono font-bold shrink-0"
                  style={{ background: meta.color }}
                >
                  {meta.abbr}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink font-sans">{integ.name}</p>
                  <p className={cn('text-xs font-sans', connected ? 'text-success' : 'text-dim')}>
                    {connected ? `Connected${integ.connected_at ? ` · ${relativeTime(integ.connected_at)}` : ''}` : 'Not connected'}
                  </p>
                </div>
              </div>
              <Button
                variant={connected ? 'ghost' : 'outline'}
                size="sm"
                className={connected ? 'text-danger hover:bg-danger-muted hover:text-danger' : ''}
                onClick={() => connected ? disconnectMutation.mutate(integ.id) : setConnectTarget(integ)}
              >
                {connected ? (
                  <><Link2Off className="h-3.5 w-3.5" /> Disconnect</>
                ) : (
                  <><Link className="h-3.5 w-3.5" /> Connect</>
                )}
              </Button>
            </motion.div>
          )
        })}
      </div>

      {/* Connect modal */}
      <Modal open={!!connectTarget} onOpenChange={(open) => { if (!open) { setConnectTarget(null); setApiKey('') } }}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Connect {connectTarget?.name}</ModalTitle>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <p className="text-sm text-dim font-sans">
              Enter your API key or OAuth credentials to connect {connectTarget?.name}.
            </p>
            <Input
              label="API Key"
              type="password"
              placeholder="Paste your API key here"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setConnectTarget(null)}>Cancel</Button>
            <Button
              onClick={() => connectTarget && connectMutation.mutate(connectTarget.id)}
              loading={connectMutation.isPending}
              disabled={!apiKey}
            >
              <Plug className="h-4 w-4" /> Connect
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

// ─── API Keys Tab ─────────────────────────────────────────────────────────────
function ApiKeysTab({ org, slug }: { org: OrgData; slug: string }) {
  const [genOpen, setGenOpen] = React.useState(false)
  const [keyName, setKeyName] = React.useState('')
  const [newKey, setNewKey] = React.useState<string | null>(null)
  const [revealed, setRevealed] = React.useState(false)
  const { toast } = useToast()
  const qc = useQueryClient()

  const generateMutation = useMutation({
    mutationFn: () => api.post<{ key: string }>(`/api/orgs/${slug}/api-keys`, { name: keyName }),
    onSuccess: (data) => {
      const d = data as { key: string }
      setNewKey(d.key)
      setKeyName('')
      qc.invalidateQueries({ queryKey: ['org', slug] })
    },
    onError: () => toast({ title: 'Failed to generate key', variant: 'error' }),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/orgs/${slug}/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', slug] }),
  })

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-dim font-sans">Manage programmatic access to your organization.</p>
        <Button size="sm" onClick={() => setGenOpen(true)}>
          <Plus className="h-4 w-4" /> Generate Key
        </Button>
      </div>

      {org.api_keys.length === 0 ? (
        <EmptyState
          icon={<Key className="h-6 w-6" />}
          title="No API keys"
          description="Generate a key to access the BeBest API programmatically."
          action={<Button size="sm" onClick={() => setGenOpen(true)}>Generate Key</Button>}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {org.api_keys.map((k) => (
                <div key={k.id} className="flex items-center gap-3 px-6 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink font-sans">{k.name}</p>
                    <p className="text-xs font-mono text-dim mt-0.5">{k.masked}</p>
                    <p className="text-xs text-dim/70 mt-0.5">
                      Created {relativeTime(k.created_at)}
                      {k.last_used && ` · Last used ${relativeTime(k.last_used)}`}
                    </p>
                  </div>
                  <CopyButton value={k.masked} />
                  <button
                    onClick={() => revokeMutation.mutate(k.id)}
                    className="p-1.5 rounded text-dim hover:text-danger hover:bg-danger-muted transition-colors"
                    aria-label="Revoke key"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generate modal */}
      <Modal open={genOpen || !!newKey} onOpenChange={(open) => { if (!open) { setGenOpen(false); setNewKey(null); setRevealed(false) } }}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{newKey ? 'Your new API key' : 'Generate API Key'}</ModalTitle>
          </ModalHeader>
          <ModalBody className="space-y-4">
            {newKey ? (
              <>
                <div className="flex items-center gap-1.5 p-3 rounded-lg bg-warning-muted border border-warning/30">
                  <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                  <p className="text-xs text-ink font-sans">Copy this key now — it won&apos;t be shown again.</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-10 rounded-md border border-border bg-surface px-3 flex items-center font-mono text-sm text-ink overflow-hidden">
                    {revealed ? newKey : '•'.repeat(Math.min(newKey.length, 36))}
                  </div>
                  <button
                    onClick={() => setRevealed((v) => !v)}
                    className="p-2 rounded text-dim hover:text-ink transition-colors"
                  >
                    {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <CopyButton value={newKey} label="Copy key" />
                </div>
              </>
            ) : (
              <Input
                label="Key name"
                placeholder="e.g. Production CI"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
            )}
          </ModalBody>
          <ModalFooter>
            {newKey ? (
              <Button onClick={() => { setGenOpen(false); setNewKey(null); setRevealed(false) }}>Done</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setGenOpen(false)}>Cancel</Button>
                <Button onClick={() => generateMutation.mutate()} loading={generateMutation.isPending} disabled={!keyName}>
                  <Key className="h-4 w-4" /> Generate
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

// ─── Danger Zone Tab ──────────────────────────────────────────────────────────
function DangerZoneTab({ org, slug }: { org: OrgData; slug: string }) {
  const [confirmText, setConfirmText] = React.useState('')
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const { toast } = useToast()

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(routes.org(slug)),
    onSuccess: () => {
      toast({ title: 'Organization deleted', variant: 'success' })
      window.location.href = '/'
    },
    onError: () => toast({ title: 'Delete failed', variant: 'error' }),
  })

  const exportMutation = useMutation({
    mutationFn: () => api.post(`/api/orgs/${slug}/export`),
    onSuccess: () => toast({ title: 'Export started — you\'ll receive an email shortly', variant: 'info' }),
  })

  return (
    <div className="space-y-6">
      {/* Export */}
      <Card>
        <CardHeader>
          <CardTitle>Export Data</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-dim font-sans mb-4">Download a complete export of all your organization data including brands, runs, keywords, and reports.</p>
          <Button variant="outline" onClick={() => exportMutation.mutate()} loading={exportMutation.isPending}>
            Export All Data
          </Button>
        </CardContent>
      </Card>

      {/* Delete */}
      <div className="rounded-xl border border-danger/30 bg-danger-muted/40 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
          <div>
            <h3 className="font-display font-semibold text-ink">Delete Organization</h3>
            <p className="text-sm text-dim mt-1 font-sans">
              This permanently deletes your organization, all brands, runs, reports, and associated data. This action cannot be undone.
            </p>
          </div>
        </div>
        <Button
          variant="danger"
          size="md"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" /> Delete Organization
        </Button>
      </div>

      {/* Confirm delete modal */}
      <Modal open={deleteOpen} onOpenChange={(open) => { if (!open) { setDeleteOpen(false); setConfirmText('') } }}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete Organization</ModalTitle>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-danger-muted border border-danger/30">
              <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
              <p className="text-sm text-ink font-sans">This action is irreversible. All data will be permanently deleted.</p>
            </div>
            <Input
              label={`Type "${org.slug}" to confirm`}
              placeholder={org.slug}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => deleteMutation.mutate()}
              loading={deleteMutation.isPending}
              disabled={confirmText !== org.slug}
            >
              Delete forever
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { slug } = useParams<{ slug: string }>()
  const [tab, setTab] = React.useState('general')

  const { data, isLoading } = useQuery({
    queryKey: ['org', slug],
    queryFn: () => api.get<OrgData>(routes.org(slug)),
  })

  const org = data as OrgData | undefined

  // Placeholder org while loading
  const safeOrg: OrgData = org ?? {
    id: '',
    name: '',
    slug: slug,
    members: [],
    pending_invites: [],
    integrations: Object.keys(INTEGRATION_META).map((name, i) => ({
      id: String(i),
      name,
      status: 'disconnected' as const,
    })),
    api_keys: [],
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="mb-8"
      >
        <h1 className="font-display text-2xl font-semibold text-ink">Settings</h1>
        <p className="text-sm text-dim mt-1 font-sans">Manage your organization preferences, team, and integrations.</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.06 }}
      >
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
            <TabsTrigger value="danger" className="text-danger data-[state=active]:text-danger">
              Danger Zone
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4 max-w-lg">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-md bg-surface border border-border animate-pulse" />
                  ))}
                </motion.div>
              ) : org ? (
                <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <GeneralTab org={org} slug={slug} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </TabsContent>

          <TabsContent value="team">
            <TeamTab org={safeOrg} slug={slug} />
          </TabsContent>

          <TabsContent value="integrations">
            <IntegrationsTab org={safeOrg} slug={slug} />
          </TabsContent>

          <TabsContent value="api-keys">
            <ApiKeysTab org={safeOrg} slug={slug} />
          </TabsContent>

          <TabsContent value="danger">
            <DangerZoneTab org={safeOrg} slug={slug} />
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  )
}
