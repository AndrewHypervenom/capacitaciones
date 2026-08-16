// src/admin/pages/progress/CourseProgressDrawer.tsx
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, Layers, Users, Award, ChevronRight, Search, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fold } from '@/lib/normalize';
import { backdropDismiss } from '@/lib/backdropDismiss';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { formatElapsed } from '@/hooks/useModuleTimer';
import { supabase } from '@/lib/supabase';
import { PersonAvatar, RankBar, StatusPill, EmptyState, GREEN, MAGENTA, VIOLET, CYAN } from './OverviewChrome';
import { scoreHex } from './ModulesChrome';
import type { ProgramCourse, ProgramModule, ProgramPerson, ProgramCell } from './useProgramData';

/* ────────────────────────────────────────────────────────────────────────────
   Progreso de UN curso: sus módulos y su gente, sin salir del tablero.

   Es la vista que faltaba. Para saber "cómo va este curso, módulo por módulo, y
   quién se quedó dónde" había que bajar por campaña → curso → módulo → aprendiz
   en la Bandeja, que está pensada para calificar entregas, no para leer avance.
   Aquí se abre con un clic sobre el curso y responde las dos preguntas de
   frente: qué módulo se está atascando y quién necesita un empujón.
   ──────────────────────────────────────────────────────────────────────────── */

interface Props {
  course: ProgramCourse;
  modules: ProgramModule[];
  /** Personas del alcance actual (ya filtradas por campaña, cargo, país…). */
  people: ProgramPerson[];
  /** Celdas persona × curso del alcance. */
  cells: ProgramCell[];
  /** Módulos completados, indexado por `${userId}|${courseId}`. */
  doneModules: Record<string, string[]>;
  onPerson: (p: ProgramPerson) => void;
  onClose: () => void;
}

export function CourseProgressDrawer({
  course, modules, people, cells, doneModules, onPerson, onClose,
}: Props) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'modules' | 'people'>('modules');
  /** Tiempo activo por módulo de este curso (se pide solo al abrirlo). */
  const [timeByModule, setTimeByModule] = useState<Record<string, { ms: number; n: number }>>({});

  // Quién tiene este curso: es la lista contra la que se miden los módulos.
  const enrolled = useMemo(() => {
    const byUser = new Map(cells.filter((c) => c.courseId === course.id).map((c) => [c.userId, c]));
    return people
      .filter((p) => byUser.has(p.id))
      .map((p) => {
        const cell = byUser.get(p.id)!;
        const done = doneModules[`${p.id}|${course.id}`] ?? [];
        return {
          person: p,
          cell,
          done: new Set(done),
          pct: modules.length > 0 ? Math.round((done.length / modules.length) * 100) : 0,
        };
      })
      .sort((a, b) => b.pct - a.pct || a.person.name.localeCompare(b.person.name));
  }, [people, cells, course.id, doneModules, modules.length]);

  // Cuántos completaron cada módulo: el atasco se ve en la caída entre uno y otro.
  const perModule = useMemo(() => {
    return modules.map((m) => {
      const done = enrolled.filter((e) => e.done.has(m.id)).length;
      const time = timeByModule[m.id];
      return {
        module: m,
        done,
        pct: enrolled.length > 0 ? Math.round((done / enrolled.length) * 100) : 0,
        avgMs: time && time.n > 0 ? time.ms / time.n : null,
      };
    });
  }, [modules, enrolled, timeByModule]);

  /* Tiempo activo medio por módulo. Una sola consulta acotada a los módulos de
     ESTE curso: el tablero general no lo trae porque pesa. */
  useEffect(() => {
    if (modules.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('module_time')
        .select('module_id, elapsed_ms')
        .in('module_id', modules.map((m) => m.id));
      if (cancelled || error || !data) return;
      const acc: Record<string, { ms: number; n: number }> = {};
      for (const row of data as Array<{ module_id: string; elapsed_ms: number }>) {
        const ms = Number(row.elapsed_ms) || 0;
        if (ms <= 0) continue;
        const cur = acc[row.module_id] ?? { ms: 0, n: 0 };
        cur.ms += ms; cur.n++;
        acc[row.module_id] = cur;
      }
      setTimeByModule(acc);
    })();
    return () => { cancelled = true; };
  }, [modules]);

  const visiblePeople = useMemo(() => {
    const q = fold(query);
    if (!q) return enrolled;
    return enrolled.filter((e) =>
      fold(e.person.name).includes(q) || fold(e.person.email ?? '').includes(q));
  }, [enrolled, query]);

  const started = enrolled.filter((e) => e.cell.started).length;
  const certified = enrolled.filter((e) => e.cell.certifiedAt).length;
  const finished = enrolled.filter((e) => modules.length > 0 && e.done.size >= modules.length).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="backdrop"
        /* Por encima del rincón flotante (CornerDock vive en z-[9990]): un panel
           modal con botones ajenos flotando encima se ve roto. */
        className="fixed inset-0 z-[9995] bg-black/45 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        {...backdropDismiss(onClose)}
      >
        <motion.aside
          className="absolute right-0 top-0 flex h-full w-full max-w-[720px] flex-col border-l border-line bg-bg shadow-2xl"
          initial={reduce ? false : { x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Encabezado */}
          <header className="shrink-0 border-b border-line px-6 py-5">
            <div className="flex items-start gap-3">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white"
                style={{ background: `linear-gradient(135deg, ${MAGENTA}, color-mix(in srgb, ${MAGENTA} 65%, #000))` }}
              >
                <Layers className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-bold leading-tight tracking-tight text-text">{course.title}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
                  {course.campaignName && <span>{course.campaignName}</span>}
                  <span>· {t('admin.progress_overview.course_modules', { count: modules.length, defaultValue: '{{count}} módulos' })}</span>
                  {course.mandatory && <StatusPill tone="amber">{t('admin.progress_overview.mandatory', 'Obligatorio')}</StatusPill>}
                  {!course.published && <StatusPill tone="neutral">{t('admin.progress_overview.draft', 'Borrador')}</StatusPill>}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-text-muted transition-colors hover:bg-subtle hover:text-text"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Metric icon={<Users className="h-3.5 w-3.5" />} accent={GREEN}
                label={t('admin.progress_overview.col_assigned', 'Asignados')} value={enrolled.length} />
              <Metric icon={<CheckCircle2 className="h-3.5 w-3.5" />} accent={CYAN}
                label={t('admin.progress_overview.col_started', 'Iniciados')} value={started} />
              <Metric icon={<Layers className="h-3.5 w-3.5" />} accent={MAGENTA}
                label={t('admin.progress_overview.col_completed', 'Completados')} value={finished} />
              <Metric icon={<Award className="h-3.5 w-3.5" />} accent={VIOLET}
                label={t('admin.progress_overview.col_certified', 'Certificados')} value={certified} />
            </div>
          </header>

          {/* Pestañas */}
          <div className="shrink-0 px-6 pt-4">
            <div className="flex items-center gap-1 rounded-2xl border border-line bg-subtle/40 p-1">
              {([
                { key: 'modules' as const, label: t('admin.progress_overview.drawer_modules', 'Módulos'), count: modules.length },
                { key: 'people' as const, label: t('admin.progress_overview.drawer_people', 'Aprendices'), count: enrolled.length },
              ]).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setTab(o.key)}
                  className={cn(
                    'inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-bold transition-all',
                    tab === o.key ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
                  )}
                >
                  {o.label}
                  <span className="rounded-full bg-line/60 px-1.5 py-0.5 text-[10px] tabular-nums">{o.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Contenido */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {tab === 'modules' ? (
              modules.length === 0 ? (
                <EmptyState
                  icon={<Layers className="h-6 w-6" />}
                  title={t('admin.progress_overview.drawer_no_modules', 'Este curso todavía no tiene módulos')}
                  description={t('admin.progress_overview.drawer_no_modules_desc', 'Sin temario no se puede medir avance: el curso solo puede darse por terminado con certificado.')}
                />
              ) : (
                <ul className="space-y-3">
                  {perModule.map((m, i) => (
                    <li key={m.module.id} className="rounded-2xl border border-line bg-surface p-3.5">
                      <div className="flex items-baseline gap-3">
                        {/* El título se recorta antes que empujar a la cifra:
                            "4/91" es el dato, el nombre es la etiqueta. */}
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text" title={m.module.title}>
                          <span className="mr-2 text-text-subtle tabular-nums">{i + 1}.</span>
                          {m.module.title}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-[12px] font-bold tabular-nums text-text">
                          {m.done}/{enrolled.length}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <span className="min-w-0 flex-1"><RankBar value={m.done} max={Math.max(1, enrolled.length)} accent={GREEN} delay={0.03 * i} /></span>
                        <span className="w-9 shrink-0 text-right text-[11.5px] tabular-nums text-text-muted">{m.pct}%</span>
                        <span className="w-[104px] shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-text-subtle">
                          {m.avgMs !== null
                            ? t('admin.progress_overview.drawer_avg_time', { time: formatElapsed(m.avgMs), defaultValue: '{{time}} de media' })
                            : '—'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <>
                <div className="relative mb-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('admin.progress_overview.drawer_search', 'Buscar aprendiz…')}
                    className="h-9 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-[12.5px] text-text outline-none transition-colors placeholder:text-text-subtle focus:border-[rgb(var(--brand-green))]/50"
                  />
                </div>
                {visiblePeople.length === 0 ? (
                  <EmptyState icon={<Users className="h-6 w-6" />} title={t('admin.progress_overview.no_people', 'Nadie coincide con este filtro')} />
                ) : (
                  <ul className="space-y-2">
                    {visiblePeople.map((e) => (
                      <li key={e.person.id}>
                        <button
                          type="button"
                          onClick={() => onPerson(e.person)}
                          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition-colors hover:bg-subtle"
                        >
                          <PersonAvatar name={e.person.name} url={e.person.avatarUrl} size={32} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium text-text">{e.person.name}</span>
                            <span className="mt-1.5 flex items-center gap-2">
                              <span className="w-24"><RankBar value={e.done.size} max={Math.max(1, modules.length)} accent={GREEN} /></span>
                              <span className="text-[11px] tabular-nums text-text-muted">
                                {e.done.size}/{modules.length}
                              </span>
                            </span>
                          </span>
                          {e.cell.certifiedAt ? (
                            <span className="flex shrink-0 items-center gap-1.5">
                              <StatusPill tone="green" icon={<Award className="h-3 w-3" />}>
                                {t('admin.progress_overview.cell_certified', 'Certificado')}
                              </StatusPill>
                              {/* Certificado con temario pendiente: se certificó
                                  cuando el curso era más corto (ver la ficha de
                                  la persona para el detalle con fecha). */}
                              {modules.length > 0 && e.done.size < modules.length && (
                                <StatusPill tone="amber">
                                  {t('admin.users.cert_outdated', { count: modules.length - e.done.size, defaultValue: 'Faltan {{count}} módulos' })}
                                </StatusPill>
                              )}
                            </span>
                          ) : e.cell.started ? (
                            <span className="text-[12px] font-bold tabular-nums" style={{ color: e.cell.score !== null ? scoreHex(e.cell.score) : undefined }}>
                              {e.cell.score ?? '—'}
                            </span>
                          ) : (
                            <StatusPill tone="neutral">{t('admin.progress_overview.seg_idle', 'Sin iniciar')}</StatusPill>
                          )}
                          <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <footer className="shrink-0 border-t border-line px-6 py-3 text-[11.5px] text-text-subtle">
            {tab === 'modules'
              ? t('admin.progress_overview.drawer_modules_hint', 'El porcentaje es cuánta de la gente asignada completó ese módulo: la caída entre uno y el siguiente marca dónde se atascan.')
              : t('admin.progress_overview.drawer_people_hint', 'Clic en alguien para abrir su ficha completa.')}
          </footer>
        </motion.aside>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

function Metric({
  icon, label, value, accent,
}: {
  icon: React.ReactNode; label: string; value: number; accent: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
        <span style={{ color: accent }}>{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-1 block text-[20px] font-bold leading-none tabular-nums text-text">{value}</span>
    </div>
  );
}
