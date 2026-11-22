'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, setAuthToken } from '@/lib/api-client';
import { ShieldCheck, LogIn, AlertCircle, Fingerprint, Sparkles } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [mfaPromptVisible, setMfaPromptVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const completeSession = (res: { token: string; user: any }) => {
    setAuthToken(res.token);
    if (res.user.memberships?.length > 0) {
      localStorage.setItem('active_tenant_id', res.user.memberships[0].tenantId);
      localStorage.setItem('active_tenant_name', res.user.memberships[0].tenantName);
    }
    localStorage.setItem('current_user', JSON.stringify(res.user));
    router.push('/overview');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage('');

    try {
      const res = await apiFetch<{ token: string; user: any }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          ...(totpCode ? { totpCode } : {}),
        }),
      });
      completeSession(res);
    } catch (err: any) {
      const msg = err.message || 'Login failed. Please check your credentials.';
      if (msg.includes('MfaRequired')) {
        setMfaPromptVisible(true);
      }
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setErrorMessage('');
    setIsLoading(true);
    try {
      const options = await apiFetch<{
        challenge: string;
        rpId: string;
        allowCredentials: Array<{ id: string; type: 'public-key' }>;
      }>('/auth/passkey/login/options', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });

      if (typeof window === 'undefined' || !window.PublicKeyCredential) {
        throw new Error('WebAuthn Passkeys are not supported in this browser context.');
      }

      const b64UrlToUint8 = (str: string) => {
        const pad = '='.repeat((4 - (str.length % 4)) % 4);
        const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
        return Uint8Array.from(bin, (c) => c.charCodeAt(0));
      };
      const uint8ToB64Url = (buf: ArrayBuffer) =>
        btoa(String.fromCharCode(...new Uint8Array(buf)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '');

      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: b64UrlToUint8(options.challenge),
          rpId: options.rpId,
          allowCredentials: options.allowCredentials.map((c) => ({
            id: b64UrlToUint8(c.id),
            type: 'public-key',
          })),
        },
      })) as PublicKeyCredential | null;

      if (!assertion) {
        throw new Error('Passkey authentication was cancelled.');
      }

      const resp = assertion.response as AuthenticatorAssertionResponse;
      const verified = await apiFetch<{ token: string; user: any }>('/auth/passkey/login/verify', {
        method: 'POST',
        body: JSON.stringify({
          challenge: options.challenge,
          credentialId: assertion.id,
          clientDataJSONBase64Url: uint8ToB64Url(resp.clientDataJSON),
          authenticatorDataBase64Url: uint8ToB64Url(resp.authenticatorData),
          signatureBase64Url: uint8ToB64Url(resp.signature),
        }),
      });

      completeSession(verified);
    } catch (err: any) {
      setErrorMessage(err.message || 'Passkey sign-in could not be completed.');
    } finally {
      setIsLoading(false);
    }
  };

  const fillDemoCredentials = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('DevPassword123!');
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-900 px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-8 border border-slate-200">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-sky-100 text-sky-600 mb-4">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Contact Center Console</h1>
          <p className="text-sm text-slate-500 mt-1">Open-Source AI Customer Service Platform</p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Authentication Notice</p>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-slate-900 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-sm"
              placeholder="agent@company.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-slate-900 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-sm"
              placeholder="••••••••••••"
            />
          </div>

          {mfaPromptVisible && (
            <div>
              <label htmlFor="totpCode" className="block text-sm font-medium text-slate-700 mb-1">
                6-Digit TOTP Authenticator Code
              </label>
              <input
                id="totpCode"
                type="text"
                inputMode="numeric"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border border-sky-400 text-slate-900 font-mono text-sm"
                placeholder="123456"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg shadow transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            {isLoading ? (
              <span>Signing in...</span>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Sign In to Console</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={isLoading}
            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            <Fingerprint className="w-4 h-4 text-sky-400" />
            <span>Sign In with Passkey (WebAuthn / FIDO2)</span>
          </button>
        </form>

        <div className="mt-5 text-center">
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>New organization? Start 14-day Pro Workspace Trial</span>
          </Link>
        </div>

        <div className="mt-6 pt-5 border-t border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Quick Fill Development Credentials:
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fillDemoCredentials('admin@acme-hvac.example.com')}
              className="text-left px-3 py-2 text-xs bg-slate-50 hover:bg-slate-100 rounded border border-slate-200 text-slate-700 flex justify-between items-center"
            >
              <span>
                Acme HVAC Owner: <strong>admin@acme-hvac.example.com</strong>
              </span>
              <span className="text-sky-600 font-semibold">Autofill</span>
            </button>
            <button
              type="button"
              onClick={() => fillDemoCredentials('sarah.agent@acme-hvac.example.com')}
              className="text-left px-3 py-2 text-xs bg-slate-50 hover:bg-slate-100 rounded border border-slate-200 text-slate-700 flex justify-between items-center"
            >
              <span>
                Support Agent: <strong>sarah.agent@acme-hvac.example.com</strong>
              </span>
              <span className="text-sky-600 font-semibold">Autofill</span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
