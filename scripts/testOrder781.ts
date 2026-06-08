import 'dotenv/config';

async function run() {
  const odooUrl = process.env.ODOO_URL?.replace(/\/$/, '');
  const odooDB = process.env.ODOO_DB;
  const odooUser = process.env.ODOO_USER;
  const odooApiKey = process.env.ODOO_API_KEY;

  function xmlRpcValue(val: any): string {
    if (val === null || val === undefined) return '<value><boolean>0</boolean></value>';
    if (typeof val === 'boolean') return `<value><boolean>${val ? 1 : 0}</boolean></value>`;
    if (typeof val === 'number') return Number.isInteger(val) ? `<value><int>${val}</int></value>` : `<value><double>${val}</double></value>`;
    if (typeof val === 'string') {
      const escaped = val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<value><string>${escaped}</string></value>`;
    }
    if (Array.isArray(val)) {
      const items = val.map((v) => `<data>${xmlRpcValue(v)}</data>`).join('');
      return `<value><array>${items}</array></value>`;
    }
    return '';
  }

  function buildXmlRpcCall(method: string, params: any[]): string {
    const paramsXml = params.map((p) => `<param>${xmlRpcValue(p)}</param>`).join('');
    return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${paramsXml}</params></methodCall>`;
  }

  function parseXmlRpcValue(xml: string): any {
    const inner = xml.replace(/^\s*<value>\s*/, '').replace(/\s*<\/value>\s*$/, '');
    const intMatch = /^<(?:int|i4)>([^<]*)<\/(?:int|i4)>$/.exec(inner.trim());
    if (intMatch) return parseInt(intMatch[1], 10);
    const dblMatch = /^<double>([^<]*)<\/double>$/.exec(inner.trim());
    if (dblMatch) return parseFloat(dblMatch[1]);
    const boolMatch = /^<boolean>([^<]*)<\/boolean>$/.exec(inner.trim());
    if (boolMatch) return boolMatch[1].trim() === '1';
    const strMatch = /^<string>([\s\S]*)<\/string>$/.exec(inner.trim());
    if (strMatch) return strMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const arrayMatch = /^<array>\s*<data>([\s\S]*)<\/data>\s*<\/array>$/.exec(inner.trim());
    if (arrayMatch) return arrayMatch[1].split('</value>').filter(v => v.trim()).map(v => parseXmlRpcValue(v + '</value>'));
    
    // Quick struct parse for the fields we need
    if (inner.includes('<struct>')) {
       const struct: any = {};
       const memberRegex = /<member>\s*<name>([^<]+)<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/g;
       let match;
       while ((match = memberRegex.exec(inner)) !== null) {
           struct[match[1]] = parseXmlRpcValue(`<value>${match[2]}</value>`);
       }
       return struct;
    }
    return inner;
  }

  async function xmlRpcCall(endpoint: 'common' | 'object', method: string, params: any[]) {
    const body = buildXmlRpcCall(method, params);
    const res = await fetch(`${odooUrl}/xmlrpc/2/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body,
    });
    const text = await res.text();
    const vStart = text.indexOf('<value>');
    const vEnd = text.lastIndexOf('</value>') + 8;
    return parseXmlRpcValue(text.slice(vStart, vEnd));
  }

  const uid = await xmlRpcCall('common', 'authenticate', [odooDB, odooUser, odooApiKey, {}]);
  
  const searchParams = [
    odooDB, uid, odooApiKey,
    'sale.order', 'search_read',
    [[['name', 'in', ['2026/S00662', '2026/S00781']]]],
    { fields: ['name', 'order_line'] }
  ];
  
  const orders = await xmlRpcCall('object', 'execute_kw', searchParams);
  
  for (const order of orders) {
    console.log('Order:', order.name);
    console.log('Lines array:', order.order_line);
    
    const readParams = [
      odooDB, uid, odooApiKey,
      'sale.order.line', 'read',
      [order.order_line],
      { fields: ['product_id', 'product_uom_qty', 'qty_delivered', 'name', 'state'] }
    ];
    const lines = await xmlRpcCall('object', 'execute_kw', readParams);
    for (const l of lines) {
      console.log(`  - Qty: ${l.product_uom_qty}, Del: ${l.qty_delivered}`);
    }
  }
}
run().catch(console.error);
