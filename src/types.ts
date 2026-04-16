export interface Order {
  pieza: string;
  cantidad: string;
  orden: string;
  fecha: string;
  prioridad: 'URGENTE' | 'Normal';
  descripcionVisual?: string;
  haSidoAuditada?: boolean;
  isometricView?: string;
  isometricBoundingBox?: [number, number, number, number];
  model3D?: {
    shape: 'box' | 'cylinder' | 'sphere' | 'torus';
    dimensions: number[];
    color: string;
    metalness: number;
    roughness: number;
  };
}
