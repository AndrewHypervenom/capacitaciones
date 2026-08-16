// src/lib/exportXlsx.ts
/**
 * Exportación a Excel de los tableros del panel.
 *
 * Un solo camino para todas las descargas: hojas con encabezado, anchos de
 * columna calculados y nombre de archivo fechado. Lo que se ve en pantalla es lo
 * que baja al Excel — mismo filtro, mismo orden, mismas columnas.
 *
 * `xlsx` pesa ~400 KB: se carga con import dinámico, así que solo lo descarga
 * quien de verdad exporta (ver [[performance_no_overfetch]]).
 */

/** Una fila es un objeto plano; las claves de la primera fila mandan el orden. */
export type SheetRow = Record<string, string | number | boolean | null | undefined>;

export interface Sheet {
  /** Nombre de la pestaña dentro del libro (Excel corta en 31 caracteres). */
  name: string;
  rows: SheetRow[];
  /** Encabezados en el orden deseado. Si falta, se toman de la primera fila. */
  headers?: string[];
}

/** Ancho de columna razonable: el contenido más largo, entre 10 y 60. */
function columnWidths(headers: string[], rows: SheetRow[]): { wch: number }[] {
  return headers.map((h) => {
    let max = h.length;
    for (const row of rows) {
      const v = row[h];
      const len = v == null ? 0 : String(v).length;
      if (len > max) max = len;
    }
    return { wch: Math.min(60, Math.max(10, max + 2)) };
  });
}

/** `informe-personas` → `informe-personas-2026-08-14.xlsx` */
export function stampedName(base: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
}

/**
 * Descarga un libro con una o varias hojas. Devuelve cuántas filas se
 * escribieron, para poder decirlo en el aviso de éxito.
 */
export async function downloadWorkbook(baseName: string, sheets: Sheet[]): Promise<number> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  let total = 0;

  for (const sheet of sheets) {
    const headers = sheet.headers ?? Object.keys(sheet.rows[0] ?? {});
    // Hoja vacía: se escribe igual, solo con encabezados. Un libro al que le
    // falta una pestaña se lee como un error de la exportación; una pestaña
    // vacía se lee como "no hubo datos", que es la verdad.
    const ws = XLSX.utils.json_to_sheet(sheet.rows, { header: headers });
    ws['!cols'] = columnWidths(headers, sheet.rows);
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(1, sheet.rows.length), c: Math.max(0, headers.length - 1) },
    }) };
    // Excel rechaza nombres de pestaña con : \ / ? * [ ] o de más de 31 chars.
    const safe = sheet.name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safe);
    total += sheet.rows.length;
  }

  XLSX.writeFile(wb, stampedName(baseName));
  return total;
}

/** Fecha corta y local para las celdas (vacío si no hay). */
export function xlsDate(iso: string | null | undefined, locale = 'es'): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale);
}

/** Milisegundos → horas con un decimal (para sumar en Excel sin pelear formatos). */
export function xlsHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}
