import { recompressSiteImages, type SiteImageProgress } from './mediaMaintenance'

export type RecompressProgress = SiteImageProgress

/**
 * Recompresión masiva de las fotos de perfil existentes (botón de la pantalla
 * de Usuarios). Es el barrido de `mediaMaintenance` restringido a los avatares:
 * misma mecánica —bajar, reescalar a 256px, subir la liviana, repuntar el
 * perfil y liberar el archivo viejo—, una sola implementación.
 *
 * Requiere las políticas RLS de superadmin (UPDATE en profiles + escritura en
 * el bucket avatars) del SQL `2026-07-10_superadmin_edit_profiles.sql`.
 */
export async function recompressAllAvatars(
  onProgress?: (p: RecompressProgress) => void,
): Promise<RecompressProgress> {
  return recompressSiteImages(['avatars'], onProgress)
}
