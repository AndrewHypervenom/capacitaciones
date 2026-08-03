import type { ReactNode } from 'react';

/**
 * Ranura fija para los avisos flotantes centrados abajo (estado del servicio,
 * "hay versión nueva"). Antes cada uno traía su propio `fixed bottom-6`, así
 * que si coincidían quedaban uno encima del otro; aquí se apilan en columna.
 *
 * El contenedor no captura clics (`pointer-events-none`); cada aviso los
 * recupera con `pointer-events-auto`. Cuando no hay ninguno visible, la columna
 * queda vacía y no estorba.
 */
export function BottomBannerStack({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[10000] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col items-stretch gap-2.5">
      {children}
    </div>
  );
}

export default BottomBannerStack;
