/**
 * AuthGate: puerta de entrada a pantalla completa.
 *
 * - Permite inicio de sesión con Google o Correo/Contraseña.
 * - Mantiene el estilo brutalist de la app (border-ink, shadow duro).
 * - Errores de login se muestran como feedback constructivo al usuario.
 * - Si Firebase no está configurado, permite el paso con un banner de advertencia.
 * - MODO DEBUG: Permite bypass manual para desarrollo.
 */

import { useCallback, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { AlertCircle, Loader2, LogIn, LogOut, ShieldCheck, Mail, Lock, Ghost } from 'lucide-react';

import { isFirebaseConfigured } from '../lib/firebase/env';
import {
  signInWithGoogle,
  signInWithEmailPassword,
  signOutUser,
  useFirebaseUser,
} from '../lib/firebase/auth';
import { validateSignInCredentials } from '../lib/firebase/authValidators';

interface AuthGateProps {
  children: ReactNode;
}

interface UserBadgeProps {
  displayName: string;
  email: string;
  onSignOut: () => void;
  signingOut: boolean;
}

export function AuthGate({ children }: AuthGateProps): ReactElement {
  const auth = useFirebaseUser();
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [signingOut, setSigningOut] = useState<boolean>(false);
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

  const handleSignOut = useCallback(async () => {
    if (isBypassed) {
      setIsBypassed(false);
      return;
    }
    setSigningOut(true);
    const result = await signOutUser();
    setSigningOut(false);
    if (result.ok === false && result.reason === 'error') {
      setErrorMessage(result.message ?? 'No fue posible cerrar sesión.');
    }
  }, [isBypassed]);

  if (isBypassed || !isFirebaseConfigured() || auth.status === 'unavailable') {
    return (
      <div className="flex flex-col min-h-screen">
        <ConfigWarningBanner isBypass={isBypassed} />
        <div className="grow">{children}</div>
      </div>
    );
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

  const user = auth.user;
  const displayName = user.displayName ?? user.email ?? 'Usuario';
  const email = user.email ?? '';

  return (
    <div className="flex flex-col min-h-screen">
      <UserBadge
        displayName={displayName}
        email={email}
        onSignOut={() => void handleSignOut()}
        signingOut={signingOut}
      />
      <div className="grow">{children}</div>
    </div>
  );
}

function LoadingScreen(): ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#E8E8E8]">
      <div className="flex flex-col items-center gap-3 text-ink">
        <Loader2 size={32} className="animate-spin" />
        <p className="text-[11px] font-black uppercase tracking-widest">
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
    <div className="min-h-screen bg-[#E8E8E8] flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md border-2 border-ink bg-white shadow-[6px_6px_0px_rgba(0,0,0,1)]">
        <div className="border-b-2 border-ink px-6 py-4 bg-ink text-bg flex items-center gap-3">
          <ShieldCheck size={22} />
          <h1 className="text-[18px] font-black tracking-[-0.5px] uppercase">
            SMV VISION // AUTH
          </h1>
        </div>

        <div className="p-6 flex flex-col gap-6">
          <div className="space-y-1">
            <p className="text-[11px] font-black uppercase tracking-widest text-ink/70">
              Control de Acceso
            </p>
            <p className="text-[13px] text-ink/80 leading-snug">
              Inicia sesión para auditar planos o usa el modo debug.
            </p>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
            <div className="space-y-3 opacity-40 grayscale pointer-events-none">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-ink/60 flex items-center gap-1.5">
                  <Mail size={12} /> Correo
                </label>
                <input
                  type="email"
                  disabled
                  placeholder="usuario@smv.com"
                  className="w-full border-2 border-ink bg-white px-3 py-2 text-sm font-bold outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-ink/60 flex items-center gap-1.5">
                  <Lock size={12} /> Contraseña
                </label>
                <input
                  type="password"
                  disabled
                  placeholder="••••••••"
                  className="w-full border-2 border-ink bg-white px-3 py-2 text-sm font-bold outline-none"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={onBypass}
              className="w-full bg-accent text-bg hover:bg-ink hover:text-white px-4 py-4 text-[14px] font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-[4px_4px_0px_rgba(0,0,0,0.2)] active:translate-x-0.5 active:translate-y-0.5 transition-all animate-pulse"
            >
              <Ghost size={20} /> Omitir Login (Modo Debug)
            </button>
          </form>

          <div className="relative flex items-center py-1 opacity-30">
            <div className="grow border-t-2 border-ink/10"></div>
            <span className="mx-4 text-[10px] font-black text-ink/40 uppercase tracking-widest">Otras opciones</span>
            <div className="grow border-t-2 border-ink/10"></div>
          </div>

          <button
            type="button"
            onClick={() => void onSignInGoogle()}
            disabled={signingIn}
            className="w-full border-2 border-ink bg-white hover:bg-[#F4F4F4] disabled:opacity-30 transition-colors px-4 py-3 text-[12px] font-black uppercase tracking-widest flex items-center justify-center gap-2 opacity-60"
          >
            <LogIn size={16} /> Entrar con Google
          </button>

          {errorMessage && (
            <div className="border-2 border-ink bg-[#FFF2F2] px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="text-[11px] text-ink leading-snug font-bold">
                {errorMessage}
              </span>
            </div>
          )}

          <p className="text-[9px] text-ink/40 leading-tight italic text-center">
            Development mode enabled. Authentication is currently optional.
          </p>
        </div>
      </div>
    </div>
  );
}

function UserBadge({ displayName, email, onSignOut, signingOut }: UserBadgeProps): ReactElement {
  return (
    <div className="border-b-2 border-ink bg-white px-4 py-2 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <ShieldCheck size={14} className="shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-black uppercase tracking-widest text-ink/70">
            Sesión activa
          </span>
          <span className="text-[12px] font-bold text-ink truncate" title={email || displayName}>
            {displayName}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        className="shrink-0 border border-ink bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest hover:bg-ink hover:text-bg disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
      >
        {signingOut ? (
          <>
            <Loader2 size={11} className="animate-spin" /> Saliendo…
          </>
        ) : (
          <>
            <LogOut size={11} /> Salir
          </>
        )}
      </button>
    </div>
  );
}

function ConfigWarningBanner({ isBypass }: { isBypass?: boolean }): ReactElement {
  return (
    <div className={`border-b-2 border-ink px-4 py-2 flex items-center gap-2 ${isBypass ? 'bg-accent text-bg' : 'bg-[#FFF6CC] text-ink'}`}>
      {isBypass ? <Ghost size={14} className="shrink-0" /> : <AlertCircle size={14} className="shrink-0" />}
      <p className="text-[11px] font-black uppercase tracking-tighter">
        {isBypass 
          ? 'MODO DEBUG: Sesión sin autenticar activa. Los registros de auditoría no se guardarán.' 
          : 'Firebase no configurado: el audit trail está desactivado.'}
      </p>
    </div>
  );
}
