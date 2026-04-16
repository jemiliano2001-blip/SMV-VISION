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

export type Model3DShape = 'box' | 'cylinder' | 'sphere' | 'torus';

export interface Model3DSpec {
  shape: Model3DShape;
  dimensions: number[];
  color: string;
  metalness: number;
  roughness: number;
}

export interface OrderExtraction {
  pieza: string;
  cantidad: string;
  orden: string;
  fecha: string;
  prioridad: 'URGENTE' | 'Normal';
}

export interface BlueprintSpec {
  pieza_detectada: string;
  descripcionVisual: string;
  isometricBoundingBox: [number, number, number, number];
  model3D: Model3DSpec;
}
