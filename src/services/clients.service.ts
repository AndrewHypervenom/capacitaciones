import { supabase } from '@/lib/supabase'

/* ─── Clientes ─────────────────────────────────────────────────────────────
 *
 * Un CLIENTE es alguien de FUERA y DE PASO: entra a conocer el sitio con un
 * curso suelto que se le asigna. No es plantilla, y por eso:
 *   · no le llega ningún curso por regla de país/área/CR, ni «toda la organización»
 *   · no ve el catálogo abierto ni puede auto-inscribirse
 *   · no cuenta para ningún indicador
 *
 * La marca vive en `profiles.is_client` y es GLOBAL: no es una propiedad de la
 * asignación a un curso, sino de la persona. Por eso marcarla desde el editor
 * de un curso pide confirmación — cambia lo que esa persona recibe en todo el
 * sitio, no solo aquí.
 *
 * Quién puede: superadmin o capacitador con permiso de altas. Lo impone el
 * trigger `guard_is_client` en la base (SQL 35); la interfaz solo evita ofrecer
 * un botón que la base va a rechazar.
 */

/** Marca o desmarca a alguien como persona de un cliente. */
export async function setUserIsClient(
  userId: string,
  isClient: boolean,
  clientName?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      is_client: isClient,
      // Al desmarcar se borra el nombre: dejarlo puesto en alguien que ya no es
      // cliente es un dato que miente en la siguiente pantalla que lo lea.
      client_name: isClient ? (clientName?.trim() || null) : null,
    })
    .eq('id', userId)
  if (error) throw error
}
