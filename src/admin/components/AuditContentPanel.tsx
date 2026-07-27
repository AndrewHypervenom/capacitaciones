import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { ContentDetail } from '@/services/auditContext.service'

/** Valor jsonb/escalar en forma legible y acotada. */
export function fmtAuditValue(v: unknown, max = 400): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'boolean') return v ? '✓' : '✕'
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…' : v
  if (typeof v === 'object') {
    const s = JSON.stringify(v, null, 2)
    return s.length > max ? s.slice(0, max) + '…' : s
  }
  return String(v)
}

/**
 * Ficha de contenido de una entidad: dónde vive, cuánto contiene, la lista de
 * sus hijos reales y todos sus campos. La comparten la bitácora de actividad y
 * las aprobaciones de eliminación.
 */
export function AuditContentPanel({ detail }: { detail: ContentDetail }) {
  const { t } = useTranslation()
  const statValue = (v: number | string) =>
    v === 'yes' ? t('admin.audit.yes') : v === 'no' ? t('admin.audit.no') : String(v)

  return (
    <div className="space-y-4">
      {detail.deleted && (
        <div className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1 text-[11.5px] text-amber-500">
          {t('admin.audit.hidden_snapshot')}
        </div>
      )}
      {detail.path.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-text-muted">
          {detail.path.map((p, i) => (
            <span key={`${p.kind}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-text-subtle">›</span>}
              {p.href
                ? <Link to={p.href} className="hover:text-text underline underline-offset-2">{p.label}</Link>
                : <span>{p.label}</span>}
            </span>
          ))}
        </div>
      )}

      {detail.stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {detail.stats.map((s) => (
            <div key={s.labelKey} className="rounded-xl border border-line bg-surface px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted truncate">{t(s.labelKey)}</div>
              <div className="text-[16px] font-semibold text-text tabular-nums">{statValue(s.value)}</div>
            </div>
          ))}
        </div>
      )}

      {detail.children.length > 0 && (
        <div>
          <div className="text-[10.5px] uppercase tracking-wider text-text-muted mb-1.5">
            {t(detail.childrenLabelKey ?? 'admin.audit.children_generic')} · {detail.children.length}
          </div>
          <div className="rounded-xl border border-line divide-y divide-line max-h-[340px] overflow-y-auto">
            {detail.children.map((c) => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-2">
                <span className="text-[12.5px] text-text truncate flex-1">{c.label}</span>
                {c.meta && (
                  <span className="rounded-md bg-subtle px-1.5 py-0.5 text-[10.5px] text-text-muted shrink-0">{c.meta}</span>
                )}
                {c.chips?.map((ch) => (
                  <span key={ch} className="rounded-md bg-subtle px-1.5 py-0.5 text-[10.5px] text-text-muted shrink-0">{ch}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {detail.raw && (
        <details className="rounded-xl border border-line">
          <summary className="cursor-pointer px-3 py-2 text-[12px] text-text-muted hover:text-text">
            {t('admin.audit.raw_fields')}
          </summary>
          <div className="divide-y divide-line border-t border-line">
            {Object.entries(detail.raw)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(90px,160px)_1fr] gap-2 px-3 py-1.5 text-[12px]">
                  <span className="text-text-muted font-mono break-all">{k}</span>
                  <span className="text-text break-words">{fmtAuditValue(v, 200)}</span>
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  )
}
