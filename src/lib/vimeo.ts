// Utilidades compartidas para Vimeo: extracción de ID y carga del Player SDK.
// Espejo de src/lib/youtube.ts — se usa para el embed pasivo (MediaUploader) y para
// el video interactivo con quizzes (InteractiveVideoModule / VideoMarkerEditor).
// El valor guardado en BD es "123456789" o "123456789/abcdef" (videos no listados,
// que llevan un hash de acceso después del ID numérico).

/** Extrae el ID (y hash de video no listado, si existe) desde una URL de Vimeo o el ID pelado. */
export function extractVimeoId(input: string): string | null {
  const s = input.trim()
  const patterns = [
    // vimeo.com/123456789  |  vimeo.com/123456789/abcdef12 (no listado)
    /vimeo\.com\/(\d{6,12})(?:\/([a-zA-Z0-9]+))?/,
    // player.vimeo.com/video/123456789?h=abcdef12
    /player\.vimeo\.com\/video\/(\d{6,12})(?:\?.*?h=([a-zA-Z0-9]+))?/,
    // ID pelado, con o sin hash
    /^(\d{6,12})(?:\/([a-zA-Z0-9]+))?$/,
  ]
  for (const p of patterns) {
    const m = s.match(p)
    if (m) return m[2] ? `${m[1]}/${m[2]}` : m[1]
  }
  return null
}

/** Construye la URL del iframe de embed a partir del valor guardado ("id" o "id/hash"). */
export function vimeoEmbedUrl(stored: string, extraParams = ''): string {
  const [id, hash] = stored.split('/')
  const params = [hash ? `h=${hash}` : '', 'dnt=1', extraParams].filter(Boolean).join('&')
  return `https://player.vimeo.com/video/${id}${params ? `?${params}` : ''}`
}

let sdkPromise: Promise<void> | null = null

/** Carga el Player SDK de Vimeo una sola vez y resuelve cuando `window.Vimeo.Player` está listo. */
export function loadVimeoPlayerAPI(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (w.Vimeo && w.Vimeo.Player) return Promise.resolve()
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src="https://player.vimeo.com/api/player.js"]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => { sdkPromise = null; reject(new Error('vimeo sdk load failed')) })
      return
    }
    const tag = document.createElement('script')
    tag.src = 'https://player.vimeo.com/api/player.js'
    tag.onload = () => resolve()
    tag.onerror = () => { sdkPromise = null; reject(new Error('vimeo sdk load failed')) }
    document.head.appendChild(tag)
  })
  return sdkPromise
}
