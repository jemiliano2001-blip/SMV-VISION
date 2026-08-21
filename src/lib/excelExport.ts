/**
 * src/lib/excelExport.ts
 *
 * Exportador de órdenes y resultados de auditoría a CSV compatible con Excel.
 * Incluye BOM UTF-8 (\uFEFF) para garantizar que los caracteres en español,
 * acentos y símbolos se abran perfectamente en Microsoft Excel en Windows y Mac.
 */

import type { Order } from '../types';
import { getOrderAgeDays } from './age';

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const str = String(value).replace(/[\r\n]+/g, ' ').trim();
  if (str.includes('"') || str.includes(',') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function generateOrdersCsv(orders: Order[]): string {
  const headers = [
    'SO (Orden)',
    'PO (Cliente)',
    'Fecha',
    'Antigüedad (Días)',
    'Pieza / Descripción',
    'Número de Parte',
    'Cantidad',
    'Prioridad',
    'Material',
    'Dureza',
    'Tratamiento Térmico',
    'Acabado',
    'Plano Asociado',
    'Tipo de Vista 3D',
    'Score Match (%)',
  ];

  const rows = orders.map((o) => {
    const ageDays = o.fecha ? getOrderAgeDays(o.fecha.split('\n')[0]) : null;
    return [
      escapeCsvCell(o.orden),
      escapeCsvCell(o.poNumber || ''),
      escapeCsvCell(o.fecha),
      escapeCsvCell(ageDays !== null ? String(ageDays) : '—'),
      escapeCsvCell(o.pieza),
      escapeCsvCell(o.numero_parte || ''),
      escapeCsvCell(o.cantidad),
      escapeCsvCell(o.prioridad),
      escapeCsvCell(o.material || 'N/D'),
      escapeCsvCell(o.dureza || 'N/D'),
      escapeCsvCell(o.tratamiento || 'N/D'),
      escapeCsvCell(o.acabado || 'N/D'),
      escapeCsvCell(o.sourcePdfName || 'Sin plano'),
      escapeCsvCell(o.isometricSource === 'ai-generated' ? 'IA Generado' : o.isometricView ? 'Recorte CAD/ISO' : 'Sin vista'),
      escapeCsvCell(typeof o.matchScore === 'number' ? `${o.matchScore}%` : '—'),
    ].join(',');
  });

  // UTF-8 BOM
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}

export function downloadOrdersCsv(orders: Order[], filename?: string): void {
  const csvContent = generateOrdersCsv(orders);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const now = new Date().toISOString().slice(0, 10);
  const name = filename || `reporte-suprajit-vision-${now}.csv`;

  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
