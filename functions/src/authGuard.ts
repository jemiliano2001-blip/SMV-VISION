/**
 * Usuario real de Vision: con sesión y NO anónimo.
 * smv-brain tiene la autenticación anónima activa por el Dashboard (TV pública); sin este filtro,
 * cualquiera con la config web podía llamar analyzeGemini (saldo de Gemini) y triggerOdooSync.
 * Acepta email/contraseña y el custom token del SSO de SMV Hub (`custom`).
 */
export interface CallableAuthLike {
  uid: string;
  token: { firebase?: { sign_in_provider?: string } };
}

export function isVisionUser(auth: CallableAuthLike | undefined | null): boolean {
  const provider = auth?.token?.firebase?.sign_in_provider;
  return Boolean(auth?.uid) && typeof provider === 'string' && provider !== 'anonymous';
}
