import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  QrCode,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { BrokeifyLogo } from './BrokeifyLogo';

export interface AuthenticatedSessionUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'listener';
}

export interface GuestUserSummary {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'listener';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SecurityConfigPayload {
  ok: boolean;
  requireLogin: boolean;
  autoLockPublicDomain: boolean;
  adminUsername: string;
  isDefaultPassword: boolean;
  publicDomainDetected: boolean;
  guestUsers: GuestUserSummary[];
  securityStats: {
    blockedBotsCount: number;
    blockedBruteForceCount: number;
    lastBlockedBotUa: string | null;
    lastBlockedAt: string | null;
  };
  blockedIps: Array<{
    ip: string;
    failures: number;
    unblockInSec: number;
  }>;
}

interface LoginGateScreenProps {
  detectedHost?: string;
  isDefaultPassword?: boolean;
  onLoginSuccess: (data: {
    token: string;
    user: AuthenticatedSessionUser;
  }) => void;
}

export const BrokeifyLoginGateScreen: React.FC<LoginGateScreenProps> = ({
  detectedHost,
  isDefaultPassword,
  onLoginSuccess,
}) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hostLabel =
    detectedHost ||
    (typeof window !== 'undefined' ? window.location.host : 'Private Server');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim() || 'admin',
          password,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        setErrorMsg(
          data.error || 'Invalid username or password. Access denied.'
        );
        return;
      }
      onLoginSuccess({
        token: data.token,
        user: data.user,
      });
    } catch {
      setErrorMsg('Network error reaching Brokeify authentication server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="brokeify-login-gate-screen"
      className="min-h-screen w-full bg-[#09090b] text-zinc-100 flex flex-col items-center justify-center p-4 relative overflow-hidden"
    >
      {/* Subtle cyberpunk background grid */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,102,0.12),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.12),transparent_50%)]" />

      <div className="relative z-10 w-full max-w-md winamp-bezel rounded-3xl border-2 border-[#00ff66]/60 bg-zinc-950/95 p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <BrokeifyLogo size={44} />
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#00ff66]/40 bg-[#00ff66]/10 px-3 py-1 text-[11px] font-mono font-bold uppercase text-[#00ff66]">
              <Lock className="w-3.5 h-3.5" />
              <span>Private Self-Hosted Music Vault</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white font-mono pt-1">
              Sign In to Brokeify
            </h1>
            <p className="text-xs font-mono text-zinc-400">
              Host: <strong className="text-zinc-200">{hostLabel}</strong>
            </p>
          </div>
        </div>

        {isDefaultPassword && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs font-mono text-amber-200 space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>First-Time Setup Default Credentials Active</span>
            </div>
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              Default username is <code>admin</code> and password is{' '}
              <code>brokeify</code>. Change your password in{' '}
              <strong>Settings → Server &amp; Security</strong> right after
              signing in!
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="brokeify-login-username"
              className="block text-xs font-mono font-bold uppercase text-zinc-300"
            >
              Username (Admin or Friends &amp; Family)
            </label>
            <input
              id="brokeify-login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              data-testid="login-gate-username-input"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm font-mono text-white focus:border-[#00ff66] focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="brokeify-login-password"
              className="block text-xs font-mono font-bold uppercase text-zinc-300"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="brokeify-login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                data-testid="login-gate-password-input"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 pl-3.5 pr-10 py-2.5 text-sm font-mono text-white focus:border-[#00ff66] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div
              data-testid="login-gate-error"
              className="rounded-xl border border-rose-500/50 bg-rose-950/40 px-3.5 py-2.5 text-xs font-mono text-rose-200 flex items-center gap-2"
            >
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            data-testid="login-gate-submit-btn"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 py-3 px-4 text-sm font-mono font-bold text-zinc-950 transition-colors shadow-lg"
          >
            <KeyRound className="w-4 h-4" />
            <span>{submitting ? 'Verifying Credentials...' : 'Unlock Music Vault'}</span>
          </button>
        </form>

        <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-400">
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Anti-Bot &amp; Brute-Force Shield Active</span>
          </span>
          <span>No Public Indexing</span>
        </div>
      </div>
    </div>
  );
};

interface SecurityAndUsersManagerProps {
  currentUser: AuthenticatedSessionUser | null;
  requireLogin: boolean;
  onAuthConfigChanged: (nextRequireLogin: boolean) => void;
  onLockAndSignOut: () => void;
  onShowToast: (msg: string) => void;
}

export const SecurityAndUsersManagerSection: React.FC<
  SecurityAndUsersManagerProps
> = ({
  currentUser,
  requireLogin,
  onAuthConfigChanged,
  onLockAndSignOut,
  onShowToast,
}) => {
  const [secConfig, setSecConfig] = useState<SecurityConfigPayload | null>(null);
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [savingAdmin, setSavingAdmin] = useState(false);

  // Friends & Family New Account State
  const [guestDisplayName, setGuestDisplayName] = useState('');
  const [guestUsername, setGuestUsername] = useState('');
  const [guestPassword, setGuestPassword] = useState('');
  const [guestRole, setGuestRole] = useState<'listener' | 'admin'>('listener');
  const [addingGuest, setAddingGuest] = useState(false);

  const fetchSecurityConfig = async () => {
    try {
      const resp = await fetch('/api/auth/security-config');
      if (resp.ok) {
        const data = (await resp.json()) as SecurityConfigPayload;
        setSecConfig(data);
        setAdminUsername(data.adminUsername || 'admin');
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchSecurityConfig();
  }, []);

  const isListenerRole = currentUser?.role === 'listener';

  const handleToggleRequireLogin = async (nextVal: boolean) => {
    if (isListenerRole) return;
    setSavingAdmin(true);
    try {
      const resp = await fetch('/api/auth/security-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-settings',
          requireLogin: nextVal,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        onAuthConfigChanged(Boolean(data.requireLogin));
        onShowToast(
          nextVal
            ? '🔒 Front-End Login Gate ENABLED! Public visitors must now log in.'
            : '🔓 Front-End Login Gate disabled.'
        );
        await fetchSecurityConfig();
      }
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleSaveAdminCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isListenerRole) return;
    setSavingAdmin(true);
    try {
      const resp = await fetch('/api/auth/security-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-settings',
          adminUsername: adminUsername.trim() || 'admin',
          ...(adminPassword.trim()
            ? { adminPassword: adminPassword.trim() }
            : {}),
          requireLogin: true,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        setAdminPassword('');
        onAuthConfigChanged(true);
        onShowToast(
          '✅ Saved Admin credentials & enabled Front-End Security Gate!'
        );
        await fetchSecurityConfig();
      } else {
        onShowToast(`⚠️ ${data.error || 'Failed to update credentials'}`);
      }
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleAddGuestUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestUsername.trim() || !guestPassword.trim()) {
      onShowToast('⚠️ Enter a username and password for the account.');
      return;
    }
    setAddingGuest(true);
    try {
      const resp = await fetch('/api/auth/security-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add-guest',
          displayName: guestDisplayName.trim() || guestUsername.trim(),
          username: guestUsername.trim(),
          password: guestPassword.trim(),
          role: guestRole,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        setGuestDisplayName('');
        setGuestUsername('');
        setGuestPassword('');
        onShowToast(data.message || 'Added Friends & Family account!');
        await fetchSecurityConfig();
      } else {
        onShowToast(`⚠️ ${data.error || 'Could not add account'}`);
      }
    } finally {
      setAddingGuest(false);
    }
  };

  const handleRemoveGuestUser = async (id: string) => {
    try {
      const resp = await fetch('/api/auth/security-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove-guest',
          id,
        }),
      });
      if (resp.ok) {
        onShowToast('🗑️ Removed Friends & Family account.');
        await fetchSecurityConfig();
      }
    } catch {
      // ignore
    }
  };

  const handleUnblockIp = async (ip: string) => {
    try {
      await fetch('/api/auth/security-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unblock-ip',
          ip,
        }),
      });
      await fetchSecurityConfig();
    } catch {
      // ignore
    }
  };

  const [apiKeys, setApiKeys] = useState<
    Array<{
      id: string;
      name: string;
      prefix: string;
      role: string;
      createdAt: string;
      lastUsedAt: string | null;
    }>
  >([]);
  const [newKeyName, setNewKeyName] = useState('Android Auto Companion');
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(
    null
  );
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [isCopyingSpec, setIsCopyingSpec] = useState(false);
  const [copiedSpecDone, setCopiedSpecDone] = useState(false);
  // Unchecked by default so exported spec uses https://your-brokeify-server.com and never leaks a private domain
  const [includeCurrentServerUrl, setIncludeCurrentServerUrl] = useState(false);

  const loadApiKeys = useCallback(async () => {
    try {
      const resp = await fetch('/api/auth/api-keys');
      if (!resp.ok) return;
      const data = await resp.json();
      if (data?.ok && Array.isArray(data.apiKeys)) {
        setApiKeys(data.apiKeys);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  const handleCreatePersonalApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setIsCreatingKey(true);
    setNewlyCreatedToken(null);
    try {
      const resp = await fetch('/api/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok && data.apiKey) {
        setNewlyCreatedToken(data.apiKey.token);
        setNewKeyName('');
        await loadApiKeys();
        onShowToast(`🔑 Created Personal API Key "${data.apiKey.name}"!`);
      } else {
        onShowToast(`⚠️ ${data.error || 'Failed to create API key.'}`);
      }
    } catch {
      onShowToast('⚠️ Network error creating API key.');
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleRevokeApiKey = async (keyId: string) => {
    try {
      const resp = await fetch(
        `/api/auth/api-keys/${encodeURIComponent(keyId)}`,
        {
          method: 'DELETE',
        }
      );
      const data = await resp.json();
      if (resp.ok && data.ok) {
        if (Array.isArray(data.apiKeys)) {
          setApiKeys(data.apiKeys);
        } else {
          await loadApiKeys();
        }
        onShowToast('🗑️ Revoked Personal API Key.');
      }
    } catch {
      onShowToast('⚠️ Failed to revoke API key.');
    }
  };

  const handleCopyApiHandshakeSpec = async () => {
    setIsCopyingSpec(true);
    try {
      const query = includeCurrentServerUrl
        ? '/api/system/spec?format=json&includeCurrentUrl=1'
        : '/api/system/spec?format=json';
      const resp = await fetch(query);
      const data = await resp.json();
      const md = String(data?.markdown || '');
      if (md) {
        await navigator.clipboard.writeText(md);
        setCopiedSpecDone(true);
        setTimeout(() => setCopiedSpecDone(false), 3000);
        onShowToast(
          '📋 Copied brokeify-api-handshake.md to clipboard! Paste into your Android project.'
        );
      }
    } catch {
      onShowToast('⚠️ Could not copy API Handshake spec.');
    } finally {
      setIsCopyingSpec(false);
    }
  };

  return (
    <section
      aria-labelledby="security-gate-heading"
      data-testid="security-and-users-section"
      className="rounded-2xl border-2 border-purple-500/50 bg-zinc-900/60 p-5 sm:p-6 space-y-6 shadow-xl"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Shield className="w-5 h-5 text-[#00ff66] shrink-0" />
            <h2
              id="security-gate-heading"
              className="text-lg sm:text-xl font-bold text-white tracking-tight font-mono"
            >
              Public Domain Security Gate, Friends &amp; Family Accounts &amp; Anti-Bot Shield
            </h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase ${
                requireLogin
                  ? 'bg-[#00ff66]/20 border border-[#00ff66]/50 text-[#00ff66]'
                  : 'bg-amber-500/20 border border-amber-500/50 text-amber-300'
              }`}
            >
              {requireLogin ? '🔒 Login Gate Active' : '🔓 Unlocked (Local Mode)'}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-zinc-300 max-w-3xl">
            Protect your public domain (e.g.{' '}
            <code className="text-[#00ff66]">https://your-brokeify-server.com</code>)
            from strangers, hackers, and web scrapers. Enable the Login Gate so
            only you and your Friends &amp; Family accounts can access your
            library.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleToggleRequireLogin(!requireLogin)}
            disabled={savingAdmin || isListenerRole}
            data-testid="toggle-require-login-btn"
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-mono font-bold transition-colors min-h-[40px] ${
              requireLogin
                ? 'border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200'
                : 'bg-[#00ff66] hover:bg-emerald-400 text-zinc-950 shadow-lg'
            }`}
          >
            {requireLogin ? (
              <>
                <Unlock className="w-4 h-4" />
                <span>Disable Login Gate</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>Enable Login Gate Now</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onLockAndSignOut}
            data-testid="lock-server-now-btn"
            className="inline-flex items-center gap-2 rounded-xl border border-rose-500/50 bg-rose-500/15 hover:bg-rose-500/25 px-3.5 py-2.5 text-xs font-mono font-bold text-rose-200 transition-colors min-h-[40px]"
            title="Lock the front end and open the Login Screen immediately"
          >
            <LogOut className="w-4 h-4" />
            <span>Lock &amp; Test Login Screen</span>
          </button>
        </div>
      </div>

      {/* Grid: 1. Admin Credentials + 2. Friends & Family Listener Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Admin Account & Password Setup */}
        <div className="lg:col-span-5 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-mono font-bold uppercase text-[#00ff66]">
              <KeyRound className="w-4 h-4" />
              <span>1. Admin Owner Credentials</span>
            </div>
            {secConfig?.isDefaultPassword && (
              <span className="rounded bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-amber-300">
                DEFAULT PASSWORD
              </span>
            )}
          </div>

          <p className="text-xs font-mono text-zinc-400 leading-relaxed">
            Your Admin account has full control over server settings, downloaders,
            and library paths. Set a strong password before exposing your Docker
            container to the internet:
          </p>

          <form onSubmit={handleSaveAdminCredentials} className="space-y-3">
            <div>
              <label className="block text-xs font-mono font-bold text-zinc-300 mb-1">
                Admin Username
              </label>
              <input
                type="text"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                disabled={isListenerRole}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-mono font-bold text-zinc-300 mb-1">
                New Admin Password
              </label>
              <div className="relative">
                <input
                  type={showAdminPass ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  disabled={isListenerRole}
                  placeholder={
                    secConfig?.isDefaultPassword
                      ? 'Currently default ("brokeify") — type new password'
                      : 'Leave blank to keep current password'
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 pl-3.5 pr-9 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowAdminPass(!showAdminPass)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                >
                  {showAdminPass ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingAdmin || isListenerRole}
              data-testid="save-admin-credentials-btn"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 py-2.5 px-4 text-xs font-mono font-bold text-zinc-950 transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Save Admin Credentials &amp; Enable Lock</span>
            </button>
          </form>
        </div>

        {/* Right: Friends & Family Shared Accounts (Listener Role) */}
        <div className="lg:col-span-7 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-mono font-bold uppercase text-purple-300">
              <Users className="w-4 h-4 text-purple-400" />
              <span>2. Friends &amp; Family Accounts (Safe Sharing)</span>
            </div>
            <span className="rounded bg-purple-500/20 border border-purple-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-purple-300">
              SETTINGS &amp; DELETE LOCKED
            </span>
          </div>

          <p className="text-xs font-mono text-zinc-400 leading-relaxed">
            Create accounts for friends and family so they can log in at{' '}
            <code className="text-zinc-200">https://your-brokeify-server.com</code> and
            stream your music collection from anywhere,{' '}
            <strong className="text-white">
              without being able to change your settings or delete files
            </strong>
            .
          </p>

          {!isListenerRole && (
            <form
              onSubmit={handleAddGuestUser}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
            >
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Name / Label
                </label>
                <input
                  type="text"
                  value={guestDisplayName}
                  onChange={(e) => setGuestDisplayName(e.target.value)}
                  placeholder="Mom / Friend"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-purple-400 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={guestUsername}
                  onChange={(e) => setGuestUsername(e.target.value)}
                  placeholder="family1"
                  data-testid="guest-username-input"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-purple-400 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={guestPassword}
                  onChange={(e) => setGuestPassword(e.target.value)}
                  placeholder="Password"
                  data-testid="guest-password-input"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-purple-400 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <button
                  type="submit"
                  disabled={addingGuest}
                  data-testid="add-guest-user-btn"
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 py-2 px-3 text-xs font-mono font-bold text-white transition-colors min-h-[36px]"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add User</span>
                </button>
              </div>
            </form>
          )}

          {/* Existing Friends & Family Accounts List */}
          <div className="space-y-2 pt-1">
            {secConfig?.guestUsers && secConfig.guestUsers.length > 0 ? (
              secConfig.guestUsers.map((g) => (
                <div
                  key={g.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs font-mono"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <UserCheck className="w-4 h-4 text-[#00ff66] shrink-0" />
                    <div className="min-w-0">
                      <div className="font-bold text-white truncate">
                        {g.displayName}{' '}
                        <span className="text-zinc-400 font-normal">
                          (@{g.username})
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        Role:{' '}
                        <span className="text-purple-300 font-semibold">
                          {g.role === 'listener'
                            ? 'Listener (Stream Only — Settings Locked)'
                            : 'Admin'}
                        </span>
                        {g.lastLoginAt &&
                          ` · Last login: ${new Date(
                            g.lastLoginAt
                          ).toLocaleDateString()}`}
                      </div>
                    </div>
                  </div>

                  {!isListenerRole && (
                    <button
                      type="button"
                      onClick={() => handleRemoveGuestUser(g.id)}
                      className="rounded-lg border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/50 p-1.5 text-rose-300"
                      title="Remove User"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 text-xs font-mono text-zinc-400">
                No Friends &amp; Family accounts added yet. Use the form above
                to create a stream-only account for friends or family.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: Anti-Bot / Anti-Scraper Shield + Dockge Container Recreate & SQLite Persistence Explanation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Anti-Bot, Scraper & Intruder Shield */}
        <div className="rounded-2xl border border-emerald-500/30 bg-zinc-950/80 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase text-[#00ff66]">
              <Bot className="w-4 h-4" />
              <span>Anti-Bot, Web Scraper &amp; Hacker Shield</span>
            </div>
            <span className="rounded bg-[#00ff66]/15 border border-[#00ff66]/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
              ACTIVE 24/7
            </span>
          </div>
          <ul className="text-xs font-mono text-zinc-300 space-y-1.5 leading-relaxed">
            <li>
              • <strong>Crawler &amp; Bot Blocker:</strong> Automatically drops
              requests from Shodan, Censys, Masscan, Nmap, Nuclei, GPTBot,
              CCBot, and web scrapers with <code>HTTP 403 Forbidden</code> (
              <strong className="text-[#00ff66]">
                {secConfig?.securityStats?.blockedBotsCount ?? 0} bots blocked
              </strong>
              ).
            </li>
            <li>
              • <strong>Brute-Force IP Lockout:</strong> Automatically locks out
              any IP address for 15 minutes after 5 failed password or 6-digit
              Quick Connect attempts (
              <strong className="text-[#00ff66]">
                {secConfig?.securityStats?.blockedBruteForceCount ?? 0} lockouts
              </strong>
              ).
            </li>
            <li>
              • <strong>Zero Search Indexing:</strong> Serves strict{' '}
              <code>/robots.txt (Disallow: /)</code> and{' '}
              <code>X-Robots-Tag: noindex, nofollow</code> headers so Google/Bing
              and bots never index your domain.
            </li>
          </ul>

          {secConfig?.blockedIps && secConfig.blockedIps.length > 0 && (
            <div className="pt-2 space-y-1.5">
              <div className="text-[11px] font-mono font-bold text-rose-300">
                Currently Locked-Out Intruder IPs:
              </div>
              {secConfig.blockedIps.map((item) => (
                <div
                  key={item.ip}
                  className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-2.5 py-1.5 flex items-center justify-between text-xs font-mono"
                >
                  <span className="text-rose-200">
                    {item.ip} ({item.failures} failed attempts)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleUnblockIp(item.ip)}
                    className="text-[11px] text-[#00ff66] underline"
                  >
                    Unblock
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dockge Container Update & SQLite Persistence Guarantee */}
        <div className="rounded-2xl border border-cyan-500/30 bg-zinc-950/80 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase text-cyan-300">
              <Database className="w-4 h-4" />
              <span>Dockge Updates &amp; Persistent Database Status</span>
            </div>
            <span className="rounded bg-cyan-500/15 border border-cyan-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-300">
              100% PERSISTENT
            </span>
          </div>
          <p className="text-xs font-mono text-zinc-300 leading-relaxed">
            <strong>Yes — it is 100% normal</strong> for Dockge to say{' '}
            <code>Container brokeify Recreated</code> whenever you pull a new
            version! That is how Docker updates container code.
          </p>
          <ul className="text-xs font-mono text-zinc-300 space-y-1 leading-relaxed">
            <li>
              • Because your compose mounts{' '}
              <code className="text-[#00ff66]">
                /path/to/brokeify/data:/data
              </code>
              , your database (<code>/data/brokeify.db</code>), settings (
              <code>/data/config.json</code>), playlists, MBIDs, and cover art{' '}
              <strong>live on your host storage outside the container</strong> and{' '}
              <strong className="text-[#00ff66]">
                stay 100% intact across every update
              </strong>
              .
            </li>
            <li>
              • On startup, Brokeify restores <code>/data/brokeify.db</code>{' '}
              instantly and fast-verifies existing files in <code>/music</code>{' '}
              (<code>/path/to/your/music:/music:ro</code>) so only newly added songs are
              parsed!
            </li>
          </ul>
        </div>
      </div>

      {/* Personal API Keys (brk_live_...) & Companion App / API Handshake Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2 border-t border-zinc-800/80">
        {/* Left 6 Cols: Personal API Keys */}
        <div
          data-testid="personal-api-keys-panel"
          className="lg:col-span-6 rounded-2xl border border-cyan-500/30 bg-zinc-950/80 p-4 space-y-3"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <span className="text-xs font-mono font-bold uppercase text-cyan-300 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-cyan-400" />
              Personal API Keys (Android / Android Auto / 3rd-Party Clients)
            </span>
            <span className="text-[10px] font-mono text-zinc-400">
              {apiKeys.length} active
            </span>
          </div>

          <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">
            Generate long-lived, revocable bearer tokens (
            <code className="text-cyan-300">brk_live_...</code>) for native
            mobile apps or headless scripts so you never have to store your
            master password on external devices.
          </p>

          {!isListenerRole && (
            <form
              onSubmit={handleCreatePersonalApiKey}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Device label (e.g. Pixel 9 Pro / Android Auto)"
                data-testid="input-new-api-key-name"
                className="flex-1 min-w-[180px] rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
              />
              <button
                type="submit"
                disabled={isCreatingKey}
                data-testid="create-personal-api-key-btn"
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 px-3.5 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[38px]"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>
                  {isCreatingKey ? 'Generating...' : 'Generate API Key'}
                </span>
              </button>
            </form>
          )}

          {newlyCreatedToken && (
            <div
              data-testid="newly-created-api-key-banner"
              className="rounded-xl border border-[#00ff66] bg-emerald-950/40 p-3 space-y-1.5 font-mono text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#00ff66] font-bold">
                  ✓ Copy Your Personal API Key Now (Shown Once):
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(newlyCreatedToken);
                    onShowToast('📋 Copied API Key to clipboard!');
                  }}
                  className="inline-flex items-center gap-1 rounded bg-[#00ff66] px-2 py-0.5 text-[10px] font-bold text-zinc-950"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy Token</span>
                </button>
              </div>
              <code className="block break-all rounded bg-black/60 p-2 text-[11px] text-white select-all">
                {newlyCreatedToken}
              </code>
            </div>
          )}

          {apiKeys.length > 0 && (
            <div className="space-y-2 max-h-40 overflow-y-auto pt-1">
              {apiKeys.map((k) => (
                <div
                  key={k.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 flex items-center justify-between gap-2 text-xs font-mono"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-white truncate">
                      {k.name}{' '}
                      <span className="text-cyan-300 font-normal">
                        ({k.prefix})
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      Created {new Date(k.createdAt).toLocaleDateString()} · Role:{' '}
                      {k.role}
                    </div>
                  </div>
                  {!isListenerRole && (
                    <button
                      type="button"
                      onClick={() => handleRevokeApiKey(k.id)}
                      className="rounded-lg border border-zinc-800 bg-zinc-950 hover:border-rose-500/50 px-2.5 py-1 text-[10px] text-rose-300 hover:bg-rose-950/40 shrink-0"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right 6 Cols: Companion App & API Handshake (brokeify-api-handshake.md) */}
        <div
          data-testid="companion-api-handshake-panel"
          className="lg:col-span-6 rounded-2xl border border-[#00ff66]/40 bg-zinc-950/80 p-4 space-y-3 flex flex-col justify-between"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
              <span className="text-xs font-mono font-bold uppercase text-[#00ff66] flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-[#00ff66]" />
                Companion App &amp; API Handshake (brokeify-api-handshake.md)
              </span>
              <span className="rounded bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
                v2.5 Spec Ready
              </span>
            </div>

            <p className="text-xs font-mono text-zinc-300 leading-relaxed">
              Building or updating the native{' '}
              <strong className="text-white">
                Brokeify Android / Android Auto
              </strong>{' '}
              app? Download or copy the{' '}
              <code className="text-[#00ff66]">brokeify-api-handshake.md</code>{' '}
              specification—complete with JWT &amp; Personal API Key auth flows,
              HTTP 206 byte-range streaming headers, and exact TypeScript/JSON
              schemas. Defaults to{' '}
              <code className="text-cyan-300">https://your-brokeify-server.com</code>{' '}
              so exported specs never leak a private domain by accident.
            </p>

            <label
              htmlFor="include-current-server-url-checkbox"
              className="mt-2 flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs font-mono text-zinc-200 cursor-pointer hover:border-[#00ff66]/40 transition-colors"
            >
              <input
                id="include-current-server-url-checkbox"
                type="checkbox"
                checked={includeCurrentServerUrl}
                onChange={(e) => setIncludeCurrentServerUrl(e.target.checked)}
                data-testid="checkbox-include-current-server-url"
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-[#00ff66] focus:ring-[#00ff66]"
              />
              <span>
                Include my current server URL{' '}
                <span className="text-zinc-400">
                  (embeds{' '}
                  <code className="text-[#00ff66]">
                    {typeof window !== 'undefined'
                      ? window.location.origin
                      : 'https://your-brokeify-server.com'}
                  </code>{' '}
                  instead of placeholder)
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-2">
            <a
              href={
                includeCurrentServerUrl
                  ? '/api/system/spec?download=1&includeCurrentUrl=1'
                  : '/api/system/spec?download=1'
              }
              download="brokeify-api-handshake.md"
              data-testid="download-api-handshake-btn"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[40px]"
            >
              <QrCode className="w-4 h-4" />
              <span>Download brokeify-api-handshake.md</span>
            </a>

            <button
              type="button"
              disabled={isCopyingSpec}
              onClick={handleCopyApiHandshakeSpec}
              data-testid="copy-api-handshake-btn"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-950/30 hover:bg-emerald-900/40 px-4 py-2.5 text-xs font-mono font-bold text-[#00ff66] transition-colors min-h-[40px]"
            >
              {copiedSpecDone ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Copied Spec to Clipboard!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Spec to Clipboard</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
