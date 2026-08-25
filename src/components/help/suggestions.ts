/**
 * Preguntas sugeridas (chips) según el rol y la página actual. Son claves i18n
 * que se resuelven en el widget. Mantenerlas cortas.
 */
export function getSuggestionKeys(opts: { isStaff: boolean; pathname: string }): string[] {
  const { isStaff, pathname } = opts

  if (isStaff) {
    if (pathname.startsWith('/admin/modules')) return ['staff_ai_module', 'staff_edit_module', 'staff_publish']
    if (pathname.startsWith('/admin/users')) return ['staff_bulk_users', 'staff_share_course', 'staff_roles']
    if (pathname.startsWith('/admin/courses')) return ['staff_create_course', 'staff_publish_course', 'staff_exam']
    if (pathname.startsWith('/admin/simulations')) return ['staff_create_sim', 'staff_ai_sim', 'staff_evaluate']
    if (pathname.startsWith('/admin/progress')) return ['staff_progress', 'staff_evaluate', 'staff_reset']
    if (pathname.startsWith('/admin/site-feedback')) return ['staff_feedback_inbox', 'staff_progress', 'staff_start']
    if (pathname.startsWith('/admin/limits') || pathname.startsWith('/admin/ai-usage')) return ['staff_ai_quota', 'staff_ai_module', 'staff_progress']
    if (pathname.startsWith('/admin/publish-approvals') || pathname.startsWith('/admin/approvals')) return ['staff_publish_course', 'staff_progress', 'staff_start']
    if (pathname.startsWith('/admin')) return ['staff_ai_module', 'staff_bulk_users', 'staff_evaluate']
    return ['staff_start', 'staff_ai_module', 'staff_bulk_users']
  }

  if (pathname.startsWith('/modules')) return ['learner_module_done', 'learner_quiz', 'learner_next']
  if (pathname.startsWith('/simulator')) return ['learner_sim_how', 'learner_sim_voice', 'learner_sim_score']
  if (pathname.startsWith('/courses')) return ['learner_start', 'learner_assigned', 'learner_certificate']
  if (pathname.startsWith('/certificate')) return ['learner_certificate', 'learner_download_cert', 'learner_progress']
  if (pathname.startsWith('/exam')) return ['learner_exam', 'learner_reinforcement', 'learner_certificate']
  if (pathname.startsWith('/course/') || pathname.includes('/survey')) return ['learner_survey', 'learner_certificate', 'learner_progress']
  if (pathname.startsWith('/suggestions') || pathname.startsWith('/feedback')) return ['learner_report', 'learner_progress', 'learner_next']

  // dashboard y demás
  return ['learner_start', 'learner_certificate', 'learner_report']
}
