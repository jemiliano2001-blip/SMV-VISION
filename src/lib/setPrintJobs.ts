import type { PlanoOtStamp } from './planoOt';
import { quantityForMember } from './toolcribSets';

export interface SetPrintPiece {
  pdfDataUrl: string;
  partNumber: string;
  revision?: string;
  description?: string;
  customer?: string;
  /** Rol dentro del juego ("Mitad Grande"); vacío para la pieza base. */
  companionLabel?: string;
  cantidadPorJuego: number;
  /** Textos de notas permanentes ya filtrados (solo las que van a la OT). */
  permanentNotes: string[];
}

export interface SetPrintJob {
  piece: SetPrintPiece;
  stamp: PlanoOtStamp;
}

function joinNotes(parts: readonly string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(' · ');
}

/**
 * Una OT completa por pieza del juego (sello y ficha completos).
 * Comparten SO/PO/fecha; la cantidad es `juegos × cantidadPorJuego`.
 * La máscara de cantidad solo aplica a la primera pieza (la que se previsualizó).
 */
export function buildSeparatePrintJobs(
  pieces: SetPrintPiece[],
  baseStamp: PlanoOtStamp,
  juegos: number,
  corrida: string,
): SetPrintJob[] {
  return pieces.map((piece, index) => {
    const description = piece.description || baseStamp.piezaDescripcion || '';
    return {
      piece,
      stamp: {
        ...baseStamp,
        partNumber: piece.partNumber,
        customer: piece.customer || baseStamp.customer,
        piezaDescripcion: piece.companionLabel ? `${description} · ${piece.companionLabel}`.trim() : description,
        cantidad: String(quantityForMember(juegos, piece.cantidadPorJuego)),
        notas: joinNotes([...piece.permanentNotes, corrida]),
        quantityMask: index === 0 ? baseStamp.quantityMask : null,
      },
    };
  });
}
