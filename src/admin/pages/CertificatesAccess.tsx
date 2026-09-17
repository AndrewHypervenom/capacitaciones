import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Award, Copy, Download, ExternalLink, Loader2, Search, ShieldCheck, X } from 'lucide-react'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { Tooltip } from '@/components/ui/Tooltip'
import { PersonAvatar } from '@/admin/pages/progress/OverviewChrome'
import { Highlight } from '@/admin/pages/progress/ModulesChrome'
import { getCertificateDirectory, type CertificateEntry } from '@/services/certificateDirectory.service'
import { findCertificateId } from '@/services/certification.service'
import { printableCertCode } from '@/lib/certCode'
import { fold } from '@/lib/normalize'
import { toast } from '@/stores/toastStore'

/**
 * Admin → Certificados: UNA casilla para encontrar cualquier diploma.
 *
 * Quien entra aquí casi nunca tiene el código: tiene un nombre, un correo o una
 * cédula ("¿me descargas el certificado de Juan?"). Antes la pantalla pedía el
 * código y mandaba a otra vista para buscar por persona. Ahora se escribe lo
 * que se tenga y salen los diplomas con sus botones: ver, descargar, copiar.
 * Si lo escrito es un código que no está en la lista (de otra área, por
 * ejemplo), se ofrece validarlo contra la base.
 */

const STEP = 30
const RECENT = 12

/** Sin guiones, espacios ni mayúsculas: `LAI-20260916-483` = `lai20260916483`. */
const compact = (s: string) => fold(s).replace(/[^a-z0-9]/g, '')

export default function CertificatesAccess() {
  const { t, i18n } = useTranslation()
  const [entries, setEntries] = useState<CertificateEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(STEP)
  const [checking, setChecking] = useState(false)
  const [codeMissing, setCodeMissing] = useState(false)

  useEffect(() => {
    let alive = true
    getCertificateDirectory()
      .then((rows) => { if (alive) setEntries(rows) })
      .catch(() => { if (alive) { setEntries([]); setFailed(true) } })
    return () => { alive = false }
  }, [])

  const q = query.trim()
  const results = useMemo(() => {
    if (!entries) return []
    if (!q) return entries.slice(0, RECENT)
    const f = fold(q)
    const c = compact(q)
    return entries.filter((e) =>
      fold(e.personName).includes(f)
      || fold(e.email ?? '').includes(f)
      || (!!c && compact(e.nationalId ?? '').includes(c))
      || fold(e.courseTitle).includes(f)
      || (c.length >= 4 && compact(e.certId).includes(c)),
    )
  }, [entries, q])

  const people = useMemo(() => new Set(results.map((r) => r.userId)).size, [results])

  const changeQuery = (v: string) => {
    setQuery(v)
    setLimit(STEP)
    setCodeMissing(false)
  }

  const verifyUrl = (e: CertificateEntry) => `${window.location.origin}/verify/${encodeURIComponent(e.certId)}`

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('admin.certificates_access.link_copied'))
    } catch {
      toast.error(t('admin.progress_overview.cert_copy_err', 'No se pudo copiar el enlace'))
    }
  }

  // Lo escrito parece un código y no está en la lista: se valida en la base.
  const looksLikeCode = compact(q).length >= 12 && /\d/.test(q)
  const checkCode = async () => {
    setChecking(true)
    setCodeMissing(false)
    try {
      const id = await findCertificateId(q)
      if (id) window.open(`/verify/${encodeURIComponent(id)}`, '_blank', 'noopener')
      else setCodeMissing(true)
    } finally {
      setChecking(false)
    }
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })

  const actionBtn =
    'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-line px-3 text-[12px] font-semibold text-text-muted transition-colors hover:border-primary/40 hover:text-text'

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <p className="mb-3 text-[11px] uppercase tracking-wider text-text-subtle">
        Admin / {t('admin.nav.certificates')}
      </p>
      <GradientHeading as="h1" variant="white" size="headline">
        {t('admin.certificates_access.title')}
      </GradientHeading>
      <p className="mt-1 text-[13px] text-text-muted">{t('admin.certificates_access.subtitle')}</p>

      {/* La casilla: lo único que hay que entender de esta pantalla. */}
      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-subtle" />
        <input
          value={query}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => changeQuery(e.target.value)}
          placeholder={t('admin.certificates_access.search_ph')}
          aria-label={t('admin.certificates_access.search_ph')}
          className="min-h-[56px] w-full rounded-2xl border border-line bg-surface pl-12 pr-12 text-[16px] text-text outline-none placeholder:text-text-subtle focus:border-primary"
        />
        {query && (
          <button
            type="button"
            onClick={() => changeQuery('')}
            aria-label={t('admin.courses.clear_filters')}
            className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-text-subtle hover:bg-subtle hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Qué se está viendo */}
      <div className="mb-3 mt-4 flex min-h-[20px] flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-text">
          {entries === null
            ? t('admin.certificates_access.loading')
            : q
              ? t('admin.certificates_access.results', { count: results.length, people })
              : t('admin.certificates_access.recent', { total: entries.length })}
        </h2>
        {failed && <span className="text-[12px] text-danger">{t('admin.certificates_access.load_error')}</span>}
      </div>

      {entries === null ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[76px] rounded-2xl bg-subtle skeleton-shine" />)}
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center">
          <Award className="mx-auto mb-2 h-6 w-6 text-text-subtle" />
          <p className="text-[14px] text-text">{t('admin.certificates_access.none_title')}</p>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-text-muted">{t('admin.certificates_access.none_body')}</p>
          {looksLikeCode && (
            <div className="mt-4">
              <button type="button" onClick={() => void checkCode()} disabled={checking} className={actionBtn}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {t('admin.certificates_access.check_code')}
              </button>
              {codeMissing && (
                <p role="alert" className="mt-2 text-[12px] text-danger">{t('verify_lookup.not_found')}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {results.slice(0, limit).map((e) => (
              <li
                key={`${e.certId}|${e.userId}`}
                className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:p-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <PersonAvatar name={e.personName} url={e.avatarUrl} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-text">
                      <Highlight text={e.personName} term={q} />
                    </p>
                    <p className="truncate text-[12px] text-text-muted">
                      {e.courseIcon && <span className="mr-1">{e.courseIcon}</span>}
                      <Highlight text={e.courseTitle} term={q} />
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-text-subtle">
                      <span>{fmtDate(e.issuedAt)}</span>
                      {e.crName && <span>· {e.crName}</span>}
                      {e.email && <span className="truncate">· <Highlight text={e.email} term={q} /></span>}
                      <span className="font-mono">· {printableCertCode(e.certId)}</span>
                    </p>
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-3 gap-2 sm:flex">
                  <a href={`/verify/${encodeURIComponent(e.certId)}`} target="_blank" rel="noopener" className={actionBtn}>
                    <ExternalLink className="h-4 w-4" />
                    {t('admin.certificates_access.view')}
                  </a>
                  <a
                    href={`/verify/${encodeURIComponent(e.certId)}?download=1`}
                    target="_blank"
                    rel="noopener"
                    className={`${actionBtn} border-primary/30 text-primary`}
                  >
                    <Download className="h-4 w-4" />
                    {t('admin.certificates_access.download')}
                  </a>
                  <Tooltip label={t('admin.certificates_access.copy_hint')} maxWidth={260}>
                    <button type="button" onClick={() => void copyLink(verifyUrl(e))} className={`${actionBtn} w-full`}>
                      <Copy className="h-4 w-4" />
                      {t('admin.certificates_access.copy')}
                    </button>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
          {q && results.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + STEP)}
              className="mx-auto mt-4 block rounded-xl border border-line px-4 py-2 text-[13px] font-medium text-text-muted hover:text-text"
            >
              {t('admin.certificates_access.more', { count: results.length - limit })}
            </button>
          )}
        </>
      )}

      {/* Para mandar a alguien de fuera: validar sin cuenta. */}
      <div className="mt-10 flex flex-col gap-2 rounded-2xl border border-line/70 px-4 py-3 text-[12px] text-text-muted sm:flex-row sm:items-center">
        <ShieldCheck className="hidden h-4 w-4 shrink-0 text-text-subtle sm:block" />
        <span className="min-w-0 flex-1">
          {t('admin.certificates_access.public_hint')}{' '}
          <span className="font-mono text-text [overflow-wrap:anywhere]">{window.location.origin}/verify</span>
        </span>
        <button
          type="button"
          onClick={() => void copyLink(`${window.location.origin}/verify`)}
          className="inline-flex items-center gap-1 self-start rounded-lg border border-line px-2 py-1 font-medium hover:text-text sm:self-auto"
        >
          <Copy className="h-3.5 w-3.5" />
          {t('admin.certificates_access.copy')}
        </button>
      </div>
    </div>
  )
}
