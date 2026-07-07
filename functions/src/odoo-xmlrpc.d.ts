/**
 * Tipos mínimos para odoo-xmlrpc (la librería no publica tipos).
 * El constructor devuelve un cliente con connect/execute_kw por callbacks;
 * la forma exacta que consumimos se tipa en index.ts (interface OdooClient).
 */
declare module "odoo-xmlrpc" {
  interface OdooConnectionParams {
    url: string;
    port?: number;
    db: string;
    username: string;
    password: string;
  }

  class Odoo {
    constructor(params: OdooConnectionParams);
    connect(callback: (err: unknown) => void): void;
    execute_kw(
      model: string,
      method: string,
      params: unknown[],
      callback: (err: unknown, value: unknown) => void,
    ): void;
  }

  export = Odoo;
}
