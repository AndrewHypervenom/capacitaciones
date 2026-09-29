// src/lib/exportXlsx.ts
/**
 * Exportación a Excel de los tableros del panel.
 *
 * Un solo camino para todas las descargas: cada hoja sale con la marca de la
 * casa (banda verde con el título, encabezados magenta, filas alternas en gris
 * claro) y los datos van dentro de una TABLA de Excel de verdad: filtros y orden
 * en cada columna, se estira sola al agregar filas y sirve directo como origen
 * de una tabla dinámica (Insertar → Tabla dinámica). Lo que se ve en pantalla
 * es lo que baja al Excel — mismo filtro, mismo orden, mismas columnas.
 *
 * `exceljs` pesa: se carga con import dinámico, así que solo lo descarga quien
 * de verdad exporta (ver [[performance_no_overfetch]]).
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

/** Colores corporativos (ARGB, como los pide Excel). */
const BRAND = {
  green: 'FF10D451',
  magenta: 'FFB33D9E',
  lightGray: 'FFE0EBE7',
  midGray: 'FFA1ADAD',
  white: 'FFFFFFFF',
  ink: 'FF1F2929',
};

/* Palabras que se pintan solas: el sí en verde y el no en magenta, en los tres
   idiomas del sitio. Sin esto, "Aprobó: No" se pierde entre cien filas. */
const GOOD = new Set(['sí', 'si', 'yes', 'sim', 'correcta', 'correct', 'correta', 'aprobado', 'approved', 'aprovado', 'hecho', 'done', 'feito']);
const BAD = new Set(['no', 'não', 'incorrecta', 'incorrect', 'incorreta', 'no aprobado', 'not passed', 'não aprovado', 'pendiente', 'pending', 'pendente', 'sin responder', 'unanswered', 'sem resposta', 'pregunta eliminada', 'deleted question', 'pergunta excluída']);

/** Ancho de columna razonable: el contenido más largo, entre 10 y 60. El
    encabezado lleva además el botón del filtro, que tapa las últimas letras. */
function columnWidth(header: string, rows: SheetRow[]): number {
  let max = header.length + 4;
  for (const row of rows) {
    const v = row[header];
    const len = v == null ? 0 : String(v).length;
    if (len > max) max = len;
  }
  return Math.min(60, Math.max(10, max + 3));
}

/** `informe-personas` → `informe-personas-2026-08-14.xlsx` */
export function stampedName(base: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
}

/** "A", "B", … "AA": letra de columna para las referencias. */
function colLetter(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export interface WorkbookOptions {
  /** Línea bajo el título de cada hoja (p. ej. el curso). */
  subtitle?: string;
}

/**
 * Descarga un libro con una o varias hojas. Devuelve cuántas filas se
 * escribieron, para poder decirlo en el aviso de éxito.
 */
export async function downloadWorkbook(
  baseName: string,
  sheets: Sheet[],
  opts: WorkbookOptions = {},
): Promise<number> {
  const { buffer, total } = await buildWorkbook(sheets, opts);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = stampedName(baseName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return total;
}

/** Arma el libro con la marca de la casa. Separado de la descarga para poder
    generarlo fuera del navegador (pruebas, scripts). */
export async function buildWorkbook(
  sheets: Sheet[],
  opts: WorkbookOptions = {},
): Promise<{ buffer: ArrayBuffer; total: number }> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LearningAI';
  wb.created = new Date();
  let total = 0;
  const usedNames = new Set<string>();
  const generated = new Date().toLocaleString();

  sheets.forEach((sheet, sheetIdx) => {
    const headers = sheet.headers ?? Object.keys(sheet.rows[0] ?? {});
    // Excel rechaza nombres de pestaña con : \ / ? * [ ] o de más de 31 chars,
    // y repetidos.
    let safe = sheet.name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || `Hoja ${sheetIdx + 1}`;
    while (usedNames.has(safe.toLowerCase())) safe = `${safe.slice(0, 28)} ${sheetIdx + 1}`;
    usedNames.add(safe.toLowerCase());

    const ws = wb.addWorksheet(safe, {
      properties: { tabColor: { argb: sheetIdx === 0 ? BRAND.green : BRAND.magenta } },
      views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    });
    const width = Math.max(1, headers.length);
    const last = colLetter(width);
    ws.columns = headers.map((h) => ({ width: columnWidth(h, sheet.rows) }));

    // Fila 1: banda verde con el título de la hoja.
    ws.mergeCells(`A1:${last}1`);
    const title = ws.getCell('A1');
    title.value = `LearningAI  ·  ${sheet.name}`;
    title.font = { name: 'Calibri', size: 16, bold: true, color: { argb: BRAND.white } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.green } };
    title.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 32;

    // Fila 2: de qué es y cuándo se sacó.
    ws.mergeCells(`A2:${last}2`);
    const sub = ws.getCell('A2');
    sub.value = [opts.subtitle, `${sheet.rows.length} filas`, `Generado: ${generated}`]
      .filter(Boolean)
      .join('   ·   ');
    sub.font = { name: 'Calibri', size: 10, italic: true, color: { argb: BRAND.ink } };
    sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.lightGray } };
    sub.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(2).height = 20;
    ws.getRow(3).height = 8;

    const HEADER_ROW = 4;
    if (headers.length === 0) {
      ws.getCell(`A${HEADER_ROW}`).value = 'Sin datos';
      return;
    }

    // Los datos, dentro de una tabla de Excel: filtros, orden y origen directo
    // para tablas dinámicas. Una tabla sin filas no es válida en Excel: si la
    // hoja viene vacía se deja una fila en blanco, que se lee como "no hubo datos".
    const body = sheet.rows.length
      ? sheet.rows.map((r) => headers.map((h) => {
          const v = r[h];
          return v === undefined || v === null ? '' : v;
        }))
      : [headers.map(() => '')];
    ws.addTable({
      name: `T${sheetIdx + 1}_${safe.replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'Datos'}`,
      ref: `A${HEADER_ROW}`,
      headerRow: true,
      style: { theme: 'TableStyleLight1', showRowStripes: false },
      columns: headers.map((h) => ({ name: h, filterButton: true })),
      rows: body,
    });

    // Encabezado magenta.
    const head = ws.getRow(HEADER_ROW);
    head.height = 28;
    headers.forEach((_, i) => {
      const c = head.getCell(i + 1);
      c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND.white } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.magenta } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = { bottom: { style: 'medium', color: { argb: BRAND.green } } };
    });

    // Cuerpo: filas alternas, bordes suaves, números centrados y el sí/no pintado.
    body.forEach((values, r) => {
      const row = ws.getRow(HEADER_ROW + 1 + r);
      const striped = r % 2 === 1;
      values.forEach((v, i) => {
        const c = row.getCell(i + 1);
        const text = typeof v === 'string' ? v.trim().toLowerCase() : '';
        const good = GOOD.has(text);
        const bad = BAD.has(text);
        c.font = {
          name: 'Calibri',
          size: 10.5,
          bold: good || bad,
          color: { argb: good ? 'FF0A9E3A' : bad ? BRAND.magenta : BRAND.ink },
        };
        if (striped) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.lightGray } };
        c.border = { bottom: { style: 'thin', color: { argb: BRAND.midGray } } };
        c.alignment = {
          vertical: 'top',
          horizontal: typeof v === 'number' || good || bad ? 'center' : 'left',
          wrapText: typeof v === 'string' && v.length > 60,
        };
      });
    });

    // Barras de datos verdes en las columnas de porcentaje: la nota se lee de
    // un vistazo sin tener que ordenar.
    if (sheet.rows.length > 0) {
      headers.forEach((h, i) => {
        const numeric = sheet.rows.some((r) => typeof r[h] === 'number');
        if (!numeric || !/%/.test(h)) return;
        const col = colLetter(i + 1);
        ws.addConditionalFormatting({
          ref: `${col}${HEADER_ROW + 1}:${col}${HEADER_ROW + sheet.rows.length}`,
          rules: [{
            type: 'dataBar',
            priority: 1,
            gradient: true,
            cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 100 }],
            color: { argb: BRAND.green },
          } as never],
        });
      });
    }

    total += sheet.rows.length;
  });

  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return { buffer, total };
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
