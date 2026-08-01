import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Fingerprint, Loader2, ScanFace, Sparkles, X, Zap } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { backdropDismiss } from '@/lib/backdropDismiss';
import { toast } from '@/stores/toastStore';
import {
  PasskeyError, dismissInvite, hasBiometricSensor, inviteDismissed, listMyPasskeys,
  registerPasskey, supportsPasskeys,
} from '@/services/passkeys.service';

const GREEN = '#10D451';
const MAGENTA = '#B33D9E';

/** Se espera a que la persona aterrice antes de proponer nada. */
const DELAY_MS = 2600;

/**
 * Invitación a activar el ingreso biométrico, al estilo de las apps de banca:
 * entras con tu contraseña y, ya dentro, se te ofrece usar la huella la próxima
 * vez.
 *
 * Reglas de buena educación que este componente respeta:
 *   · se propone UNA vez; si dicen que no, no se vuelve a insistir,
 *   · no aparece si el equipo no tiene sensor, ni si ya hay una passkey,
 *   · no interrumpe el aterrizaje: espera unos segundos.
 */
export function PasskeyInvite() {
  const { t } = useTranslation();
  const { isAuthenticated, user, profile } = useAuth();
  const reduce = !!useReducedMotion();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user?.id || !profile) return;
    if (!supportsPasskeys() || inviteDismissed()) return;

    let alive = true;
    const timer = setTimeout(async () => {
      try {
        // El orden importa por coste: primero la pregunta local (gratis) y solo
        // después la consulta a la base.
        if (!(await hasBiometricSensor()) || !alive) return;
        const existing = await listMyPasskeys(user.id);
        if (alive && existing.length === 0) setOpen(true);
      } catch {
        /* si no se puede comprobar, mejor no molestar */
      }
    }, DELAY_MS);

    return () => { alive = false; clearTimeout(timer); };
  }, [isAuthenticated, user?.id, profile]);

  const close = (permanent: boolean) => {
    if (permanent) dismissInvite();
    setOpen(false);
  };

  const activate = async () => {
    setBusy(true);
    try {
      await registerPasskey(user?.email);
      dismissInvite();
      setOpen(false);
      toast.success(t('passkey.added_title'), t('passkey.added_desc'));
    } catch (err) {
      const code = err instanceof PasskeyError ? err.code : 'failed';
      // Cancelar aquí no cierra la invitación: pudo ser un toque accidental.
      if (code === 'cancelled') return;
      if (code === 'already_registered') { dismissInvite(); setOpen(false); return; }
      toast.error(t('passkey.add_error'), t('passkey.err_failed'));
    } finally {
      setBusy(false);
    }
  };

  const perks = [
    { id: 'fast', icon: Zap, text: t('passkey.perk_fast') },
    { id: 'safe', icon: Fingerprint, text: t('passkey.perk_safe') },
    { id: 'nopwd', icon: Sparkles, text: t('passkey.perk_nopwd') },
  ];

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="passkey-invite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[90] flex items-end justify-center p-4 sm:items-center"
          style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(6px)' }}
          {...backdropDismiss(() => close(false))}
        >
          <motion.div
            initial={reduce ? undefined : { opacity: 0, y: 40, scale: 0.96 }}
            animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 20, scale: 0.97, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 240, damping: 26 }}
            className="relative w-full max-w-[420px] overflow-hidden rounded-[28px] border border-line bg-surface p-7 sm:p-8"
            style={{ boxShadow: '0 30px 90px rgb(0 0 0 / 0.35)' }}
          >
            {/* Halo de marca detrás del ícono. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full blur-3xl"
              style={{ background: `radial-gradient(circle, ${GREEN}33, transparent 70%)` }}
            />

            <button
              onClick={() => close(true)}
              className="absolute right-4 top-4 rounded-xl p-2 text-text-subtle transition-colors hover:bg-subtle hover:text-text"
              aria-label={t('common.close', 'Cerrar')}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative flex flex-col items-center text-center">
              <motion.div
                className="flex h-16 w-16 items-center justify-center rounded-3xl"
                style={{ background: `${GREEN}1A`, border: `1px solid ${GREEN}3D` }}
                animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Fingerprint className="h-8 w-8" style={{ color: GREEN }} />
              </motion.div>

              <h2 className="mt-5 text-[20px] font-bold tracking-[-0.02em] text-text">
                {t('passkey.invite_title')}
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
                {t('passkey.invite_desc')}
              </p>

              <ul className="mt-6 w-full space-y-2.5 text-left">
                {perks.map(({ id, icon: Icon, text }) => (
                  <li key={id} className="flex items-center gap-3 rounded-2xl border border-line bg-bg/40 px-4 py-3">
                    <Icon className="h-4 w-4 flex-shrink-0" style={{ color: id === 'safe' ? MAGENTA : GREEN }} />
                    <span className="text-[13px] text-text">{text}</span>
                  </li>
                ))}
              </ul>

              <motion.button
                onClick={activate}
                disabled={busy}
                whileHover={busy || reduce ? undefined : { scale: 1.02 }}
                whileTap={busy || reduce ? undefined : { scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                className="mt-6 flex w-full items-center justify-center gap-2 font-semibold text-black disabled:opacity-50"
                style={{ background: GREEN, borderRadius: 16, padding: '14px 20px', fontSize: 15 }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanFace className="h-[18px] w-[18px]" />}
                {t('passkey.invite_cta')}
              </motion.button>

              <button
                onClick={() => close(true)}
                className="mt-3 text-[12.5px] text-text-subtle transition-colors hover:text-text-muted"
              >
                {t('passkey.invite_later')}
              </button>

              <p className="mt-4 text-[11.5px] leading-relaxed text-text-subtle">
                {t('passkey.invite_footnote')}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
