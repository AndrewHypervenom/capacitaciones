import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Award, Copy, Download, ExternalLink } from 'lucide-react'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { CertificateLookup } from '@/components/certificate/CertificateLookup'
import { toast } from '@/stores/toastStore'

/**
 * Acceso directo a los certificados desde el menú del panel.
 *
 * Antes, validar o descargar un diploma pasaba por Progreso → Módulos →
 * Panorama → pestaña Certificados, y validar un código impreso no se podía en
 * ningún sitio. Aquí están las dos cosas que se hacen a diario: validar un
 * código y llegar a la lista de emitidos (con descarga por fila).
 */
export default function CertificatesAccess() {
  const { t } = useTranslation()
  const publicUrl = `${window.location.origin}/verify`

  const copyPublic = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      toast.success(t('verify_lookup.public_copied'))
    } catch {
      toast.error(t('admin.progress_overview.cert_copy_err', 'No se pudo copiar el enlace'))
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <p className="mb-3 text-[11px] uppercase tracking-wider text-text-subtle">
        Admin / {t('admin.nav.certificates')}
      </p>
      <GradientHeading as="h1" variant="white" size="headline">
        {t('admin.certificates_access.title')}
      </GradientHeading>
      <p className="mt-1 text-[13px] text-text-muted">{t('admin.certificates_access.subtitle')}</p>

      {/* 1. Validar un código */}
      <section className="mt-8 rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="mb-4 text-[15px] font-semibold text-text">{t('admin.certificates_access.validate_title')}</h2>
        <CertificateLookup
          autoFocus
          // En otra pestaña: la página del certificado es pública y no debe
          // sacar a nadie del panel.
          onFound={(id) => window.open(`/verify/${encodeURIComponent(id)}`, '_blank', 'noopener')}
        />
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[12px] text-text-muted">
          <span>{t('admin.certificates_access.public_hint')}</span>
          <span className="font-mono text-text">{publicUrl}</span>
          <button
            type="button"
            onClick={() => void copyPublic()}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-medium text-text-muted transition-colors hover:text-text"
          >
            <Copy className="h-3.5 w-3.5" />
            {t('admin.certificates_access.copy')}
          </button>
          <a
            href="/verify"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-medium text-text-muted transition-colors hover:text-text"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('admin.certificates_access.open')}
          </a>
        </div>
      </section>

      {/* 2. Lista de emitidos */}
      <Link
        to="/admin/progress?view=modules&section=certificates"
        className="group mt-4 flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-primary/40 sm:p-6"
      >
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Award className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-text">{t('admin.certificates_access.list_title')}</span>
          <span className="mt-0.5 flex items-start gap-1.5 text-[12px] text-text-muted">
            <Download className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('admin.certificates_access.list_body')}
          </span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-text-subtle transition-transform group-hover:translate-x-1" />
      </Link>
    </div>
  )
}
