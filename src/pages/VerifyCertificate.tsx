import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Award, Download, ScanLine, ShieldCheck } from 'lucide-react'
import { CertificateLookup } from '@/components/certificate/CertificateLookup'

/**
 * Página PÚBLICA para validar un certificado (`/verify`).
 *
 * El diploma imprime un código y un QR. Con el QR se llega directo a
 * `/verify/:certId`; con el código en la mano no había a dónde ir. Aquí se
 * escribe (o se pega el enlace) y se abre la página del certificado, que es la
 * que dice si es auténtico, de quién es y deja descargarlo.
 *
 * No exige sesión: la usa un reclutador, un cliente o Talento Humano.
 */
export default function VerifyCertificate() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initial = params.get('code') ?? ''

  const steps = [
    { icon: ScanLine, title: t('verify_lookup.step1_title'), body: t('verify_lookup.step1_body') },
    { icon: ShieldCheck, title: t('verify_lookup.step2_title'), body: t('verify_lookup.step2_body') },
    { icon: Download, title: t('verify_lookup.step3_title'), body: t('verify_lookup.step3_body') },
  ]

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg text-text">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-40 h-[30rem] w-[30rem] rounded-full bg-brand-green/10 blur-[100px]" />
        <div className="absolute -top-24 right-0 h-[26rem] w-[26rem] rounded-full bg-brand-magenta/10 blur-[100px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-xl flex-col px-4 py-10 sm:px-6 sm:py-16">
        <Link to="/" className="mb-10 inline-flex items-center gap-2 self-start">
          <img src="/logo.jpg" alt="" className="h-7 w-7 rounded-md" />
          <span className="text-[15px] font-semibold">LearningAI</span>
        </Link>

        <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-primary">
          <Award className="h-6 w-6" />
        </div>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">
          {t('verify_lookup.title')}
        </h1>
        <p className="mb-8 mt-2 text-[15px] text-text-muted">{t('verify_lookup.subtitle')}</p>

        <div className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <CertificateLookup
            autoFocus
            initialCode={initial}
            onFound={(id) => navigate(`/verify/${encodeURIComponent(id)}`)}
          />
        </div>

        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {steps.map(({ icon: Icon, title, body }, i) => (
            <li key={i} className="rounded-2xl border border-line/70 p-4">
              <Icon className="mb-2 h-4 w-4 text-text-subtle" />
              <p className="text-[13px] font-semibold">{title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
