import { useEffect, useState } from 'react';
import { detectDeviceKind, type DeviceKind } from '@/lib/device';

/**
 * Qué aparato es (ver `lib/device`). Se vuelve a mirar si cambia el puntero —un
 * convertible al que le acoplan el teclado— o si giran la pantalla, así nadie se
 * queda con una pantalla de bloqueo que ya no le corresponde.
 */
export function useDeviceKind(): DeviceKind {
  const [kind, setKind] = useState<DeviceKind>(() => detectDeviceKind());

  useEffect(() => {
    const check = () => setKind(detectDeviceKind());
    const mq = window.matchMedia('(any-pointer: fine)');
    mq.addEventListener('change', check);
    window.addEventListener('orientationchange', check);
    return () => {
      mq.removeEventListener('change', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  return kind;
}

/** Atajo: ¿está en un computador? */
export function useIsDesktop(): boolean {
  return useDeviceKind() === 'desktop';
}
