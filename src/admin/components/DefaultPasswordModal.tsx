import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Loader2, Eye, EyeOff, KeyRound, Copy, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { backdropDismiss } from '@/lib/backdropDismiss'
import { toast } from '@/stores/toastStore'
import {
  getDefaultPassword,
  setDefaultPassword,
  MIN_DEFAULT_PASSWORD_LENGTH,
} from '@/services/appSettings.service'

interface DefaultPasswordModalProps {
  onClose: () => void
  /** Para que la lista refleje el nuevo estado (banner del encabezado). */
  onSaved?: (enabled: boolean) => void
}

/**
 * Ajuste de superadmin: contraseña predeterminada para usuarios nuevos.
 *
 * Activada, todos los usuarios que se creen (alta individual y carga masiva)
 * nacen con la misma contraseña, así se anuncia una sola vez en lugar de mandar
 * una temporal por chat a cada quien. Desactivada, se vuelve al comportamiento
 * de siempre: una contraseña temporal aleatoria por usuario.
 *
 * En ambos casos el usuario la cambia en el onboarding, así que la predeterminada
 * solo sirve para el primer ingreso.
 */
export function DefaultPasswordModal({ onClose, onSaved }: DefaultPasswordModalProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  const [missingSetting, setMissingSetting] = useState(false)

  useEffect(() => {
    let alive = true
    getDefaultPassword()
      .then((setting) => {
        if (!alive) return
        if (setting) {
          setEnabled(setting.enabled)
          setPassword(setting.password)
        } else {
          setMissingSetting(true)
        }
      })
      .catch(() => alive && setMissingSetting(true))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const tooShort = password.trim().length > 0 && password.trim().length < MIN_DEFAULT_PASSWORD_LENGTH
  // Solo se exige contraseña válida si el ajuste queda activado; apagarlo siempre
  // se puede guardar (es justamente la salida de emergencia).
  const canSave = !saving && !loading && (!enabled || password.trim().length >= MIN_DEFAULT_PASSWORD_LENGTH)

  const handleSave = async () => {
    setSaving(true)
    try {
      await setDefaultPassword({ enabled, password: password.trim() })
      toast.success(
        enabled
          ? t('admin.users.default_pwd_saved_on')
          : t('admin.users.default_pwd_saved_off'),
      )
      onSaved?.(enabled)
      onClose()
    } catch (err) {
      toast.error(t('profile.save_error', 'No se pudo guardar'), (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const copy = () => {
    navigator.clipboard.writeText(password.trim())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" {...backdropDismiss(onClose)} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-md"
        >
          <div className="relative flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
              <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                <KeyRound className="h-4 w-4 text-text-muted" />
                {t('admin.users.default_pwd_title')}
              </h3>
              <button
                onClick={onClose}
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {loading ? (
                <div className="flex items-center gap-2 text-[13px] text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.loading', 'Cargando…')}
                </div>
              ) : (
                <>
                  <p className="text-[13px] text-text-muted">{t('admin.users.default_pwd_help')}</p>

                  <label className="flex items-start gap-3 rounded-xl border border-line bg-subtle px-4 py-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[#10D451]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-text">
                        {t('admin.users.default_pwd_enable')}
                      </span>
                      <span className="block text-[12px] text-text-muted mt-0.5">
                        {enabled
                          ? t('admin.users.default_pwd_state_on')
                          : t('admin.users.default_pwd_state_off')}
                      </span>
                    </span>
                  </label>

                  <div>
                    <label className="block text-[12px] text-text-muted mb-1.5">
                      {t('admin.users.default_pwd_label')}
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type={show ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={!enabled}
                          autoComplete="new-password"
                          placeholder={t('admin.users.default_pwd_ph')}
                          className="w-full rounded-xl border border-line bg-subtle px-3 py-2.5 pr-10 text-[13px] font-mono text-text placeholder:text-text-subtle disabled:opacity-50 min-h-[44px]"
                        />
                        <button
                          type="button"
                          onClick={() => setShow((s) => !s)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-lg text-text-subtle hover:text-text"
                          aria-label={t('admin.users.default_pwd_show')}
                        >
                          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={copy}
                        disabled={!password.trim()}
                        className="h-[44px] w-[44px] shrink-0 flex items-center justify-center rounded-xl border border-line bg-subtle text-text-muted hover:text-text disabled:opacity-50"
                        aria-label={t('admin.users.default_pwd_copy')}
                      >
                        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                    {tooShort && (
                      <p className="mt-1.5 text-[12px] text-red-500">
                        {t('admin.users.default_pwd_min', { n: MIN_DEFAULT_PASSWORD_LENGTH })}
                      </p>
                    )}
                  </div>

                  <p className="text-[12px] text-text-muted">{t('admin.users.default_pwd_note')}</p>

                  {missingSetting && (
                    <p className="text-[12px] text-amber-500">{t('admin.users.default_pwd_missing')}</p>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-line">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle min-h-[44px]"
              >
                {t('admin.courses.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black disabled:opacity-50 min-h-[44px]"
                style={{ background: '#10D451' }}
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('admin.courses.save', 'Guardar')}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
