/**
 * AuthGate: puerta de entrada a pantalla completa.
 *
 * - Permite inicio de sesión con Google o Correo/Contraseña.
 * - Estilo "instrumento de ingeniería" (oscuro) consistente con la app.
 * - Errores de login se muestran como feedback constructivo al usuario.
 * - Si Firebase no está configurado o se omite el login, deja pasar; la sesión
 *   (o su ausencia) se refleja en el rail de navegación, no en una barra propia.
 */

import { useCallback, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { AlertCircle, Loader2, LogIn, ShieldCheck, Mail, Lock, Ghost } from 'lucide-react';

import { isFirebaseConfigured } from '../lib/firebase/env';
import {
  signInWithGoogle,
  signInWithEmailPassword,
  useFirebaseUser,
} from '../lib/firebase/auth';
import { validateSignInCredentials } from '../lib/firebase/authValidators';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps): ReactElement {
  const auth = useFirebaseUser();
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBypassed, setIsBypassed] = useState<boolean>(false);

  const handleSignInGoogle = useCallback(async () => {
    setErrorMessage(null);
    setSigningIn(true);
    const result = await signInWithGoogle();
    setSigningIn(false);
    if (result.ok === false) {
      if (result.reason === 'redirecting' || result.reason === 'cancelled') {
        return;
      }
      if (result.reason === 'not-configured') {
        setErrorMessage(
          'Firebase no está configurado en este entorno (faltan variables VITE_FIREBASE_*).',
        );
        return;
      }
      setErrorMessage(result.message ?? 'No fue posible iniciar sesión con Google.');
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

  if (isBypassed || !isFirebaseConfigured() || auth.status === 'unavailable') {
    return <>{children}</>;
  }

  if (auth.status === 'loading') {
    return <LoadingScreen />;
  }

  if (auth.status === 'signed-out' || auth.user === null) {
    return (
      <LoginScreen
        onSignInGoogle={handleSignInGoogle}
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

interface LoginScreenProps {
  onSignInGoogle: () => void;
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
  onSignInGoogle,
  onSignInEmail,
  onBypass,
  signingIn,
  errorMessage,
  onClearError,
}: LoginScreenProps): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [, setFieldErrors] = useState<{ email?: string; password?: string }>({});

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
              Inicia sesión para auditar planos o usa el modo debug.
            </p>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
            <div className="space-y-3 opacity-40 grayscale pointer-events-none">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-ink-dim flex items-center gap-1.5">
                  <Mail size={12} /> Correo
                </label>
                <input
                  type="email"
                  disabled
                  placeholder="usuario@smv.com"
                  className="w-full border-2 border-line bg-surface-2 text-ink px-3 py-2 text-sm font-bold outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-ink-dim flex items-center gap-1.5">
                  <Lock size={12} /> Contraseña
                </label>
                <input
                  type="password"
                  disabled
                  placeholder="••••••••"
                  className="w-full border-2 border-line bg-surface-2 text-ink px-3 py-2 text-sm font-bold outline-none"
                />
              </div>
            </div>

            {import.meta.env.DEV && (
              <button
                type="button"
                onClick={onBypass}
                className="w-full bg-accent text-bg hover:bg-accent/80 px-4 py-4 text-[14px] font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-hard active:translate-x-0.5 active:translate-y-0.5 transition-all"
              >
                <Ghost size={20} /> Omitir Login (Modo Debug)
              </button>
            )}
          </form>

          <div className="relative flex items-center py-1 opacity-40">
            <div className="grow border-t-2 border-line"></div>
            <span className="mx-4 text-[10px] font-black text-ink-dim uppercase tracking-widest">Otras opciones</span>
            <div className="grow border-t-2 border-line"></div>
          </div>

          <button
            type="button"
            onClick={() => void onSignInGoogle()}
            disabled={signingIn}
            className="w-full border-2 border-line bg-surface-2 text-ink hover:border-accent hover:text-accent disabled:opacity-30 transition-colors px-4 py-3 text-[12px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
          >
            {signingIn ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />} Entrar con Google
          </button>

          {errorMessage && (
            <div className="border-2 border-danger bg-danger/10 px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5 text-danger" />
              <span className="text-[11px] text-danger leading-snug font-bold">
                {errorMessage}
              </span>
            </div>
          )}

          {import.meta.env.DEV && (
            <p className="text-[9px] text-ink-dim/70 leading-tight italic text-center">
              Development mode enabled. Authentication is currently optional.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
