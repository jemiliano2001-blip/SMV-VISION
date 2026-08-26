/**
 * AuthGate: puerta de entrada a pantalla completa.
 *
 * - App privada: inicio de sesión con Correo/Contraseña únicamente.
 *   Las cuentas se crean a mano en Firebase Console (no hay registro público).
 * - El "Omitir Login (Modo Debug)" SOLO se muestra en desarrollo local
 *   (import.meta.env.DEV). En producción nunca aparece.
 * - Estilo "instrumento de ingeniería" (oscuro) consistente con la app.
 * - Errores de login se muestran como feedback constructivo al usuario.
 * - Si Firebase no está configurado, deja pasar (la app funciona sin auditoría).
 * - Fail-closed: si Firebase SÍ está configurado pero Auth no pudo
 *   inicializar, se bloquea con pantalla de error (nunca se deja pasar).
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { AlertCircle, Loader2, LogIn, ShieldCheck, Mail, Lock, Ghost, ShieldAlert } from 'lucide-react';

import { isFirebaseConfigured } from '../lib/firebase/env';
import { signInWithEmailPassword, signInWithSsoToken, useFirebaseUser } from '../lib/firebase/auth';
import { validateSignInCredentials } from '../lib/firebase/authValidators';
import { log } from '../lib/log';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps): ReactElement {
  const auth = useFirebaseUser();
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBypassed, setIsBypassed] = useState<boolean>(false);

  // Detección y procesamiento de SSO token proveniente de SMV Hub
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const ssoToken = params.get('sso_token');
    if (ssoToken) {
      setSigningIn(true);
      setErrorMessage(null);
      signInWithSsoToken(ssoToken)
        .then((res) => {
          if (res.ok === false) {
            setErrorMessage(res.message || 'No fue posible autenticar con el token SSO.');
            return;
          }
          const urlLimpia = window.location.pathname + window.location.search;
          window.history.replaceState(null, '', urlLimpia);
        })
        .catch((err) => {
          log.error('[smv-vision][auth] error procesando SSO token:', err);
          setErrorMessage('Error al procesar el token SSO.');
        })
        .finally(() => {
          setSigningIn(false);
        });
    }
  }, []);


  const handleSignInEmail = useCallback(async (email: string, pass: string) => {
    setErrorMessage(null);
    const validated = validateSignInCredentials({ email, password: pass });
    if (validated.ok === false) {
      return { ok: false as const, fieldIssues: validated.issues };
    }

    setSigningIn(true);
    const result = await signInWithEmailPassword(validated.value.email, validated.value.password);
    setSigningIn(false);

    if (result.ok === false) {
      if (result.reason === 'not-configured') {
        setErrorMessage('Firebase no está configurado en este entorno.');
        return { ok: false as const, fieldIssues: [] };
      }
      setErrorMessage('message' in result ? (result.message ?? 'No fue posible iniciar sesión.') : 'No fue posible iniciar sesión.');
      return { ok: false as const, fieldIssues: [] };
    }
    return { ok: true as const, fieldIssues: [] };
  }, []);

  if (isBypassed || !isFirebaseConfigured()) {
    return <>{children}</>;
  }

  // Firebase configurado pero el SDK de Auth no inicializó: bloquear.
  // Dejar pasar aquí expondría la app (y el uso de la API key de Gemini)
  // sin ninguna sesión.
  if (auth.status === 'unavailable') {
    return <AuthUnavailableScreen />;
  }

  if (auth.status === 'loading') {
    return <LoadingScreen />;
  }

  if (auth.status === 'signed-out' || auth.user === null) {
    return (
      <LoginScreen
        onSignInEmail={handleSignInEmail}
        onBypass={() => setIsBypassed(true)}
        signingIn={signingIn}
        errorMessage={errorMessage}
        onClearError={() => setErrorMessage(null)}
      />
    );
  }

  return <>{children}</>;
}

function LoadingScreen(): ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg bp-grid-lg">
      <div className="flex flex-col items-center gap-3 text-ink">
        <Loader2 size={32} className="animate-spin text-accent" />
        <p className="font-mono text-[11px] font-black uppercase tracking-widest text-ink-dim">
          Cargando sesión…
        </p>
      </div>
    </div>
  );
}

function AuthUnavailableScreen(): ReactElement {
  return (
    <div className="min-h-screen bg-bg bp-grid-lg flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md border-2 border-danger bg-surface shadow-hard corner-ticks">
        <div className="border-b-2 border-danger px-6 py-4 bg-surface-2 text-ink flex items-center gap-3">
          <ShieldAlert size={22} className="text-danger" />
          <h1 className="font-display text-[20px] font-black tracking-[-0.5px] uppercase italic">
            SMV<span className="text-danger">//</span>VISION
          </h1>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <p className="font-mono text-[11px] font-black uppercase tracking-widest text-danger">
            Autenticación no disponible
          </p>
          <p className="text-[13px] text-ink-dim leading-snug">
            Firebase está configurado pero el módulo de autenticación no pudo
            inicializar. Por seguridad el acceso queda bloqueado. Verifica tu
            conexión y recarga la página.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full bg-danger text-bg hover:bg-danger/80 px-4 py-3 text-[13px] font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-hard active:translate-x-0.5 active:translate-y-0.5 transition-all"
          >
            Recargar
          </button>
        </div>
      </div>
    </div>
  );
}

interface LoginScreenProps {
  onSignInEmail: (
    email: string,
    pass: string,
  ) => Promise<{ ok: boolean; fieldIssues: Array<{ path: string; message: string }> }>;
  onBypass: () => void;
  signingIn: boolean;
  errorMessage: string | null;
  onClearError: () => void;
}

function LoginScreen({
  onSignInEmail,
  onBypass,
  signingIn,
  errorMessage,
  onClearError,
}: LoginScreenProps): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onClearError();
      setFieldErrors({});
      const result = await onSignInEmail(email, password);
      if (!result.ok && result.fieldIssues.length > 0) {
        const next: { email?: string; password?: string } = {};
        for (const issue of result.fieldIssues) {
          if (issue.path === 'email') next.email = issue.message;
          if (issue.path === 'password') next.password = issue.message;
        }
        setFieldErrors(next);
      }
    },
    [email, onClearError, onSignInEmail, password],
  );

  return (
    <div className="min-h-screen bg-bg bp-grid-lg flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md border-2 border-line bg-surface shadow-hard-accent corner-ticks">
        <div className="border-b-2 border-line px-6 py-4 bg-surface-2 text-ink flex items-center gap-3">
          <ShieldCheck size={22} className="text-accent" />
          <h1 className="font-display text-[20px] font-black tracking-[-0.5px] uppercase italic">
            SMV<span className="text-accent">//</span>VISION
          </h1>
        </div>

        <div className="p-6 flex flex-col gap-6">
          <div className="space-y-1">
            <p className="font-mono text-[11px] font-black uppercase tracking-widest text-accent">
              Control de Acceso
            </p>
            <p className="text-[13px] text-ink-dim leading-snug">
              Inicia sesión con tu correo y contraseña.
            </p>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-ink-dim flex items-center gap-1.5">
                  <Mail size={12} /> Correo
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="usuario@smv.com"
                  className="w-full border-2 border-line bg-surface-2 text-ink px-3 py-2 text-sm font-bold outline-none focus:border-accent"
                />
                {fieldErrors.email && (
                  <span className="text-[10px] font-bold text-danger">{fieldErrors.email}</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-ink-dim flex items-center gap-1.5">
                  <Lock size={12} /> Contraseña
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full border-2 border-line bg-surface-2 text-ink px-3 py-2 text-sm font-bold outline-none focus:border-accent"
                />
                {fieldErrors.password && (
                  <span className="text-[10px] font-bold text-danger">{fieldErrors.password}</span>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={signingIn}
              className="w-full bg-accent text-bg hover:bg-accent/80 disabled:opacity-40 px-4 py-4 text-[14px] font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-hard active:translate-x-0.5 active:translate-y-0.5 transition-all"
            >
              {signingIn ? <Loader2 size={20} className="animate-spin" /> : <LogIn size={20} />} Entrar
            </button>
          </form>

          {errorMessage && (
            <div className="border-2 border-danger bg-danger/10 px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5 text-danger" />
              <span className="text-[11px] text-danger leading-snug font-bold">
                {errorMessage}
              </span>
            </div>
          )}

          {import.meta.env.DEV && (
            <>
              <div className="relative flex items-center py-1 opacity-40">
                <div className="grow border-t-2 border-line"></div>
                <span className="mx-4 text-[10px] font-black text-ink-dim uppercase tracking-widest">Solo desarrollo</span>
                <div className="grow border-t-2 border-line"></div>
              </div>
              <button
                type="button"
                onClick={onBypass}
                className="w-full border-2 border-line bg-surface-2 text-ink-dim hover:border-accent hover:text-accent transition-colors px-4 py-3 text-[12px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
              >
                <Ghost size={16} /> Omitir Login (Modo Debug)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
