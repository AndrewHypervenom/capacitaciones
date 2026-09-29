import type { TFunction } from 'i18next'
import { rowText } from '@/lib/contentLang'
import { stripMarkdown } from '@/components/ui/RichText'
import type { Sheet, SheetRow } from '@/lib/exportXlsx'
import { isAnswerCorrect, type ExamAttemptDetail } from '@/services/exams.admin.service'
import type { ExamQuestion } from '@/types/exam'

/* ── Detalle del examen final para Excel ──────────────────────────────────
 *
 * Las hojas con cada intento y cada respuesta —lo que marcó la persona y cuál
 * era la correcta— se arman aquí una sola vez y las usan las dos salidas: el
 * panel de resultados del editor del curso (un curso) y el tablero de Progreso
 * (varios cursos a la vez, con la columna Curso). Así el Excel de un lado nunca
 * trae menos detalle que el del otro. */

/** Cómo quedó una pregunta dentro de un intento. */
export type Verdict = 'correct' | 'wrong' | 'blank' | 'deleted'

export function verdictOf(q: ExamQuestion | undefined, marked: string[] | undefined): Verdict {
  if (!q) return 'deleted'
  if (!marked || marked.length === 0) return 'blank'
  return isAnswerCorrect(q, marked) ? 'correct' : 'wrong'
}

export const minutesBetween = (a: string, b: string | null) =>
  b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60_000)) : null

/** Textos de las opciones marcadas, separados por " | ". */
export function optionText(q: ExamQuestion, ids: string[]): string {
  return ids
    .map((id) => {
      const o = q.options.find((x) => x.id === id)
      return o ? stripMarkdown(rowText(o, 'text')) : id
    })
    .join(' | ')
}

export function verdictLabels(t: TFunction): Record<Verdict, string> {
  return {
    correct: t('admin.exam.v_correct', 'Correcta'),
    wrong: t('admin.exam.v_wrong', 'Incorrecta'),
    blank: t('admin.exam.v_blank', 'Sin responder'),
    deleted: t('admin.exam.v_deleted', 'Pregunta eliminada'),
  }
}

export function examDateFormatter(locale: string) {
  return (iso: string | null | undefined, withTime = true) =>
    iso
      ? new Date(iso).toLocaleString(locale, {
          day: 'numeric', month: 'short', year: 'numeric',
          ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
        })
      : ''
}

/** Un curso con sus intentos (ya filtrados a las personas que se exportan). */
export interface ExamExportCourse {
  courseTitle: string
  attempts: ExamAttemptDetail[]
  questions: Map<string, ExamQuestion>
  /** Nombres de temas de la configuración actual; si falta, se usan los que
      quedaron sellados en cada intento. */
  domainNames?: Map<string, string>
}

export interface ExamPerson {
  name: string
  email: string
}

/**
 * Hojas de detalle: Intentos, Por tema, Respuestas y Análisis por pregunta.
 * `withCourse` añade la columna Curso (hace falta cuando hay más de uno).
 */
export function buildExamDetailSheets(
  courses: ExamExportCourse[],
  people: Map<string, ExamPerson>,
  t: TFunction,
  locale: string,
  opts: { withCourse?: boolean } = {},
): { attempts: Sheet; domains: Sheet; answers: Sheet; analysis: Sheet } {
  const fmtDate = examDateFormatter(locale)
  const verdictLabel = verdictLabels(t)
  const C = {
    course: t('admin.exam.x_course', 'Curso'),
    person: t('admin.exam.x_person', 'Persona'),
    email: t('admin.exam.x_email', 'Correo'),
    attempt: t('admin.exam.x_attempt', 'Intento'),
    yes: t('admin.exam.x_yes', 'Sí'),
    no: t('admin.exam.x_no', 'No'),
  }
  const kindLabel: Record<string, string> = {
    single: t('admin.exam.x_kind_single', 'Una respuesta'),
    multi: t('admin.exam.x_kind_multi', 'Varias respuestas'),
    true_false: t('admin.exam.x_kind_tf', 'Verdadero / falso'),
  }
  const levelLabel: Record<string, string> = {
    basico: t('admin.exam.x_level_basico', 'Básico'),
    medio: t('admin.exam.x_level_medio', 'Medio'),
    avanzado: t('admin.exam.x_level_avanzado', 'Avanzado'),
  }

  const attemptsRows: SheetRow[] = []
  const domainRows: SheetRow[] = []
  const answerRows: SheetRow[] = []
  const analysisRows: Array<{ rate: number; row: SheetRow }> = []

  for (const course of courses) {
    const lead = (userId: string): SheetRow => {
      const p = people.get(userId)
      return {
        ...(opts.withCourse ? { [C.course]: course.courseTitle } : {}),
        [C.person]: p?.name ?? '',
        [C.email]: p?.email ?? '',
      }
    }
    const names = new Map<string, string>()
    for (const a of course.attempts) for (const d of a.domain_scores) names.set(d.domain_id, rowText(d, 'name'))
    for (const [id, n] of course.domainNames ?? []) names.set(id, n)
    const domainName = (id: string | null | undefined) => (id ? names.get(id) ?? '' : '')

    /* Análisis por pregunta: la pregunta que casi todos fallan suele decir
       más del curso (o de la pregunta) que de las personas. */
    const perQuestion = new Map<string, { seen: number; right: number; wrong: Map<string, number> }>()

    for (const a of course.attempts) {
      const ok = a.question_ids.filter((id) => {
        const q = course.questions.get(id)
        return q && isAnswerCorrect(q, a.answers[id])
      }).length
      const blank = a.question_ids.filter((id) => !(a.answers[id]?.length)).length
      attemptsRows.push({
        ...lead(a.user_id),
        [C.attempt]: a.attempt_no,
        [t('admin.exam.x_status', 'Estado')]: a.status === 'expired'
          ? t('admin.exam.x_expired', 'Se le acabó el tiempo')
          : t('admin.exam.x_submitted', 'Enviado'),
        [t('admin.exam.x_started', 'Inicio')]: fmtDate(a.started_at),
        [t('admin.exam.x_submitted_at', 'Envío')]: fmtDate(a.submitted_at),
        [t('admin.exam.x_minutes', 'Duración (min)')]: minutesBetween(a.started_at, a.submitted_at) ?? '',
        [t('admin.exam.x_score', 'Nota (%)')]: a.score_pct ?? '',
        [t('admin.exam.x_passed', 'Aprobó')]: a.passed ? C.yes : C.no,
        [t('admin.exam.x_right', 'Correctas')]: `${ok}/${a.question_ids.length}`,
        [t('admin.exam.x_blank', 'Sin responder')]: blank,
        [t('admin.exam.x_by_domain', 'Por tema')]: a.domain_scores
          .map((s) => `${rowText(s, 'name')}: ${s.pct}% (${s.correct}/${s.total})`)
          .join(' · '),
      })

      /* Por tema, en formato largo (una fila por persona × intento × tema): es
         la forma que una tabla dinámica sabe cruzar sin pelear con columnas. */
      for (const s of a.domain_scores) {
        domainRows.push({
          ...lead(a.user_id),
          [C.attempt]: a.attempt_no,
          [t('admin.exam.x_domain', 'Tema')]: rowText(s, 'name'),
          [t('admin.exam.x_hits', 'Aciertos')]: s.correct,
          [t('admin.exam.x_total_q', 'Preguntas')]: s.total,
          [t('admin.exam.x_domain_pct', 'Acierto del tema (%)')]: s.pct,
          [t('admin.exam.x_domain_ok', 'Tema aprobado')]: s.passed ? C.yes : C.no,
          [t('admin.exam.x_score', 'Nota (%)')]: a.score_pct ?? '',
          [t('admin.exam.x_passed', 'Aprobó')]: a.passed ? C.yes : C.no,
        })
      }

      a.question_ids.forEach((id, i) => {
        const q = course.questions.get(id)
        const marked = a.answers[id] ?? []
        const v = verdictOf(q, marked)
        const editedAfter = !!q && !!a.submitted_at &&
          Date.parse((q as { updated_at?: string }).updated_at ?? '') > Date.parse(a.submitted_at)
        answerRows.push({
          ...lead(a.user_id),
          [C.attempt]: a.attempt_no,
          [t('admin.exam.x_n', 'N.º')]: i + 1,
          [t('admin.exam.x_domain', 'Tema')]: domainName(q?.domain_id),
          [t('admin.exam.x_question', 'Pregunta')]: q ? stripMarkdown(rowText(q, 'text')) : '',
          [t('admin.exam.x_answered', 'Respondió')]: q ? optionText(q, marked) : marked.join(', '),
          [t('admin.exam.x_right_answer', 'Respuesta correcta')]: q ? optionText(q, q.correct) : '',
          [t('admin.exam.x_result', 'Resultado')]: verdictLabel[v],
          // 1/0: sumable en una tabla dinámica (aciertos por tema, por persona…).
          [t('admin.exam.x_points', 'Punto')]: v === 'correct' ? 1 : 0,
          [t('admin.exam.x_kind', 'Tipo de pregunta')]: q ? kindLabel[q.kind] ?? q.kind : '',
          [t('admin.exam.x_difficulty', 'Dificultad')]: q ? levelLabel[q.difficulty] ?? q.difficulty : '',
          [t('admin.exam.x_explanation', 'Explicación')]: q ? stripMarkdown(rowText(q, 'explanation')) : '',
          [t('admin.exam.x_note', 'Observación')]: editedAfter
            ? t('admin.exam.x_edited_after', 'La pregunta se editó después de este intento')
            : '',
        })
        if (!q) return
        const cur = perQuestion.get(id) ?? { seen: 0, right: 0, wrong: new Map() }
        cur.seen++
        if (v === 'correct') cur.right++
        else if (v === 'wrong') {
          const key = [...marked].sort().join(',')
          cur.wrong.set(key, (cur.wrong.get(key) ?? 0) + 1)
        }
        perQuestion.set(id, cur)
      })
    }

    for (const [id, s] of perQuestion) {
      const q = course.questions.get(id)!
      const top = [...s.wrong.entries()].sort((a, b) => b[1] - a[1])[0]
      const rate = Math.round((s.right / s.seen) * 100)
      analysisRows.push({
        rate,
        row: {
          ...(opts.withCourse ? { [C.course]: course.courseTitle } : {}),
          [t('admin.exam.x_domain', 'Tema')]: domainName(q.domain_id),
          [t('admin.exam.x_question', 'Pregunta')]: stripMarkdown(rowText(q, 'text')),
          [t('admin.exam.x_right_answer', 'Respuesta correcta')]: optionText(q, q.correct),
          [t('admin.exam.x_seen', 'Veces que salió')]: s.seen,
          [t('admin.exam.x_hits', 'Aciertos')]: s.right,
          [t('admin.exam.x_hit_rate', 'Acierto (%)')]: rate,
          [t('admin.exam.x_top_wrong', 'Respuesta incorrecta más elegida')]: top
            ? `${optionText(q, top[0].split(','))} (${top[1]})`
            : '',
        },
      })
    }
  }

  return {
    attempts: { name: t('admin.exam.x_sheet_attempts', 'Intentos'), rows: attemptsRows },
    domains: { name: t('admin.exam.x_sheet_domains', 'Por tema'), rows: domainRows },
    answers: { name: t('admin.exam.x_sheet_answers', 'Respuestas'), rows: answerRows },
    analysis: {
      name: t('admin.exam.x_sheet_questions', 'Análisis por pregunta'),
      rows: analysisRows.sort((a, b) => a.rate - b.rate).map((x) => x.row),
    },
  }
}
