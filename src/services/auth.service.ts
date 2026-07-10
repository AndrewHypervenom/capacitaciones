import { supabase } from '@/lib/supabase'

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signUpWithEmail(email: string, password: string, displayName: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

export async function updateProfile(
  userId: string,
  updates: {
    display_name?: string | null
    country?: string | null
    language?: string | null
    avatar_url?: string | null
    phone?: string | null
    national_id?: string | null
    job_title?: string | null
    bio?: string | null
  },
) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

// Un avatar se muestra a lo sumo a ~96px; guardar el original (hasta 3 MB) hace
// que cada carga de la lista de usuarios descargue megas inútiles. Reescalamos a
// 256px y comprimimos a JPEG antes de subir → normalmente 15–40 KB por foto.
export const AVATAR_MAX_PX = 256
const AVATAR_QUALITY = 0.82

/**
 * Reescala una imagen (File o Blob) a 256px máx. y la comprime a JPEG. Devuelve el
 * blob optimizado, o el original si no se puede rasterizar o no se reduce el peso.
 * Se reutiliza tanto en la subida normal como en la recompresión masiva.
 */
export async function downscaleImage(file: Blob): Promise<Blob> {
  // GIF/SVG no conviene rasterizarlos (perderían animación/vector): se dejan igual.
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, AVATAR_MAX_PX / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/jpeg', AVATAR_QUALITY),
    )
    // Si el reescalado no reduce el peso, nos quedamos con el original.
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file // navegador sin soporte o formato raro (HEIC, etc.) → original
  }
}

// Sube la foto de perfil al bucket `avatars` bajo la carpeta del propio usuario
// (`<uid>/...`, requisito de las políticas RLS) y devuelve la URL pública.
// La imagen se optimiza en el cliente y se cachea 1 año (el nombre es único por
// timestamp, así que es seguro tratarla como inmutable).
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const optimized = await downscaleImage(file)
  const isJpeg = optimized.type === 'image/jpeg'
  const ext = isJpeg ? 'jpg' : (file.name.split('.').pop() ?? 'jpg').toLowerCase()
  const path = `${userId}/avatar-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, optimized, {
      contentType: optimized.type || file.type,
      upsert: true,
      cacheControl: '31536000', // 1 año
    })
  if (error) throw error
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

// Cambia la contraseña del usuario autenticado vía Supabase Auth.
export async function changePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}
