import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Fingerprint, Loader2, ArrowRight } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { toast } from '@/stores/toastStore';
import {
  PasskeyError, hasBiometricSensor, listMyPasskeys, registerPasskey, supportsPasskeys,
} from '@/services/passkeys.service';

const GREEN = '#10D451';
const MAGENTA = '#B33D9E';

interface Props {
  userId: string;
  email?: string | null;
  /** Se avisa al activar, para que la lista de dispositivos se refresque. */
  onActivated?: () => void;
}

/**
 * Llamado a la acción para activar la huella, en un sitio que no se pueda pasar
 * por alto: arriba del perfil, antes de las pestañas.
 *
 * Existe porque la invitación post-login se ofrece UNA sola vez —y así debe
 * ser, nadie quiere que le insistan cada día—, pero eso dejaba a quien dijo
 * "ahora no" sin un camino visible de vuelta. Esta tarjeta es ese camino.
 *
 * Desaparece sola en cuanto hay al menos un dispositivo activado: cumplida su
 * función, estorba.
 */
export function PasskeySetupCard({ userId, email, onActivated }: Props) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (!supportsPasskeys()) return;
    try {
      // Se piden las dos cosas antes de mostrar nada: que el equipo tenga
      // sensor y que la persona no tenga ya un dispositivo activado.
      const [sensor, existing] = await Promise.all([
        hasBiometricSensor(),
        listMyPasskeys(userId),
      ]);
      setShow(sensor && existing.length === 0);
    } catch {
      setShow(false);
    }
  }, [userId]);

  useEffect(() => { check(); }, [check]);

  const activate = async () => {
    setBusy(true);
    try {
      await registerPasskey(email);
      setShow(false);
      onActivated?.();
      toast.success(t('passkey.added_title'), t('passkey.added_desc'));
    } catch (err) {
      const code = err instanceof PasskeyError ? err.code : 'failed';
      if (code === 'cancelled') return;
      if (code === 'already_registered') { setShow(false); onActivated?.(); return; }
      toast.error(t('passkey.add_error'), t('passkey.err_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={reduce ? undefined : { opacity: 0, y: -8 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.25 } }}
          className="mt-6 overflow-hidden rounded-3xl border p-5 sm:p-6"
          style={{
            borderColor: `${GREEN}40`,
            background: `linear-gradient(120deg, ${GREEN}12, transparent 55%, ${MAGENTA}0F)`,
          }}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl"
                style={{ background: `${GREEN}1F`, border: `1px solid ${GREEN}3D` }}
              >
                <motion.span
                  animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ color: GREEN, display: 'inline-flex' }}
                >
                  <Fingerprint className="h-5 w-5" />
                </motion.span>
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-text">{t('passkey.invite_title')}</h3>
                <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-text-muted">
                  {t('passkey.invite_desc')}
                </p>
              </div>
            </div>

            <motion.button
              onClick={activate}
              disabled={busy}
              whileHover={busy || reduce ? undefined : { scale: 1.03 }}
              whileTap={busy || reduce ? undefined : { scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              className="flex flex-shrink-0 items-center justify-center gap-2 font-semibold text-black disabled:opacity-50"
              style={{ background: GREEN, borderRadius: 14, padding: '12px 22px', fontSize: 14.5 }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
              {t('passkey.invite_cta')}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
