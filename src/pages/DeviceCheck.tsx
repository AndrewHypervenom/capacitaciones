import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { useDeviceKind } from '@/hooks/useDeviceKind';

/* Diagnóstico de la restricción «solo desde el computador» (/device).

   Existe porque esto solo se puede comprobar DESDE el aparato, y en un celular
   no hay consola donde mirar. Abriendo esta dirección se ve el veredicto y las
   señales con las que se tomó, así que si algún modelo se cuela basta con leer
   esta pantalla en vez de adivinar. No muestra ningún dato del sitio ni de la
   persona: solo lo que el navegador publica de sí mismo. */

export default function DeviceCheck() {
  const kind = useDeviceKind();
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const m = (q: string) => {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };

  const rows: Array<[string, string]> = [
    ['Puntos táctiles (maxTouchPoints)', String(nav?.maxTouchPoints ?? 0)],
    ['Tiene ratón o panel táctil', m('(any-pointer: fine)') && m('(any-hover: hover)') ? 'sí' : 'no'],
    ['any-pointer: fine', String(m('(any-pointer: fine)'))],
    ['any-hover: hover', String(m('(any-hover: hover)'))],
    ['pointer: coarse', String(m('(pointer: coarse)'))],
    ['Pantalla (lado corto)', `${Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0)} px`],
    ['Ventana', `${window.innerWidth} × ${window.innerHeight} px`],
    ['Agente', nav?.userAgent ?? '—'],
  ];

  const Icon = kind === 'desktop' ? Monitor : kind === 'tablet' ? Tablet : Smartphone;

  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-subtle">
            Este aparato se ve como
          </p>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">
            {kind === 'desktop' ? 'Computador' : kind === 'tablet' ? 'Tableta' : 'Celular'}
          </h1>
          <p className="mt-0.5 text-[13px] text-text-muted">
            {kind === 'desktop'
              ? 'Puede abrir los cursos marcados «solo desde el computador».'
              : 'Los cursos marcados «solo desde el computador» le quedan cerrados.'}
          </p>
        </div>
      </div>

      <dl className="divide-y divide-line rounded-2xl border border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
            <dt className="shrink-0 text-[12px] text-text-muted sm:w-52">{k}</dt>
            <dd className="min-w-0 break-words text-[12.5px] text-text">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
