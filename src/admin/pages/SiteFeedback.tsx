import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import {
  ChevronDown, ChevronRight, Inbox, Loader2, Mail, MessageCircle, Monitor,
  Phone, Search, Copy, Check,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  computeStats, fetchSiteFeedback, updateSiteFeedback,
  type FeedbackKind, type FeedbackStatus, type SiteFeedbackRow,
} from '@/services/siteFeedback.service'
import { KINDS, MOODS, kindMeta, questionsFor } from '@/components/feedback/config'
import { STATUSES, StatusPill, STATUS_COLOR } from '@/components/feedback/StatusPill'
import { FadeIn } from '@/components/ui/motion'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'

type StatusFilter = FeedbackStatus | 'all' | 'open'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** Fecha completa para el detalle: ahí sí importa el año y el minuto exacto. */
function fmtFullDate(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function SiteFeedback() {
  const { t } = useTranslation()
  // El capacitador viene a atender personas; el superadmin, además, a depurar.
  // Esa es la única diferencia entre lo que ve uno y otro en esta pantalla.
  const { isSuperAdmin } = useAuth()
  const [rows, setRows] = useState<SiteFeedbackRow[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<StatusFilter>('open')
  const [kind, setKind] = useState<FeedbackKind | 'all'>('all')
  const [contactOnly, setContactOnly] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    return fetchSiteFeedback({ status, kind, contactOnly, search })
      .then(setRows)
      .catch((e) => {
        console.error('site feedback error:', e)
        toast.error(t('admin.site_feedback.load_error', 'No pudimos cargar las opiniones'))
      })
      .finally(() => setLoading(false))
  }, [status, kind, contactOnly, search, t])

  useEffect(() => { void load() }, [load])

  const stats = useMemo(() => computeStats(rows), [rows])

  /** Cambia el estado en la fila ya cargada (sin recargar toda la lista). */
  async function patch(id: string, p: { status?: FeedbackStatus; staff_note?: string | null }) {
    try {
      await updateSiteFeedback(id, p)
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...p } as SiteFeedbackRow : r)))
      toast.success(t('admin.site_feedback.saved', 'Actualizado'))
    } catch (e) {
      console.error(e)
      toast.error(t('admin.site_feedback.save_error', 'No se pudo guardar'))
    }
  }

  const statusChips: { key: StatusFilter; label: string; color?: string }[] = [
    { key: 'open', label: t('admin.site_feedback.filter_open', 'Sin resolver') },
    { key: 'all', label: t('admin.site_feedback.filter_all', 'Todas') },
    ...STATUSES.map((s) => ({
      key: s as StatusFilter,
      label: t(`site_feedback.status.${s}`),
      color: STATUS_COLOR[s],
    })),
  ]

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="mb-1 text-[20px] font-bold text-text sm:text-[24px]">
          {t('admin.site_feedback.title', 'Opiniones del sitio')}
        </h1>
        <p className="text-[13px] text-text-muted">
          {t('admin.site_feedback.subtitle', 'Lo que tus aprendices reportan, proponen y celebran de la plataforma.')}
        </p>
      </div>

      {/* ── KPIs ── */}
      <FadeIn as="section" className="mb-4 grid grid-cols-2 gap-3 sm:mb-5 sm:gap-4 lg:grid-cols-4" y={12}>
        <Kpi label={t('admin.site_feedback.kpi_total', 'Opiniones')} value={String(stats.total)} />
        <Kpi label={t('admin.site_feedback.kpi_open', 'Sin resolver')} value={String(stats.open)} color="#f59e0b" />
        <Kpi
          label={t('admin.site_feedback.kpi_contact', 'Piden contacto')}
          value={String(stats.contactPending)}
          color={stats.contactPending > 0 ? '#ef4444' : undefined}
        />
        <Kpi
          label={t('admin.site_feedback.kpi_mood', 'Ánimo promedio')}
          value={stats.avgMood !== null ? `${stats.avgMood}/5` : '—'}
          sub={stats.avgMood !== null ? MOODS[Math.round(stats.avgMood) - 1]?.emoji : undefined}
          // Un 2/5 promedio no puede pintarse de verde: el color es la alarma.
          color={stats.avgMood !== null ? scoreColor(Math.round(stats.avgMood)) : undefined}
        />
      </FadeIn>

      {/* ── Toolbar ── */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <form
            className="relative w-full sm:max-w-xs"
            onSubmit={(e) => { e.preventDefault(); setSearch(searchInput) }}
          >
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted/70" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('admin.site_feedback.search_ph', 'Buscar en los comentarios…')}
              className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-muted/60 focus:border-[rgb(var(--brand-green))]/40"
            />
          </form>

          <div className="flex flex-wrap gap-2">
            <FilterChip active={kind === 'all'} onClick={() => setKind('all')}>
              {t('admin.site_feedback.kind_all', 'Todo tipo')}
            </FilterChip>
            {KINDS.map((k) => (
              <FilterChip
                key={k.key}
                active={kind === k.key}
                color={k.color}
                onClick={() => setKind(kind === k.key ? 'all' : k.key)}
              >
                <span className="mr-1">{k.emoji}</span>
                {t(`site_feedback.kind.${k.key}.label`)}
                <span className="ml-1 tabular-nums opacity-70">{stats.byKind[k.key] || 0}</span>
              </FilterChip>
            ))}
            <FilterChip active={contactOnly} color="#ef4444" onClick={() => setContactOnly((v) => !v)}>
              <Phone className="mr-1 inline h-3 w-3" />
              {t('admin.site_feedback.only_contact', 'Piden contacto')}
            </FilterChip>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {statusChips.map((c) => (
            <FilterChip key={c.key} active={status === c.key} color={c.color} onClick={() => setStatus(c.key)}>
              {c.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* ── Lista ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6 text-center sm:p-12">
          <Inbox className="mx-auto mb-3 h-7 w-7 text-text-subtle" />
          <div className="mb-1 text-[15px] font-medium text-text">
            {t('admin.site_feedback.empty_title', 'Nada por aquí todavía')}
          </div>
          <div className="text-[13px] text-text-muted">
            {t('admin.site_feedback.empty_desc', 'Cuando alguien opine desde el botón flotante, su mensaje aparecerá en esta bandeja.')}
          </div>
        </div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {rows.map((r) => (
            <Row
              key={r.id}
              row={r}
              isSuperAdmin={isSuperAdmin}
              open={expanded === r.id}
              onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
              onPatch={patch}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function Row({ row: r, open, isSuperAdmin, onToggle, onPatch }: {
  row: SiteFeedbackRow
  open: boolean
  isSuperAdmin: boolean
  onToggle: () => void
  onPatch: (id: string, p: { status?: FeedbackStatus; staff_note?: string | null }) => Promise<void>
}) {
  const { t } = useTranslation()
  const meta = kindMeta(r.kind)
  const [note, setNote] = useState(r.staff_note ?? '')
  const [savingNote, setSavingNote] = useState(false)

  const mood = r.mood ? MOODS.find((m) => m.value === r.mood) : null

  // Todas las preguntas del formulario: las propias de este tipo (aunque las
  // haya dejado en blanco) más cualquier respuesta guardada que ya no figure
  // entre ellas, para que nunca se pierda de vista algo que la persona contestó.
  const answerEntries = useMemo(() => {
    const own = questionsFor(r.kind).map((q) => q.key)
    const extra = Object.keys(r.answers ?? {}).filter((k) => !own.includes(k))
    return [...own, ...extra].map((key) => ({ key, value: r.answers?.[key] ?? '' }))
  }, [r.kind, r.answers])

  return (
    <div>
      <button
        onClick={onToggle}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle/50"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[17px]"
          style={{ background: `${meta.color}1f` }}
        >
          {meta.emoji}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] text-text">
            {r.message || <span className="italic text-text-muted">{t('admin.site_feedback.no_message', 'Sin comentario escrito')}</span>}
          </div>
          <div className="truncate text-[11px] text-text-muted">
            {r.display_name ?? t('admin.site_feedback.user_fallback', 'Usuario')}
            {/* La campaña solo le dice algo al superadmin: el capacitador ya
                sabe que todo lo que ve aquí es de las suyas. */}
            {isSuperAdmin && r.campaign_name ? ` · ${r.campaign_name}` : ''} · {fmtDate(r.created_at)}
            {mood ? ` · ${mood.emoji}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {r.contact_ok && (
            <span className="hidden items-center gap-1 rounded-full bg-red-500/12 px-2 py-1 text-[10.5px] font-medium text-red-400 sm:inline-flex">
              <Phone className="h-3 w-3" />
              {t('admin.site_feedback.wants_contact', 'Contactar')}
            </span>
          )}
          <StatusPill status={r.status} className="hidden sm:inline-flex" />
          {open ? <ChevronDown className="h-4 w-4 text-text-muted" /> : <ChevronRight className="h-4 w-4 text-text-muted" />}
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t border-line bg-subtle/40 px-4 pb-5 pt-4">
          {/* Contexto de una línea: quién, cuándo y desde dónde. Es lo primero
              que un capacitador necesita para ubicar la opinión. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-muted">
            <span className="font-medium text-text">
              {r.display_name ?? t('admin.site_feedback.user_fallback', 'Usuario')}
            </span>
            {r.role && r.role !== 'learner' && (
              <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide">
                {t(`roles.${r.role}`, r.role)}
              </span>
            )}
            <span>·</span>
            <span>{fmtFullDate(r.created_at)}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Monitor className="h-3 w-3" />
              {r.page_label || t('admin.site_feedback.page_unknown', 'Pantalla no identificada')}
            </span>
            {isSuperAdmin && r.campaign_name && (
              <>
                <span>·</span>
                <span>{r.campaign_name}</span>
              </>
            )}
          </p>

          {/* ── Lo que dijo ── */}
          <Section title={t('admin.site_feedback.sec_said', 'Lo que dijo')}>
            <p className={cn(
              'whitespace-pre-wrap rounded-xl border border-line bg-surface px-3.5 py-3 text-[13.5px] leading-relaxed',
              r.message ? 'text-text' : 'italic text-text-muted',
            )}>
              {r.message || t('admin.site_feedback.no_message', 'Sin comentario escrito')}
            </p>
          </Section>

          {/* ── Cómo se sintió: las tres medidas, en lenguaje de persona ── */}
          <Section title={t('admin.site_feedback.sec_felt', 'Cómo se sintió')}>
            <div className="grid gap-2 sm:grid-cols-3">
              <Metric
                label={t('admin.site_feedback.d_kind', 'Tipo de opinión')}
                value={t(`site_feedback.kind.${r.kind}.label`)}
                emoji={meta.emoji}
                color={meta.color}
              />
              <Metric
                label={t('admin.site_feedback.d_mood', 'Ánimo general')}
                value={mood ? t(`site_feedback.mood.${mood.value}`) : '—'}
                emoji={mood?.emoji}
                score={r.mood}
              />
              <Metric
                label={t('admin.site_feedback.d_ease', 'Facilidad')}
                value={r.ease ? t(`site_feedback.ease_level.${r.ease}`) : '—'}
                score={r.ease}
              />
            </div>
          </Section>

          {/* ── Respuestas del formulario ── */}
          <Section title={t('admin.site_feedback.sec_answers', 'Lo que respondió')}>
            <div className="space-y-2.5">
              <QaRow label={t('admin.site_feedback.d_areas', 'Zonas del sitio')}>
                {r.areas?.length
                  ? (
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {r.areas.map((a) => (
                        <span key={a} className="rounded-full bg-subtle px-2 py-0.5 text-[11.5px] text-text">
                          {t(`site_feedback.areas.${a}`, a)}
                        </span>
                      ))}
                    </span>
                  )
                  : '—'}
              </QaRow>

              {/* Primero las preguntas propias de este tipo de opinión y luego
                  cualquier otra respuesta guardada: si mañana cambian las
                  preguntas, lo viejo se sigue viendo en vez de desaparecer. */}
              {answerEntries.map(({ key, value }) => (
                <QaRow key={key} label={t(`site_feedback.q.${key}.title`, key)}>
                  {value ? t(`site_feedback.q.${key}.opt.${value}`, value) : '—'}
                </QaRow>
              ))}
            </div>
          </Section>

          {/* Contacto: lo más accionable de la ficha, por eso destaca en color */}
          {r.contact_ok && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/6 px-3.5 py-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-400">
                <Phone className="h-3 w-3" />
                {t('admin.site_feedback.contact_title', 'Pidió que lo contactaran')}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {r.contact_email && (
                  <ContactLink href={`mailto:${r.contact_email}`} icon={Mail} value={r.contact_email} />
                )}
                {r.contact_phone && (
                  <>
                    <ContactLink href={`tel:${r.contact_phone.replace(/\s/g, '')}`} icon={Phone} value={r.contact_phone} />
                    <ContactLink
                      href={`https://wa.me/${r.contact_phone.replace(/[^\d]/g, '')}`}
                      icon={MessageCircle}
                      value="WhatsApp"
                    />
                  </>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-text-muted">
                <span>
                  {t('admin.site_feedback.contact_pref', 'Prefiere')}:{' '}
                  {r.contact_pref ? t(`site_feedback.contact_pref_${r.contact_pref}`) : '—'}
                </span>
                <span>
                  {t('admin.site_feedback.contact_when', 'Momento')}: {r.contact_note || '—'}
                </span>
              </div>
            </div>
          )}

          {/* Gestión */}
          <Section title={t('admin.site_feedback.manage', 'Gestión')}>
            <div className="mb-3 flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => onPatch(r.id, { status: s })}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                    r.status === s ? '' : 'border-line text-text-muted hover:bg-subtle',
                  )}
                  style={r.status === s
                    ? { borderColor: STATUS_COLOR[s], background: `${STATUS_COLOR[s]}1a`, color: STATUS_COLOR[s] }
                    : undefined}
                >
                  {t(`site_feedback.status.${s}`)}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={t('admin.site_feedback.note_ph', 'Nota interna: qué se hizo con esto…')}
              className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] text-text placeholder:text-text-muted/60 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-[11px] text-text-subtle">
                {r.handled_by_name
                  ? t('admin.site_feedback.handled_by', 'Última gestión: {{name}}', { name: r.handled_by_name })
                  : ''}
              </span>
              <button
                onClick={async () => {
                  setSavingNote(true)
                  await onPatch(r.id, { staff_note: note.trim() || null })
                  setSavingNote(false)
                }}
                disabled={savingNote || (r.staff_note ?? '') === note.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-text px-3 py-1.5 text-[12px] font-semibold text-bg transition-opacity disabled:opacity-40"
              >
                {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {t('admin.site_feedback.save_note', 'Guardar nota')}
              </button>
            </div>
          </Section>

          {/* Lo técnico es ruido para el capacitador —que necesita atender a la
              persona, no depurar— y materia prima para el superadmin, que sí
              tiene que reproducir el error. Por eso solo él lo ve. */}
          {isSuperAdmin && (
            <details className="rounded-xl border border-line bg-surface/60 px-3 py-2 text-[11.5px] text-text-subtle">
              <summary className="cursor-pointer select-none font-medium hover:text-text-muted">
                {t('admin.site_feedback.tech', 'Detalles técnicos')}
              </summary>
              <div className="mt-2.5 space-y-1.5">
                <TechRow label={t('admin.site_feedback.d_path', 'Ruta')} value={r.page ?? '—'} mono />
                <TechRow label={t('admin.site_feedback.d_lang', 'Idioma')} value={r.lang?.toUpperCase() ?? '—'} />
                <TechRow label={t('admin.site_feedback.d_campaign', 'Campaña')} value={r.campaign_name ?? '—'} />
                <TechRow label={t('admin.site_feedback.d_id', 'ID')} value={r.id} mono />
              </div>
              {r.meta && Object.keys(r.meta).length > 0 && (
                <pre className="mt-2.5 overflow-x-auto rounded-lg bg-subtle p-2.5 text-[10.5px] leading-relaxed">
                  {JSON.stringify(r.meta, null, 2)}
                </pre>
              )}
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface p-4 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover sm:p-5">
      <span className="truncate text-[10px] uppercase tracking-wider text-text-muted sm:text-[11px]">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums sm:text-3xl" style={color ? { color } : { color: 'var(--text)' }}>
          {value}
        </span>
        {sub && <span className="text-[18px] leading-none">{sub}</span>}
      </div>
    </div>
  )
}

function FilterChip({ active, color, onClick, children }: {
  active: boolean
  color?: string
  onClick: () => void
  children: React.ReactNode
}) {
  const accent = color ?? 'rgb(var(--brand-green))'
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
        active ? '' : 'border-line text-text-muted hover:bg-subtle',
      )}
      style={active ? { borderColor: accent, background: `${accent}1a`, color: accent } : undefined}
    >
      {children}
    </button>
  )
}

/** Bloque con título fino: separa el detalle en lo que cada quien va a leer. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{title}</h4>
      {children}
    </section>
  )
}

/** Rojo abajo, ámbar en el medio, verde arriba: el color dice el estado. */
function scoreColor(score: number): string {
  if (score <= 2) return '#ef4444'
  if (score === 3) return '#f59e0b'
  return '#10D451'
}

/**
 * Medida con cara y palabra, no solo un número: "2/5" no dice nada de un
 * vistazo, "Difícil" en rojo sí. La barrita permite comparar fichas de un
 * barrido, sin leer.
 */
function Metric({ label, value, emoji, score, color }: {
  label: string
  value: string
  emoji?: string
  score?: number | null
  color?: string
}) {
  const tone = color ?? (typeof score === 'number' && score > 0 ? scoreColor(score) : undefined)
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        {emoji && <span className="text-[16px] leading-none">{emoji}</span>}
        <span className="text-[13.5px] font-semibold" style={tone ? { color: tone } : undefined}>{value}</span>
      </div>
      {typeof score === 'number' && score > 0 && (
        <div className="mt-2 flex gap-1" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={cn('h-1 flex-1 rounded-full', n <= score ? '' : 'bg-line')}
              style={n <= score ? { background: tone } : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Pregunta a la izquierda, respuesta a la derecha: se lee como una entrevista. */
function QaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line/60 pb-2.5 last:border-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="text-[12.5px] text-text-muted">{label}</span>
      <span className="text-right text-[13px] font-medium text-text">{children}</span>
    </div>
  )
}

function TechRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0">{label}</span>
      <span className={cn('truncate text-right text-text-muted', mono && 'font-mono text-[10.5px]')}>{value}</span>
    </div>
  )
}

function ContactLink({ href, icon: Icon, value }: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  value: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center overflow-hidden rounded-lg border border-line bg-surface">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-text transition-colors hover:bg-subtle"
      >
        <Icon className="h-3.5 w-3.5 text-text-muted" />
        {value}
      </a>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
        className="border-l border-line px-2 py-1.5 text-text-muted transition-colors hover:bg-subtle hover:text-text"
        aria-label="Copiar"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-neon-green" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  )
}
