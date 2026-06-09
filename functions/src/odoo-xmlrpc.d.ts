declare module "odoo-xmlrpc" {
  interface OdooConfig {
    url: string;
    port?: number;
    db: string;
    username: string;
    password: string;
  }

  /**
   * Cliente XML-RPC de Odoo. La firma de `execute_kw` es de 4 argumentos:
   * la librería antepone internamente [db, uid, password, model, method] y
   * luego hace spread de `params`. Para `search_read`, `params` debe ser
   * `[[domain], {fields, limit, order}]` (args posicionales + kwargs).
   */
  class Odoo {
    constructor(config: OdooConfig);
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
