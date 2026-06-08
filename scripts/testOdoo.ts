import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: resolvePath(process.cwd(), '.env.local') });

async function run() {
  const odooUrl = process.env.ODOO_URL?.replace(/\/$/, '');
  const odooDB = process.env.ODOO_DB;
  const odooUser = process.env.ODOO_USER;
  const odooApiKey = process.env.ODOO_API_KEY;

  if (!odooUrl || !odooDB || !odooUser || !odooApiKey) {
    console.error("Missing env vars");
    return;
  }

  // XML-RPC helpers
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
    const members = Object.entries(val).map(([k, v]) => `<member><name>${k}</name>${xmlRpcValue(v)}</member>`).join('');
    return `<value><struct>${members}</struct></value>`;
  }

  function buildXmlRpcCall(method: string, params: any[]): string {
    const paramsXml = params.map((p) => `<param>${xmlRpcValue(p)}</param>`).join('');
    return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${paramsXml}</params></methodCall>`;
  }

  function parseXmlRpcResponse(xml: string): any {
    if (xml.includes('<fault>')) throw new Error('Fault');
    const vStart = xml.indexOf('<value>');
    const vEnd = xml.lastIndexOf('</value>') + 8;
    return parseXmlRpcValue(xml.slice(vStart, vEnd));
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
    const structMatch = /^<struct>([\s\S]*)<\/struct>$/.exec(inner.trim());
    if (structMatch) {
      // simplified parser
      return "struct"; 
    }
    if (!inner.trim().startsWith('<')) return inner.trim();
    return null;
  }

  async function xmlRpcCall(endpoint: 'common' | 'object', method: string, params: any[]) {
    const body = buildXmlRpcCall(method, params);
    const res = await fetch(`${odooUrl}/xmlrpc/2/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body,
    });
    return parseXmlRpcResponse(await res.text());
  }

  // 1. Auth
  const uid = await xmlRpcCall('common', 'authenticate', [odooDB, odooUser, odooApiKey, {}]);
  console.log("UID:", uid);

  // We will just use execute_kw to search_read with a more robust parser for the result if needed. 
  // Wait, let's just copy the exact parser from syncOdoo.ts since it handles structs properly.
}
run();
