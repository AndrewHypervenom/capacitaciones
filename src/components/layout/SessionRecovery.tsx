import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudOff, Loader2, LogOut, RefreshCw } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { signOut } from '@/services/auth.service'

/**
 * Hay sesión pero el perfil no se pudo leer (red caída, 5xx, timeout).
 *
 * Existe para que ese caso NO se resuelva cerrando la sesión: antes un fallo de
 * lectura se interpretaba como "esta cuenta no tiene perfil" y terminaba en un
 * signOut, que la persona vivía como "la sesión se expiró sola". Ahora la sesión
 * se conserva, se reintenta solo al volver la conexión, y esta pantalla da el
 * botón para reintentar a mano (y la salida explícita, si la quiere).
 */
export function SessionRecovery() {
  const { t } = useTranslation()
  const retryProfile = useAuthStore((s) => s.retryProfile)
  const [busy, setBusy] = useState(false)

  const retry = () => {
    setBusy(true)
    retryProfile()
    // El store vuelve a `loading`, así que esta pantalla se desmonta; el reset
    // solo importa si la lectura falla de nuevo y volvemos aquí.
    setTimeout(() => setBusy(false), 1200)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-5">
      <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-subtle text-text-muted">
          <CloudOff className="h-6 w-6" />
        </div>
        <h1 className="mb-2 text-[19px] font-semibold tracking-tight text-text">
          {t('errors.session.title')}
        </h1>
        <p className="mb-6 text-[14px] leading-relaxed text-text-muted">
          {t('errors.session.description')}
        </p>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={retry}
            disabled={busy}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-[14px] font-semibold text-on-primary transition-all hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t('errors.session.retry')}
          </button>
          <button
            onClick={() => { void signOut() }}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted transition-colors hover:text-text"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t('errors.session.sign_out')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SessionRecovery
