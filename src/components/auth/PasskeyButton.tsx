import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Fingerprint, Loader2, ShieldCheck } from 'lucide-react';
import {
  PasskeyError, hasBiometricSensor, passkeyHint, signInWithPasskey, supportsPasskeys,
} from '@/services/passkeys.service';

const GREEN = '#10D451';
const MAGENTA = '#B33D9E';

interface Props {
  /** Correo escrito en el formulario: acota las credenciales candidatas. */
  email?: string;
  /** Se dispara cuando la sesión ya quedó abierta. */
  onSuccess?: () => void;
  /** El motivo del fallo, ya traducido, para mostrarlo donde convenga. */
  onError?: (message: string | null) => void;
  /**
   * Pide la huella sola, sin esperar el clic, cuando este dispositivo ya tiene
   * una registrada. Es la diferencia entre "entrar" y "pedir permiso para
   * entrar": si la persona ya dijo que confía en este equipo, volver a
   * obligarla a pulsar un botón es hacerle repetir una decisión que ya tomó.
   */
  autoStart?: boolean;
}

/**
 * Botón "Entrar con huella / Face ID".
 *
 * Solo aparece si el dispositivo tiene sensor biométrico. Es una decisión de
 * producto: un botón que promete huella en un equipo sin lector no es una
 * opción, es una frustración. Cuando este dispositivo ya registró una passkey
 * (pista local) el botón toma el papel protagonista; si no, se ofrece discreto.
 */
export function PasskeyButton({ email, onSuccess, onError, autoStart = false }: Props) {
  const { t } = useTranslation();
  const reduce = !!useReducedMotion();
  const [available, setAvailable] = useState(false);
  // Arranca en "ocupado" cuando va a pedirse sola: así no se ve un parpadeo del
  // botón en reposo justo antes de que el sistema abra su diálogo.
  const [busy, setBusy] = useState(autoStart && !!passkeyHint());
  const hint = passkeyHint();
  const autoRan = useRef(false);
  /** Ceremonia realmente en curso (distinto de lo que muestra el botón). */
  const running = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!supportsPasskeys()) return;
    hasBiometricSensor().then((ok) => { if (alive) setAvailable(ok); });
    return () => { alive = false; };
  }, []);

  // El botón destaca cuando sabemos que aquí hay una huella registrada; en
  // cualquier otro equipo se ofrece como alternativa, sin robarle protagonismo
  // a la contraseña.
  const primary = !!hint;

  const messageFor = (code: PasskeyError['code']): string | null => {
    switch (code) {
      // Cancelar no es un error: la persona cambió de opinión y ya lo sabe.
      // Salvo en un caso: si en este equipo nunca se activó nada, lo que acaba
      // de cerrar es el diálogo del sistema ofreciéndole su celular o una llave
      // USB, y muy probablemente no entendió por qué. Ahí sí hay que explicar.
      case 'cancelled': return primary ? null : t('passkey.err_no_credential');
      case 'no_credential': return t('passkey.err_no_credential');
      case 'expired_challenge': return t('passkey.err_expired');
      case 'inactive_account': return t('welcome.error_inactive');
      case 'rate_limited': return t('passkey.err_rate_limited');
      case 'unsupported': return t('passkey.err_unsupported');
      default: return t('passkey.err_failed');
    }
  };

  const handle = async () => {
    // El guardia NO puede ser `busy`: esa bandera nace en true a propósito
    // (para que el botón no parpadee antes del arranque automático), así que
    // usarla aquí hacía que la primera llamada se bloqueara a sí misma y la
    // pantalla se quedara para siempre en "Esperando tu huella…" sin pedir
    // nada. Lo que manda es si hay una ceremonia de verdad en curso.
    if (running.current) return;
    running.current = true;
    setBusy(true);
    onError?.(null);
    try {
      await signInWithPasskey({ email: email?.trim() || hint || undefined });
      onSuccess?.();
    } catch (err) {
      const code = err instanceof PasskeyError ? err.code : 'failed';
      onError?.(messageFor(code));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  // Arranque automático: una sola vez, y solo si este equipo ya tiene una
  // huella registrada. `autoRan` es lo que impide el bucle infernal —cancelar
  // el diálogo y que vuelva a abrirse— que convertiría la pantalla de ingreso
  // en una trampa de la que no se puede salir.
  useEffect(() => {
    if (!autoStart || !available || !hint || autoRan.current) return;
    autoRan.current = true;
    handle();
    // `handle` se recrea en cada render; el guard de arriba es quien manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, available, hint]);

  if (!available) {
    return null;
  }

  return (
    <div className="w-full">
      {/* Separador: deja claro que es otro camino, no otro campo del formulario. */}
      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1" style={{ background: 'rgb(var(--line))' }} />
        <span
          className="text-[10.5px] font-medium uppercase"
          style={{ color: 'rgb(var(--text-subtle))', letterSpacing: '0.14em' }}
        >
          {t('passkey.divider')}
        </span>
        <span className="h-px flex-1" style={{ background: 'rgb(var(--line))' }} />
      </div>

      <motion.button
        type="button"
        onClick={handle}
        disabled={busy}
        whileHover={busy || reduce ? undefined : { scale: 1.015 }}
        whileTap={busy || reduce ? undefined : { scale: 0.975 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        className="group relative flex w-full items-center justify-center gap-2.5 overflow-hidden font-semibold disabled:cursor-not-allowed"
        style={{
          borderRadius: 14,
          padding: '13px 20px',
          fontSize: 14.5,
          color: primary ? 'rgb(var(--text))' : 'rgb(var(--text-muted))',
          background: primary
            ? 'linear-gradient(135deg, rgba(16,212,81,0.10), rgba(179,61,158,0.08))'
            : 'rgb(var(--surface))',
          border: `1px solid ${primary ? `${GREEN}55` : 'rgb(var(--line))'}`,
        }}
      >
        {/* Barrido de luz al pasar el cursor: el mismo gesto de "escaneo" que
            hace el sensor. Puramente decorativo y sin coste cuando no se usa. */}
        {!reduce && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full opacity-0 transition-all duration-700 group-hover:translate-x-full group-hover:opacity-100"
            style={{ background: `linear-gradient(90deg, transparent, ${GREEN}22, transparent)` }}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {busy ? (
            <motion.span
              key="busy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative z-10 flex items-center gap-2.5"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('passkey.waiting')}
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative z-10 flex items-center gap-2.5"
            >
              <motion.span
                animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                style={{ color: primary ? GREEN : 'inherit', display: 'inline-flex' }}
              >
                <Fingerprint className="h-[18px] w-[18px]" />
              </motion.span>
              {t('passkey.sign_in')}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {primary && (
        <p
          className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11.5px]"
          style={{ color: 'rgb(var(--text-subtle))' }}
        >
          <ShieldCheck className="h-3.5 w-3.5" style={{ color: MAGENTA }} />
          {t('passkey.hint_device', { email: hint })}
        </p>
      )}
    </div>
  );
}
