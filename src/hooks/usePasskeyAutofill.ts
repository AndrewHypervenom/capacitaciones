import { useEffect } from 'react';
import { WebAuthnAbortService } from '@simplewebauthn/browser';
import { signInWithPasskey, supportsAutofill, supportsPasskeys } from '@/services/passkeys.service';

/**
 * Autocompletado con passkey ("conditional UI") en el campo de correo.
 *
 * Es el detalle que separa un login correcto de uno que se siente mágico: en
 * vez de obligar a pulsar un botón, la passkey aparece dentro de la lista de
 * sugerencias del propio campo. En iOS basta tocar el campo y mirar el
 * teléfono; en Windows, elegir la cuenta y poner el dedo.
 *
 * Requisitos que hay que respetar o el navegador lo ignora en silencio:
 *   · el input debe declarar `autoComplete="username webauthn"`,
 *   · la ceremonia se abre UNA vez, al montar, y queda esperando,
 *   · debe cancelarse al desmontar, o queda una ceremonia huérfana que hace
 *     fallar al siguiente intento con "operación ya en curso".
 *
 * Todo fallo aquí es deliberadamente silencioso: esto es un atajo opcional,
 * y quien no lo use ni se entera de que existía.
 */
export function usePasskeyAutofill(enabled: boolean, onSuccess: () => void) {
  useEffect(() => {
    if (!enabled || !supportsPasskeys()) return;
    let alive = true;

    (async () => {
      if (!(await supportsAutofill()) || !alive) return;
      try {
        await signInWithPasskey({ useAutofill: true });
        if (alive) onSuccess();
      } catch {
        /* cancelado, sin credenciales o sin red: el formulario sigue ahí */
      }
    })();

    return () => {
      alive = false;
      // Cierra la ceremonia pendiente. Sin esto, volver a la pantalla de
      // ingreso deja al navegador creyendo que ya hay una en curso.
      WebAuthnAbortService.cancelCeremony();
    };
  }, [enabled, onSuccess]);
}
