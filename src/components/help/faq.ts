import { normalize } from '@/lib/normalize'

/**
 * Base de conocimiento local del asistente. El chat responde con esto SIN llamar
 * a la IA cuando encuentra una coincidencia con suficiente confianza; solo escala
 * a Claude (Edge Function) cuando ninguna entrada resuelve la duda. Así se ahorran
 * tokens en las preguntas frecuentes.
 *
 * - `audience`: a quién aplica. Los aprendices NUNCA ven entradas 'staff'.
 * - `strong`: palabras/frases muy distintivas del tema (valen 2 puntos).
 * - `keywords`: términos de apoyo para desambiguar (valen 1 punto).
 * - `answer`: respuesta en los 3 idiomas, en Markdown ligero. Los enlaces internos
 *   ("[texto](/ruta)") se convierten en botones de navegación en el widget.
 */
export interface FaqEntry {
  id: string
  audience: 'all' | 'learner' | 'staff'
  strong: string[]
  keywords: string[]
  answer: { es: string; en: string; pt: string }
}

/** Umbral mínimo de puntaje para responder localmente (si no, se usa la IA). */
export const FAQ_MATCH_THRESHOLD = 2

export const FAQ: FaqEntry[] = [
  // ─── Aprendiz ──────────────────────────────────────────────
  {
    id: 'start',
    audience: 'learner',
    strong: ['empezar', 'comenzar', 'iniciar curso', 'start', 'begin', 'comecar', 'como empiezo'],
    keywords: ['curso', 'course', 'primero', 'first', 'donde', 'where'],
    answer: {
      es: 'Para empezar, abre tu [panel](/dashboard) o el [catálogo de cursos](/courses), elige un curso y entra a su primer módulo. Al terminar cada módulo se marca como completado y sumas progreso.',
      en: 'To start, open your [dashboard](/dashboard) or the [course catalog](/courses), pick a course and open its first module. Each module is marked complete as you finish it and adds to your progress.',
      pt: 'Para começar, abra seu [painel](/dashboard) ou o [catálogo de cursos](/courses), escolha um curso e entre no primeiro módulo. Cada módulo é marcado como concluído e soma progresso.',
    },
  },
  {
    id: 'certificate',
    audience: 'learner',
    strong: ['certificado', 'certificate', 'diploma', 'constancia'],
    keywords: ['descargar', 'download', 'obtener', 'get', 'pdf', 'baixar', 'terminar'],
    answer: {
      es: 'El certificado se habilita cuando completas todos los módulos de tu curso. Luego lo encuentras en [Certificado](/certificate) y puedes descargarlo en PDF.',
      en: 'Your certificate unlocks once you complete all the modules in your course. You can then find it under [Certificate](/certificate) and download it as a PDF.',
      pt: 'O certificado é liberado quando você conclui todos os módulos do seu curso. Depois você o encontra em [Certificado](/certificate) e pode baixá-lo em PDF.',
    },
  },
  {
    id: 'xp-streak',
    audience: 'learner',
    strong: ['xp', 'racha', 'streak', 'puntos', 'points', 'sequencia'],
    keywords: ['que es', 'que son', 'gano', 'earn', 'nivel'],
    answer: {
      es: 'El **XP** son puntos que ganas al completar módulos, quizzes y simulaciones. La **racha** cuenta tus días seguidos de actividad. Ambos aparecen en tu [panel](/dashboard).',
      en: '**XP** are points you earn by completing modules, quizzes and simulations. Your **streak** counts consecutive days of activity. Both show on your [dashboard](/dashboard).',
      pt: 'O **XP** são pontos que você ganha ao concluir módulos, quizzes e simulações. A **sequência** conta seus dias seguidos de atividade. Ambos aparecem no seu [painel](/dashboard).',
    },
  },
  {
    id: 'assigned',
    audience: 'learner',
    strong: ['no veo', 'no aparece', 'curso asignado', 'not showing', 'cant see', 'missing course'],
    keywords: ['asignado', 'assigned', 'curso', 'course', 'falta', 'atribuido'],
    answer: {
      es: 'Si no ves un curso que te asignaron, puede que aún no esté publicado o vinculado a tu perfil. Avísale a tu capacitador para que lo revise.',
      en: "If you can't see a course you were assigned, it may not be published or linked to your profile yet. Let your trainer know so they can check.",
      pt: 'Se você não vê um curso atribuído, talvez ele ainda não esteja publicado ou vinculado ao seu perfil. Avise seu instrutor para verificar.',
    },
  },
  {
    id: 'simulator',
    audience: 'learner',
    strong: ['simulador', 'simulation', 'simulacion', 'practicar llamada', 'roleplay', 'practicar'],
    keywords: ['como funciona', 'llamada', 'call', 'escenario', 'scenario', 'cliente'],
    answer: {
      es: 'En el [simulador](/simulator) practicas la atención al cliente: eliges un escenario y conversas con un "cliente". Hay de **diálogo libre** (puedes usar el micrófono) y de **opciones** (eliges tu camino). Al final recibes una calificación.',
      en: 'In the [simulator](/simulator) you practice customer service: pick a scenario and talk to a "customer". There are **free-dialogue** ones (you can use the mic) and **branching** ones (choose your path). You get a score at the end.',
      pt: 'No [simulador](/simulator) você pratica o atendimento ao cliente: escolhe um cenário e conversa com um "cliente". Há de **diálogo livre** (pode usar o microfone) e de **opções** (escolha seu caminho). No fim você recebe uma nota.',
    },
  },
  {
    id: 'simulator-voice',
    audience: 'learner',
    strong: ['microfono', 'microphone', 'voz', 'voice', 'hablar', 'microfone'],
    keywords: ['simulador', 'simulator', 'usar', 'audio'],
    answer: {
      es: 'Sí: en la simulación de **diálogo libre** puedes responder con el micrófono además de escribir. Tu navegador te pedirá permiso para usarlo la primera vez.',
      en: 'Yes: in the **free-dialogue** simulation you can answer using the microphone as well as typing. Your browser will ask for permission the first time.',
      pt: 'Sim: na simulação de **diálogo livre** você pode responder com o microfone além de digitar. O navegador pedirá permissão na primeira vez.',
    },
  },
  {
    id: 'quiz',
    audience: 'learner',
    strong: ['quiz', 'cuestionario', 'evaluacion', 'examen', 'prueba'],
    keywords: ['como funciona', 'responder', 'seccion', 'section', 'vivo', 'live'],
    answer: {
      es: 'Hay dos tipos: los **quizzes de sección** dentro de cada módulo (para reforzar lo aprendido) y el **quiz en vivo** que lanza tu capacitador, donde respondes en tiempo real desde [Quiz](/quiz).',
      en: 'There are two kinds: **section quizzes** inside each module (to reinforce learning) and the **live quiz** your trainer launches, where you answer in real time from [Quiz](/quiz).',
      pt: 'Há dois tipos: os **quizzes de seção** dentro de cada módulo (para reforçar o aprendizado) e o **quiz ao vivo** que seu instrutor lança, onde você responde em tempo real em [Quiz](/quiz).',
    },
  },
  {
    id: 'language-theme',
    audience: 'all',
    strong: ['idioma', 'language', 'tema', 'theme', 'oscuro', 'dark', 'claro', 'idioma'],
    keywords: ['cambiar', 'change', 'modo', 'mode', 'bandera', 'flag', 'ingles', 'espanol'],
    answer: {
      es: 'Cambias el **idioma** con el selector de bandera de la barra superior (Español, English, Português) y el **tema claro/oscuro** con el botón de sol/luna al lado.',
      en: 'Change the **language** with the flag selector in the top bar (Español, English, Português) and the **light/dark theme** with the sun/moon button next to it.',
      pt: 'Mude o **idioma** com o seletor de bandeira na barra superior (Español, English, Português) e o **tema claro/escuro** com o botão de sol/lua ao lado.',
    },
  },
  {
    id: 'logout',
    audience: 'all',
    strong: ['cerrar sesion', 'salir', 'log out', 'logout', 'sair', 'desconectar'],
    keywords: ['cuenta', 'account', 'boton'],
    answer: {
      es: 'Para cerrar sesión usa el icono de salir (flecha) en la esquina superior derecha de la barra.',
      en: 'To log out, use the exit icon (arrow) in the top-right corner of the bar.',
      pt: 'Para sair, use o ícone de saída (seta) no canto superior direito da barra.',
    },
  },

  // ─── Capacitador / superadmin ──────────────────────────────
  {
    id: 'ai-module',
    audience: 'staff',
    strong: ['generar modulo', 'modulo con ia', 'generate module', 'ia', 'ai', 'inteligencia artificial'],
    keywords: ['crear', 'create', 'documento', 'document', 'automatico', 'contenido'],
    answer: {
      es: 'Desde el [editor de módulos](/admin/modules) puedes generar contenido con IA a partir de una descripción, o subir un documento en [Importar contenido](/admin/import) para que la IA proponga y arme los módulos.',
      en: 'From the [module editor](/admin/modules) you can generate content with AI from a description, or upload a document in [Import content](/admin/import) so the AI proposes and builds the modules.',
      pt: 'No [editor de módulos](/admin/modules) você pode gerar conteúdo com IA a partir de uma descrição, ou enviar um documento em [Importar conteúdo](/admin/import) para a IA propor e montar os módulos.',
    },
  },
  {
    id: 'publish-module',
    audience: 'staff',
    strong: ['publicar modulo', 'publish', 'publicar', 'despublicar', 'publicar curso'],
    keywords: ['modulo', 'module', 'visible', 'borrador', 'draft'],
    answer: {
      es: 'Un módulo nuevo queda como borrador. Para que los aprendices lo vean, publícalo desde la [lista de módulos](/admin/modules) o el editor con el interruptor de publicación.',
      en: 'A new module stays as a draft. To make it visible to learners, publish it from the [module list](/admin/modules) or the editor using the publish toggle.',
      pt: 'Um módulo novo fica como rascunho. Para que os aprendizes o vejam, publique-o na [lista de módulos](/admin/modules) ou no editor com o botão de publicação.',
    },
  },
  {
    id: 'bulk-users',
    audience: 'staff',
    strong: ['carga masiva', 'excel', 'bulk', 'importar usuarios', 'cargar usuarios', 'crear usuarios'],
    keywords: ['usuarios', 'users', 'masivo', 'importar', 'planilla', 'archivo'],
    answer: {
      es: 'La carga masiva por Excel está en [Usuarios](/admin/users) (solo superadmin): subes la planilla y se crean las cuentas. También puedes crear usuarios uno a uno ahí mismo.',
      en: 'Bulk upload via Excel is in [Users](/admin/users) (superadmin only): upload the spreadsheet and the accounts are created. You can also create users one by one there.',
      pt: 'A carga em massa por Excel está em [Usuários](/admin/users) (apenas superadmin): envie a planilha e as contas são criadas. Você também pode criar usuários um a um ali.',
    },
  },
  {
    id: 'share-course',
    audience: 'staff',
    strong: ['compartir curso', 'share course', 'asignar curso', 'assign course', 'compartilhar curso'],
    keywords: ['curso', 'course', 'asignar', 'aprendiz', 'campana', 'campaign'],
    answer: {
      es: 'Desde [Usuarios](/admin/users) puedes asignar o compartir cursos con tus aprendices. También administras los cursos y sus módulos en [Cursos](/admin/courses).',
      en: 'From [Users](/admin/users) you can assign or share courses with your learners. You also manage courses and their modules in [Courses](/admin/courses).',
      pt: 'Em [Usuários](/admin/users) você pode atribuir ou compartilhar cursos com seus aprendizes. Também gerencia cursos e seus módulos em [Cursos](/admin/courses).',
    },
  },
  {
    id: 'create-course',
    audience: 'staff',
    strong: ['crear curso', 'create course', 'nuevo curso', 'criar curso', 'obligatorio', 'mandatory'],
    keywords: ['curso', 'course', 'agrupar', 'modulos', 'catalogo', 'catalog'],
    answer: {
      es: 'Crea y edita cursos en [Cursos](/admin/courses). Un curso agrupa varios módulos, se asigna a campañas o personas y puede ser obligatorio o de catálogo abierto.',
      en: 'Create and edit courses in [Courses](/admin/courses). A course groups several modules, is assigned to campaigns or people, and can be mandatory or open-catalog.',
      pt: 'Crie e edite cursos em [Cursos](/admin/courses). Um curso agrupa vários módulos, é atribuído a campanhas ou pessoas e pode ser obrigatório ou de catálogo aberto.',
    },
  },
  {
    id: 'create-sim',
    audience: 'staff',
    strong: ['crear simulacion', 'create simulation', 'nueva simulacion', 'criar simulacao'],
    keywords: ['simulacion', 'simulation', 'dialogo', 'opciones', 'choice', 'ia', 'ai'],
    answer: {
      es: 'Crea y edita simulaciones en [Simulaciones](/admin/simulations), tanto de diálogo como de "elige tu camino". También puedes generarlas con IA a partir de una descripción.',
      en: 'Create and edit simulations in [Simulations](/admin/simulations), both dialogue and "choose your path". You can also generate them with AI from a description.',
      pt: 'Crie e edite simulações em [Simulações](/admin/simulations), tanto de diálogo quanto de "escolha seu caminho". Você também pode gerá-las com IA a partir de uma descrição.',
    },
  },
  {
    id: 'evaluations',
    audience: 'staff',
    strong: ['evaluaciones', 'evaluations', 'resultados', 'results', 'notas', 'calificaciones'],
    keywords: ['aprendices', 'ver', 'quizzes', 'simulaciones', 'desempeno', 'panel'],
    answer: {
      es: 'En [Evaluaciones](/admin/evaluaciones) revisas los resultados de quizzes y simulaciones de tus aprendices y su desempeño.',
      en: 'In [Evaluations](/admin/evaluaciones) you review your learners\' quiz and simulation results and their performance.',
      pt: 'Em [Avaliações](/admin/evaluaciones) você revisa os resultados de quizzes e simulações dos seus aprendizes e o desempenho deles.',
    },
  },
  {
    id: 'live-quiz',
    audience: 'staff',
    strong: ['quiz en vivo', 'live quiz', 'lanzar quiz', 'concurso', 'kahoot'],
    keywords: ['quiz', 'vivo', 'tiempo real', 'admin', 'lanzar'],
    answer: {
      es: 'Configura y lanza quizzes en vivo desde [Quiz en vivo](/admin/quiz). Los aprendices responden en tiempo real desde su pantalla de quiz.',
      en: 'Set up and launch live quizzes from [Live quiz](/admin/quiz). Learners answer in real time from their quiz screen.',
      pt: 'Configure e lance quizzes ao vivo em [Quiz ao vivo](/admin/quiz). Os aprendizes respondem em tempo real na tela de quiz.',
    },
  },
  {
    id: 'roles',
    audience: 'staff',
    strong: ['roles', 'permisos', 'permissions', 'superadmin', 'capacitador', 'papeis'],
    keywords: ['que roles', 'tipos de usuario', 'aprendiz', 'learner', 'admin'],
    answer: {
      es: 'Hay 3 roles: **superadmin** (control total, incluidas campañas y creación de usuarios), **capacitador** (gestiona su campaña: contenido, aprendices y asignación de cursos) y **learner** (consume la capacitación).',
      en: 'There are 3 roles: **superadmin** (full control, including campaigns and user creation), **capacitador/trainer** (manages their campaign: content, learners and course assignment) and **learner** (takes the training).',
      pt: 'Há 3 funções: **superadmin** (controle total, incluindo campanhas e criação de usuários), **capacitador/instrutor** (gerencia sua campanha: conteúdo, aprendizes e atribuição de cursos) e **learner** (faz a capacitação).',
    },
  },
]

export interface FaqMatch {
  entry: FaqEntry
  score: number
}

/**
 * Busca la mejor entrada de FAQ para la pregunta. Devuelve null si ninguna alcanza
 * el umbral de confianza (en ese caso el widget escala a la IA).
 */
export function matchFaq(query: string, opts: { isStaff: boolean }): FaqMatch | null {
  const q = normalize(query)
  if (!q) return null

  let best: FaqEntry | null = null
  let bestScore = 0

  for (const entry of FAQ) {
    // Los aprendices nunca reciben respuestas de la zona de gestión.
    if (entry.audience === 'staff' && !opts.isStaff) continue

    let score = 0
    for (const kw of entry.strong) {
      if (q.includes(normalize(kw))) score += 2
    }
    for (const kw of entry.keywords) {
      if (q.includes(normalize(kw))) score += 1
    }

    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }

  if (best && bestScore >= FAQ_MATCH_THRESHOLD) return { entry: best, score: bestScore }
  return null
}
