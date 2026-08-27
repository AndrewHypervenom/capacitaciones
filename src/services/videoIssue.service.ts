import { submitSiteFeedback } from '@/services/siteFeedback.service'
import type { VideoPlayerError } from '@/lib/videoError'

/**
 * Reporta un video que no se pudo reproducir.
 *
 * Va por la bandeja de opiniones que ya existe (`site_feedback`, tipo `bug`) en
 * lugar de una tabla nueva: así el aviso al staff, el hilo de respuesta y la
 * bandeja de /admin funcionan igual que con cualquier otro reporte, y esto no
 * necesita SQL para entrar en producción.
 *
 * Es lo que el botón "enviar registro de errores" de Vimeo NO hace: aquel manda
 * el diagnóstico a la telemetría de Vimeo y a nosotros no nos llega nada.
 */
export interface VideoIssueContext {
  err: VideoPlayerError
  /** Título de la sección donde estaba el video: es lo que el staff reconoce. */
  sectionTitle?: string | null
  /** Identidad de la sección, para dar con el bloque exacto. */
  sectionId?: string | null
  /** El ID/URL guardado del video. Con esto se verifica el video en el proveedor. */
  videoUrl?: string | null
  /** Segundo en el que se cayó: distingue "nunca cargó" de "se cortó a la mitad". */
  atSeconds?: number | null
  lang: string
  page: string
  pageLabel: string
}

export async function reportVideoIssue(ctx: VideoIssueContext): Promise<void> {
  const { err } = ctx
  await submitSiteFeedback({
    kind: 'bug',
    mood: null,
    ease: null,
    // No hay zona "video"; el video siempre vive dentro de un módulo.
    areas: ['modules'],
    // Estructurado además del mensaje: la bandeja los muestra como filas y se
    // pueden leer sin tener que parsear el texto.
    answers: {
      video_error_kind: err.kind,
      video_source: err.source,
      video_code: err.code,
      ...(err.raw ? { video_message: err.raw } : {}),
      ...(ctx.videoUrl ? { video_ref: ctx.videoUrl } : {}),
      ...(ctx.sectionId ? { section_id: ctx.sectionId } : {}),
      ...(ctx.sectionTitle ? { section_title: ctx.sectionTitle } : {}),
      ...(ctx.atSeconds != null ? { video_at: String(Math.round(ctx.atSeconds)) } : {}),
    },
    message:
      `[Video] Fallo de reproducción (${err.source}/${err.kind}, ${err.code})` +
      (ctx.sectionTitle ? ` en «${ctx.sectionTitle}»` : '') +
      (ctx.videoUrl ? `\nVideo: ${ctx.videoUrl}` : '') +
      (ctx.atSeconds != null ? `\nSegundo: ${Math.round(ctx.atSeconds)}` : '') +
      (err.raw ? `\nDetalle: ${err.raw}` : '') +
      '\n\nReportado desde el aviso del reproductor.',
    // El reporte lo dispara el aprendiz con un botón, no un formulario: no hay
    // dónde pedirle datos de contacto y no vamos a inventárselos.
    contactOk: false,
    lang: ctx.lang,
    page: ctx.page,
    pageLabel: ctx.pageLabel,
  })
}
