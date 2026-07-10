import { supabase } from '@/lib/supabase'
import { downscaleImage } from './auth.service'

export interface RecompressProgress {
  total: number
  done: number
  optimized: number
  skipped: number
  failed: number
  bytesSaved: number
}

/** Extrae la ruta dentro del bucket `avatars` a partir de la URL pública. */
function objectPathFromPublicUrl(url: string): string | null {
  const marker = '/object/public/avatars/'
  const i = url.indexOf(marker)
  if (i === -1) return null
  return decodeURIComponent(url.slice(i + marker.length).split('?')[0])
}

// Si el reprocesado no ahorra al menos esto, no vale la pena re-subir.
const MIN_SAVING_BYTES = 5 * 1024

/**
 * Recompresión masiva de avatares existentes (solo superadmin). Por cada perfil
 * con foto: la descarga (bucket público), la reescala/comprime en el navegador,
 * sube la versión liviana, apunta el perfil a la nueva URL y borra el archivo
 * viejo para liberar el storage Free (50 MB).
 *
 * Requiere las políticas RLS de superadmin (UPDATE en profiles + escritura en el
 * bucket avatars) del SQL `2026-07-10_superadmin_edit_profiles.sql`.
 */
export async function recompressAllAvatars(
  onProgress?: (p: RecompressProgress) => void,
): Promise<RecompressProgress> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, avatar_url')
    .not('avatar_url', 'is', null)
  if (error) throw error

  const rows = (data ?? []) as { id: string; avatar_url: string }[]
  const p: RecompressProgress = {
    total: rows.length, done: 0, optimized: 0, skipped: 0, failed: 0, bytesSaved: 0,
  }
  onProgress?.({ ...p })

  for (const row of rows) {
    try {
      const oldPath = objectPathFromPublicUrl(row.avatar_url)
      const res = await fetch(row.avatar_url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const original = await res.blob()
      const optimized = await downscaleImage(original)

      if (optimized.size >= original.size - MIN_SAVING_BYTES) {
        p.skipped++ // ya está optimizada o el ahorro es marginal
      } else {
        const newPath = `${row.id}/avatar-${Date.now()}.jpg`
        const up = await supabase.storage.from('avatars').upload(newPath, optimized, {
          contentType: 'image/jpeg',
          upsert: true,
          cacheControl: '31536000',
        })
        if (up.error) throw up.error
        const url = supabase.storage.from('avatars').getPublicUrl(newPath).data.publicUrl
        const upd = await supabase.from('profiles').update({ avatar_url: url }).eq('id', row.id)
        if (upd.error) throw upd.error
        // Liberar el archivo viejo (si la ruta cambió).
        if (oldPath && oldPath !== newPath) {
          await supabase.storage.from('avatars').remove([oldPath]).catch(() => {})
        }
        p.optimized++
        p.bytesSaved += original.size - optimized.size
      }
    } catch {
      p.failed++
    } finally {
      p.done++
      onProgress?.({ ...p })
    }
  }
  return p
}
