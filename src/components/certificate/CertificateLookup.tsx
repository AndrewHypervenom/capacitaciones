import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react'
import { findCertificateId } from '@/services/certification.service'
import { cn } from '@/lib/cn'

/**
 * Casilla para validar un certificado con lo que se tenga a mano: el código
 * del diploma, el identificador completo o el enlace. La usan la página
 * pública `/verify` y el acceso del panel; quien la monta decide qué hacer con
 * el certificado encontrado (abrirlo aquí o en otra pestaña).
 */
export function CertificateLookup({
  onFound,
  initialCode = '',
  autoFocus = false,
  className,
}: {
  onFound: (certId: string) => void
  initialCode?: string
  autoFocus?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const [code, setCode] = useState(initialCode)
  const [busy, setBusy] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const ranInitial = useRef(false)

  const run = async (value: string) => {
    if (!value.trim() || busy) return
    setBusy(true)
    setNotFound(false)
    try {
      const id = await findCertificateId(value)
      if (id) onFound(id)
      else setNotFound(true)
    } finally {
      setBusy(false)
    }
  }

  // `/verify?code=…`: llega con el código puesto, se valida sin pulsar nada.
  useEffect(() => {
    if (ranInitial.current || !initialCode.trim()) return
    ranInitial.current = true
    void run(initialCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode])

  return (
    <form
      className={cn('w-full', className)}
      onSubmit={(e) => {
        e.preventDefault()
        void run(code)
      }}
    >
      <label htmlFor="cert-code" className="mb-1.5 block text-[12px] font-medium text-text-muted">
        {t('verify_lookup.label')}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="cert-code"
          value={code}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setCode(e.target.value)
            if (notFound) setNotFound(false)
          }}
          placeholder={t('verify_lookup.placeholder')}
          className="min-h-[48px] w-full min-w-0 rounded-xl border border-line bg-surface px-4 font-mono text-[15px] tracking-wide text-text outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-text-subtle focus:border-primary"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-on-primary transition-opacity disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {t('verify_lookup.submit')}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-text-subtle">{t('verify_lookup.hint')}</p>
      {notFound && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/[0.06] px-3 py-2.5 text-[13px] text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('verify_lookup.not_found')}</span>
        </p>
      )}
    </form>
  )
}
