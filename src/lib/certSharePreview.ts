import type { PublicCertificateModule } from '@/types/database'

/* ────────────────────────────────────────────────────────────────────────────
   Puente entre el editor de curso y la vista previa del certificado compartido.

   El capacitador pulsa "Ver cómo se comparte" y se abre una PESTAÑA NUEVA con
   la página pública de verdad (`/verify/preview`), no con una maqueta: la única
   forma de que la vista previa no mienta es que sea la misma página.

   El borrador que está editando todavía no existe en la base de datos, así que
   viaja por `localStorage` —no por `sessionStorage`: su clonado al abrir una
   pestaña depende del navegador, y aquí un fallo se ve como "no encontrado".
   La foto es de un solo curso a la vez y se sobrescribe en cada vista previa.
   ──────────────────────────────────────────────────────────────────────────── */

const KEY = 'learningai.cert-share-preview'
/** Una foto vieja no sirve para nada: el curso ya cambió. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface CertSharePreview {
  savedAt: number
  courseId: string
  courseTitle: string
  courseDescription: string | null
  /** Nombre que se imprime en el diploma de ejemplo (el del capacitador). */
  learnerName: string
  modules: PublicCertificateModule[]
}

/** Guarda el borrador y devuelve la URL que hay que abrir. */
export function writeCertSharePreview(data: Omit<CertSharePreview, 'savedAt'>): string {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: Date.now() }))
  } catch {
    /* almacenamiento lleno o bloqueado: la página avisará que no hay borrador */
  }
  return `${window.location.origin}/verify/preview`
}

/** Lee el borrador. `null` si no hay, está corrupto o ya caducó. */
export function readCertSharePreview(): CertSharePreview | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as CertSharePreview
    if (!data?.courseId || !Array.isArray(data.modules)) return null
    if (Date.now() - (data.savedAt ?? 0) > MAX_AGE_MS) return null
    return data
  } catch {
    return null
  }
}
