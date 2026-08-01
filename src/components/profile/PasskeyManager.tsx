import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Check, Cloud, Fingerprint, KeyRound, Laptop, Loader2, Pencil, Plus, Smartphone,
  Trash2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { toast } from '@/stores/toastStore';
import {
  PasskeyError, deletePasskey, forgetPasskeyHint, hasBiometricSensor, listMyPasskeys,
  passkeyHint, registerPasskey, renamePasskey, supportsPasskeys,
} from '@/services/passkeys.service';
import type { UserPasskey } from '@/types/database';

const GREEN = '#10D451';
const MAGENTA = '#B33D9E';

interface Props {
  userId: string;
  email?: string | null;
  /** Modo revisión (el superadmin mirando a otra persona): solo revocar. */
  manageOnly?: boolean;
}

/** Ícono según cómo se conecta el autenticador; el detalle que lo hace legible. */
function deviceIcon(pk: UserPasskey) {
  const transports = pk.transports ?? [];
  if (transports.includes('hybrid')) return Smartphone;
  if (transports.includes('usb') || transports.includes('nfc') || transports.includes('ble')) {
    return KeyRound;
  }
  return /iphone|ipad|android|móvil|movil/i.test(pk.device_name ?? '') ? Smartphone : Laptop;
}

/**
 * "Ingreso biométrico": alta y baja de los dispositivos que pueden entrar con
 * huella, Face ID o Windows Hello.
 *
 * Cada fila es un dispositivo, no una sesión: borrar uno no cierra nada, solo
 * retira el permiso de volver a entrar así desde ese equipo.
 */
export function PasskeyManager({ userId, email, manageOnly = false }: Props) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const reduce = useReducedMotion();

  const [items, setItems] = useState<UserPasskey[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [canRegister, setCanRegister] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await listMyPasskeys(userId));
    } catch {
      /* la RLS ya decide quién puede ver qué; una lista vacía es respuesta suficiente */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (manageOnly || !supportsPasskeys()) return;
    let alive = true;
    hasBiometricSensor().then((ok) => { if (alive) setCanRegister(ok); });
    return () => { alive = false; };
  }, [manageOnly]);

  const handleRegister = async () => {
    // Antes el botón se quedaba deshabilitado y en gris cuando el equipo no
    // tenía sensor, sin decir por qué: desde fuera eso no se lee como "aquí no
    // se puede", se lee como "está roto". Ahora se pulsa y se explica.
    if (!canRegister) {
      toast.info(t('passkey.section_title'), t('passkey.no_sensor'));
      return;
    }
    setRegistering(true);
    try {
      await registerPasskey(email);
      await load();
      toast.success(t('passkey.added_title'), t('passkey.added_desc'));
    } catch (err) {
      const code = err instanceof PasskeyError ? err.code : 'failed';
      if (code === 'cancelled') return; // se arrepintió: no hay nada que informar
      if (code === 'already_registered') {
        toast.info(t('passkey.already_title'), t('passkey.already_desc'));
        return;
      }
      toast.error(t('passkey.add_error'), t(`passkey.err_${code === 'unsupported' ? 'unsupported' : 'failed'}`));
    } finally {
      setRegistering(false);
    }
  };

  const handleRename = async (pk: UserPasskey) => {
    const name = draftName.trim();
    setEditing(null);
    if (!name || name === pk.device_name) return;
    setItems((list) => list.map((i) => (i.id === pk.id ? { ...i, device_name: name } : i)));
    try {
      await renamePasskey(pk.id, name);
    } catch {
      toast.error(t('profile.save_error', 'No se pudo guardar'));
      load();
    }
  };

  const handleDelete = async (pk: UserPasskey) => {
    const ok = await confirm({
      title: t('passkey.remove_title'),
      description: t('passkey.remove_desc', { device: pk.device_name ?? t('passkey.unnamed') }),
      confirmLabel: t('passkey.remove_confirm'),
    });
    if (!ok) return;
    try {
      await deletePasskey(pk.id);
      setItems((list) => list.filter((i) => i.id !== pk.id));
      // Si este era el dispositivo recordado, el botón del login deja de
      // ofrecer un atajo que ya no existe.
      if (!manageOnly && passkeyHint() && items.length <= 1) forgetPasskeyHint();
      toast.success(t('passkey.removed'));
    } catch (err) {
      toast.error(t('profile.save_error', 'No se pudo guardar'), (err as Error).message);
    }
  };

  const fmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface">
      {/* Cabecera con el degradado de marca: da jerarquía sin gritar. */}
      <div
        className="relative flex flex-col gap-4 border-b border-line p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"
        style={{ background: `linear-gradient(120deg, ${GREEN}0F, transparent 45%, ${MAGENTA}0D)` }}
      >
        <div className="flex items-start gap-4">
          <div
            className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl"
            style={{ background: `${GREEN}1A`, border: `1px solid ${GREEN}33` }}
          >
            <motion.span
              animate={reduce ? undefined : { scale: [1, 1.09, 1] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{ color: GREEN, display: 'inline-flex' }}
            >
              <Fingerprint className="h-6 w-6" />
            </motion.span>
          </div>
          <div>
            <h2 className="text-[16px] font-semibold text-text">
              {t(manageOnly ? 'passkey.admin_title' : 'passkey.section_title')}
            </h2>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-text-muted">
              {t(manageOnly ? 'passkey.admin_desc' : 'passkey.section_desc')}
            </p>
          </div>
        </div>

        {!manageOnly && (
          <Button onClick={handleRegister} disabled={registering} className="flex-shrink-0">
            {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('passkey.add_device')}
          </Button>
        )}
      </div>

      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-[72px] animate-pulse rounded-2xl border border-line bg-subtle/50" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState canRegister={canRegister || manageOnly} manageOnly={manageOnly} />
        ) : (
          <ul className="space-y-2.5">
            <AnimatePresence initial={false}>
              {items.map((pk) => {
                const Icon = deviceIcon(pk);
                return (
                  <motion.li
                    key={pk.id}
                    layout={!reduce}
                    initial={reduce ? undefined : { opacity: 0, y: 10 }}
                    animate={reduce ? undefined : { opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, x: -12, transition: { duration: 0.18 } }}
                    className="group flex items-center gap-4 rounded-2xl border border-line bg-bg/40 p-4 transition-colors hover:border-brand-green/40"
                  >
                    <div
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-text-muted"
                      style={{ background: 'rgb(var(--subtle))' }}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </div>

                    <div className="min-w-0 flex-1">
                      {editing === pk.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(pk);
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            className="h-9 text-[14px]"
                          />
                          <button
                            onClick={() => handleRename(pk)}
                            className="rounded-lg p-1.5 text-brand-green hover:bg-subtle"
                            aria-label={t('common.save', 'Guardar')}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="rounded-lg p-1.5 text-text-subtle hover:bg-subtle"
                            aria-label={t('confirm.cancel', 'Cancelar')}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="truncate text-[14.5px] font-semibold text-text">
                            {pk.device_name ?? t('passkey.unnamed')}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-subtle">
                            <span>{t('passkey.added_on', { date: fmt(pk.created_at) })}</span>
                            {pk.last_used_at && (
                              <>
                                <span aria-hidden>·</span>
                                <span>{t('passkey.last_used', { date: fmt(pk.last_used_at) })}</span>
                              </>
                            )}
                            {/* Sincronizada = si pierde el equipo, la passkey
                                sigue viva en su llavero. Vale la pena decirlo:
                                cambia por completo qué pasa si se le daña. */}
                            {pk.backed_up && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                                style={{ background: `${MAGENTA}18`, color: MAGENTA }}
                              >
                                <Cloud className="h-3 w-3" />
                                {t('passkey.synced')}
                              </span>
                            )}
                          </p>
                        </>
                      )}
                    </div>

                    {editing !== pk.id && (
                      <div className="flex flex-shrink-0 items-center gap-1">
                        {!manageOnly && (
                          <button
                            onClick={() => { setEditing(pk.id); setDraftName(pk.device_name ?? ''); }}
                            className="rounded-lg p-2 text-text-subtle opacity-0 transition-opacity hover:bg-subtle hover:text-text focus:opacity-100 group-hover:opacity-100"
                            aria-label={t('passkey.rename')}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(pk)}
                          className="rounded-lg p-2 text-text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                          aria-label={t('passkey.remove_confirm')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyState({ canRegister, manageOnly }: { canRegister: boolean; manageOnly: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <Fingerprint className="mx-auto h-8 w-8 text-text-subtle/60" />
      <p className="mt-3 text-[14px] font-medium text-text">
        {manageOnly ? t('passkey.empty_other') : t('passkey.empty_title')}
      </p>
      {!manageOnly && (
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-text-muted">
          {canRegister ? t('passkey.empty_desc') : t('passkey.no_sensor')}
        </p>
      )}
    </div>
  );
}
