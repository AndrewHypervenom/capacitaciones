import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Tamaño de diseño de la hoja: A4 apaisado a 96 dpi (297 × 210 mm).
 * TODO el interior de CertificateSheet está en píxeles fijos calibrados a este
 * ancho, así que la hoja se dibuja SIEMPRE a este tamaño y el marco la escala.
 */
export const CERT_DESIGN_W = 1123;
export const CERT_DESIGN_H = CERT_DESIGN_W / 1.414;

/**
 * Escala la hoja del certificado para que quepa completa en el ancho
 * disponible, sin deformarla.
 *
 * Sin esto, en móvil la hoja medía ~360 px de ancho pero su contenido (fijo en
 * px) seguía pidiendo ~1123, y el `overflow: hidden` del <article> recortaba
 * todo: se veía un fragmento ampliado del certificado. Con `transform: scale`
 * el layout interno nunca cambia —se ve idéntico en cualquier pantalla— y
 * `offsetWidth` sigue siendo el de diseño, así que el PDF no pierde calidad.
 */
export function CertificateFrame({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / CERT_DESIGN_W));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      data-cert-frame-outer=""
      style={{ width: '100%', height: CERT_DESIGN_H * scale, overflow: 'hidden' }}
    >
      <div
        data-cert-frame=""
        style={{
          width: CERT_DESIGN_W,
          height: CERT_DESIGN_H,
          transformOrigin: 'top left',
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Exporta la hoja a PDF a su tamaño de diseño (A4 apaisado), venga de donde
 * venga la vista. Antes de capturar quita la escala del marco: html2canvas no
 * lee bien un elemento con un ancestro transformado, y así el PDF sale igual
 * desde un teléfono que desde un escritorio. La escala se restaura siempre.
 */
export async function downloadCertificatePdf(el: HTMLElement, fileName: string) {
  const frame = el.closest<HTMLElement>('[data-cert-frame]');
  const outer = el.closest<HTMLElement>('[data-cert-frame-outer]');
  const prevTransform = frame?.style.transform ?? '';
  const prevHeight = outer?.style.height ?? '';
  const prevOverflow = outer?.style.overflow ?? '';

  if (frame) frame.style.transform = 'none';
  if (outer) {
    outer.style.height = `${CERT_DESIGN_H}px`;
    outer.style.overflow = 'visible';
  }

  try {
    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');

    const cssW = el.offsetWidth;
    const cssH = el.offsetHeight;

    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      scrollX: 0,
      scrollY: 0,
      width: cssW,
      height: cssH,
    });

    // 1 px CSS = 25.4/96 mm (96 dpi)
    const pxToMm = 25.4 / 96;
    const pdfW = cssW * pxToMm;
    const pdfH = cssH * pxToMm;

    const pdf = new jsPDF({
      orientation: pdfW > pdfH ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [pdfW, pdfH],
    });

    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfW, pdfH);
    pdf.save(fileName);
  } finally {
    if (frame) frame.style.transform = prevTransform;
    if (outer) {
      outer.style.height = prevHeight;
      outer.style.overflow = prevOverflow;
    }
  }
}
