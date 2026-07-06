/**
 * Preguntas sugeridas (chips) según el rol y la página actual. Son claves i18n
 * que se resuelven en el widget. Mantenerlas cortas.
 */
export function getSuggestionKeys(opts: { isStaff: boolean; pathname: string }): string[] {
  const { isStaff, pathname } = opts

  if (isStaff) {
    if (pathname.startsWith('/admin/modules')) return ['staff_ai_module', 'staff_edit_module', 'staff_publish']
    if (pathname.startsWith('/admin/users')) return ['staff_bulk_users', 'staff_share_course', 'staff_roles']
    if (pathname.startsWith('/admin/courses')) return ['staff_create_course', 'staff_assign_course', 'staff_mandatory']
    if (pathname.startsWith('/admin/simulations')) return ['staff_create_sim', 'staff_ai_sim', 'staff_evaluate']
    if (pathname.startsWith('/admin')) return ['staff_ai_module', 'staff_bulk_users', 'staff_evaluate']
    return ['staff_start', 'staff_ai_module', 'staff_bulk_users']
  }

  if (pathname.startsWith('/modules')) return ['learner_module_done', 'learner_quiz', 'learner_next']
  if (pathname.startsWith('/simulator')) return ['learner_sim_how', 'learner_sim_voice', 'learner_sim_score']
  if (pathname.startsWith('/courses')) return ['learner_start', 'learner_assigned', 'learner_certificate']
  if (pathname.startsWith('/certificate')) return ['learner_certificate', 'learner_download_cert', 'learner_progress']

  // dashboard y demás
  return ['learner_start', 'learner_certificate', 'learner_streak']
}
