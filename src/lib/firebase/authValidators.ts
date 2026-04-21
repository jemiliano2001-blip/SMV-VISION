/**
 * Validación de frontera para credenciales de inicio de sesión (email/contraseña).
 */

export interface SignInCredentials {
  email: string;
  password: string;
}

export type AuthValidationIssue = { path: string; message: string };

export type AuthValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: AuthValidationIssue[] };

const EMAIL_MAX_LEN = 254;
/** Firebase Auth exige al menos 6 caracteres para contraseñas. */
const PASSWORD_MIN_LEN = 6;
const PASSWORD_MAX_LEN = 4096;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Comprobación conservadora de formato de correo (evita regex excesivamente complejo).
 */
function isPlausibleEmail(localPart: string, domain: string): boolean {
  if (localPart.length === 0 || localPart.length > 64) {
    return false;
  }
  if (domain.length === 0 || !domain.includes('.')) {
    return false;
  }
  const labels = domain.split('.');
  return labels.every((label) => label.length > 0 && label.length <= 63);
}

export function validateSignInCredentials(raw: {
  email: unknown;
  password: unknown;
}): AuthValidationResult<SignInCredentials> {
  const issues: AuthValidationIssue[] = [];

  if (!isNonEmptyString(raw.email)) {
    issues.push({ path: 'email', message: 'Indica un correo electrónico.' });
  } else {
    const trimmed = raw.email.trim();
    if (trimmed.length > EMAIL_MAX_LEN) {
      issues.push({ path: 'email', message: 'El correo es demasiado largo.' });
    } else {
      const at = trimmed.indexOf('@');
      if (at <= 0 || at !== trimmed.lastIndexOf('@')) {
        issues.push({ path: 'email', message: 'El formato del correo no es válido.' });
      } else {
        const local = trimmed.slice(0, at);
        const domain = trimmed.slice(at + 1).toLowerCase();
        if (!isPlausibleEmail(local, domain)) {
          issues.push({ path: 'email', message: 'El formato del correo no es válido.' });
        }
      }
    }
  }

  if (!isNonEmptyString(raw.password)) {
    issues.push({ path: 'password', message: 'Indica tu contraseña.' });
  } else if (raw.password.length < PASSWORD_MIN_LEN) {
    issues.push({
      path: 'password',
      message: `La contraseña debe tener al menos ${PASSWORD_MIN_LEN} caracteres.`,
    });
  } else if (raw.password.length > PASSWORD_MAX_LEN) {
    issues.push({ path: 'password', message: 'La contraseña es demasiado larga.' });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const emailTrimmed = (raw.email as string).trim().toLowerCase();
  return {
    ok: true,
    value: {
      email: emailTrimmed,
      password: raw.password as string,
    },
  };
}
