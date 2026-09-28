import { describe, expect, it } from 'vitest';
import { isVisionUser } from '../../../functions/src/authGuard';

/**
 * analyzeGemini (gasta saldo de Gemini) y triggerOdooSync (consulta Odoo) solo aceptaban `request.auth`.
 * En smv-brain la autenticación anónima está activa por el Dashboard: un anónimo no es usuario de Vision.
 */
describe('isVisionUser', () => {
  it('rechaza sin sesión', () => {
    expect(isVisionUser(undefined)).toBe(false);
  });

  it('rechaza una sesión anónima', () => {
    expect(isVisionUser({ uid: 'a', token: { firebase: { sign_in_provider: 'anonymous' } } })).toBe(false);
  });

  it('acepta usuarios con cuenta (email/contraseña o SSO de SMV Hub)', () => {
    expect(isVisionUser({ uid: 'u', token: { firebase: { sign_in_provider: 'password' } } })).toBe(true);
    expect(isVisionUser({ uid: 'u', token: { firebase: { sign_in_provider: 'custom' } } })).toBe(true);
  });

  it('rechaza un token sin proveedor declarado', () => {
    expect(isVisionUser({ uid: 'u', token: {} })).toBe(false);
  });
});
