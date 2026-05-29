/**
 * Logger ligero gated por `import.meta.env.DEV`.
 *
 * `log.debug` y `log.info` solo emiten en desarrollo — útil para los rastros
 * `[smv-vision][match] ...` que ayudan a depurar la heurística pero ensucian
 * la consola del operador en producción.
 *
 * `log.warn` y `log.error` siempre se emiten (los necesita Sentry / soporte).
 */

const isDev = import.meta.env.DEV;

export const log = {
  debug: (...args: unknown[]): void => {
    if (isDev) console.log(...args);
  },
  info: (...args: unknown[]): void => {
    if (isDev) console.info(...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
};
