import { useRef } from 'react';
import type { TFunction } from 'i18next';
import { motion, useScroll, useSpring } from 'framer-motion';
import { Check, Clock, ListChecks, Target } from 'lucide-react';
import type { PublicCertificateModule } from '@/types/database';
import { EntityIcon } from '@/components/ui/EntityIcon';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { pickLang, pickLangList } from '@/lib/contentLang';

/* ────────────────────────────────────────────────────────────────────────
   Las secciones del pénsum del certificado: qué sabe hacer la persona y el
   recorrido módulo a módulo.

   Viven aparte porque las pintan DOS sitios con datos distintos:
    · la página pública /verify/:certId (datos reales del certificado emitido), y
    · la vista previa del editor de curso (el borrador que el capacitador está
      escribiendo, aún sin guardar).
   Compartir el componente es lo único que garantiza que la vista previa no
   mienta: si se ve bien acá, se ve así al compartirlo.
   ──────────────────────────────────────────────────────────────────────── */

/** Curva corporativa (la misma `ease-apple` del kit de animación). */
export const EASE = [0.16, 1, 0.3, 1] as const;

// Se conservan los nombres (los usan medio sitio) pero por dentro caen a
// CUALQUIER idioma con contenido, no solo al español: ver `lib/contentLang`.
export function pickText(
  es: string, en: string | null, pt: string | null, lang: string,
): string {
  return pickLang(es, en, pt, lang);
}

/** Igual que `pickText` pero para las listas del pénsum (objetivos, temas…). */
export function pickList(
  es: string[] | null, en: string[] | null, pt: string[] | null, lang: string,
): string[] {
  return pickLangList(es, en, pt, lang).filter((s) => !!s?.trim());
}

/** Minutos → texto de intensidad horaria (mismo criterio que el diploma). */
export function formatDuration(min: number, t: TFunction): string {
  if (min < 60) return t('certificate.duration_minutes', { count: min });
  const hours = Math.round((min / 60) * 10) / 10;
  const count = Number.isInteger(hours) ? hours : Number(hours.toFixed(1));
  return t('certificate.duration_hours', { count });
}

/**
 * "Ahora sabe hacer esto" = las conclusiones clave de todos los módulos.
 * Se deduplica sin distinguir mayúsculas ni espacios: dos módulos que cierran
 * con la misma idea no deben repetirla en la vitrina.
 */
export function buildSkillList(modules: PublicCertificateModule[], lang: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of modules) {
    for (const s of pickList(m.takeaways_es, m.takeaways_en, m.takeaways_pt, lang)) {
      const key = s.trim().toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); out.push(s.trim()); }
    }
  }
  return out;
}

/** Encabezado de sección: sobretítulo, título y bajada. */
export function SectionHead({
  eyebrow, title, hint,
}: { eyebrow: string; title: string; hint?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, ease: EASE }}
      className="mb-9 text-center"
    >
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-green">
        {eyebrow}
      </div>
      <h2 className="text-[clamp(1.6rem,3.4vw,2.25rem)] font-semibold tracking-[-0.03em]">
        {title}
      </h2>
      {hint && (
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-text-muted text-balance">
          {hint}
        </p>
      )}
    </motion.div>
  );
}

/** Rejilla de competencias: lo que la persona sabe hacer al terminar. */
export function SkillGrid({ items }: { items: string[] }) {
  const reduce = useReducedMotion();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((s, i) => (
        <motion.div
          key={`${s}-${i}`}
          initial={{ opacity: 0, y: 16, filter: 'blur(5px)' }}
          whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.55, ease: EASE, delay: Math.min(i, 8) * 0.05 }}
          whileHover={reduce ? undefined : { y: -3 }}
          className="surface-card flex items-start gap-3 px-5 py-4 transition-colors duration-300 ease-apple hover:border-brand-green/30"
        >
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-green/12 text-brand-green">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          <span className="text-[14.5px] leading-relaxed text-text">{s}</span>
        </motion.div>
      ))}
    </div>
  );
}

/** Una parada del pénsum: el módulo con lo que se aprendió y los temas vistos. */
function PensumStop({
  module: m, index, lang, t,
}: { module: PublicCertificateModule; index: number; lang: string; t: TFunction }) {
  const reduce = useReducedMotion();
  const title = pickText(m.title_es, m.title_en, m.title_pt, lang);
  const subtitle = pickText(m.subtitle_es ?? '', m.subtitle_en, m.subtitle_pt, lang);
  const objectives = pickList(m.objectives_es, m.objectives_en, m.objectives_pt, lang);
  const topics = pickList(m.topics_es, m.topics_en, m.topics_pt, lang);

  return (
    <motion.li
      initial={{ opacity: 0, x: -14, filter: 'blur(5px)' }}
      whileInView={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, ease: EASE, delay: Math.min(index, 6) * 0.05 }}
      className="relative flex gap-4"
    >
      {/* Nodo: ícono del módulo sobre la línea de tiempo */}
      <div className="relative z-10 shrink-0">
        <motion.div
          whileHover={reduce ? undefined : { scale: 1.06 }}
          transition={{ type: 'spring', stiffness: 320, damping: 20 }}
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface text-brand-green shadow-sm"
        >
          <EntityIcon value={m.icon} size={22} />
        </motion.div>
        <span
          aria-hidden
          className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-green text-white ring-2 ring-bg"
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      </div>

      <motion.div
        whileHover={reduce ? undefined : { y: -3 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        className="surface-card min-w-0 flex-1 px-5 py-5 transition-colors duration-300 ease-apple hover:border-brand-green/30"
      >
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-subtle">
            {t('public_certificate.pensum_module', { n: index + 1 })}
          </span>
          {m.duration_min > 0 && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-text-subtle">
              <Clock className="h-3 w-3" />
              {formatDuration(m.duration_min, t)}
            </span>
          )}
        </div>

        <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-text">{title}</h3>
        {subtitle && (
          <p className="mt-1 text-[13.5px] leading-relaxed text-text-muted">{subtitle}</p>
        )}

        {/* Qué aprendió en ESTE módulo */}
        {objectives.length > 0 && (
          <div className="mt-4 rounded-2xl border border-line/70 bg-subtle/40 px-4 py-3.5">
            <div className="mb-2.5 inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-subtle">
              <Target className="h-3.5 w-3.5" />
              {t('public_certificate.learned_here')}
            </div>
            <ul className="space-y-2">
              {objectives.map((o, i) => (
                <li key={`${o}-${i}`} className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green"
                  />
                  <span className="text-[13.5px] leading-relaxed text-text">{o}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Temas cubiertos (los títulos de las secciones del módulo) */}
        {topics.length > 0 && (
          <div className="mt-4">
            <div className="mb-2.5 inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-subtle">
              <ListChecks className="h-3.5 w-3.5" />
              {t('public_certificate.topics_covered')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {topics.map((tp, i) => (
                <motion.span
                  key={`${tp}-${i}`}
                  initial={{ opacity: 0, scale: 0.92 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: '-30px' }}
                  transition={{ duration: 0.4, ease: EASE, delay: Math.min(i, 10) * 0.03 }}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-text-muted"
                >
                  {tp}
                </motion.span>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </motion.li>
  );
}

/**
 * Pénsum: los módulos que componen la certificación, en línea de tiempo. La
 * línea de la izquierda se dibuja con el scroll: el recorrido se ve avanzar
 * mientras se lee.
 *
 * `scrollRoot` es el contenedor que scrollea cuando NO es la ventana (la vista
 * previa del editor vive dentro de un modal con scroll propio); sin él la línea
 * no se dibujaría nunca ahí dentro.
 */
export function PensumTimeline({
  modules, lang, t, scrollRoot,
}: {
  modules: PublicCertificateModule[];
  lang: string;
  t: TFunction;
  scrollRoot?: React.RefObject<HTMLElement | null>;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    container: scrollRoot,
    offset: ['start 0.85', 'end 0.55'],
  });
  const line = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.5 });

  return (
    <div ref={ref} className="relative">
      {/* Riel de la línea de tiempo (oculto en móvil: ahí manda el texto). */}
      <div
        aria-hidden
        className="absolute bottom-2 left-[27px] top-2 hidden w-px bg-line sm:block"
      >
        <motion.div
          className="h-full w-full origin-top rounded-full"
          style={{
            scaleY: reduce ? 1 : line,
            background: 'linear-gradient(to bottom, rgb(var(--brand-green)), rgb(var(--brand-magenta)))',
          }}
        />
      </div>

      <ol className="space-y-4">
        {modules.map((m, i) => (
          <PensumStop key={m.id} module={m} index={i} lang={lang} t={t} />
        ))}
      </ol>
    </div>
  );
}
