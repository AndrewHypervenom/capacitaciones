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
      es: 'El certificado se habilita cuando cumples las condiciones que puso tu capacitador: completar los módulos, alcanzar la nota mínima, el puntaje del simulador y, si el curso los tiene, aprobar el examen final y contestar la encuesta. Luego lo encuentras en [Certificado](/certificate), lo descargas en PDF y lo compartes con su código verificable. Si el curso está en construcción, aparece "Próximamente" con lo que falta.',
      en: 'Your certificate unlocks once you meet the conditions your trainer set: completing the modules, reaching the minimum score, the simulator score and, if the course has them, passing the final exam and answering the survey. You can then find it under [Certificate](/certificate), download it as a PDF and share it with its verifiable code. If the course is still being built, you will see "Coming soon" with what is missing.',
      pt: 'O certificado é liberado quando você cumpre as condições definidas pelo instrutor: concluir os módulos, atingir a nota mínima, a pontuação do simulador e, se o curso tiver, passar na prova final e responder a pesquisa. Depois você o encontra em [Certificado](/certificate), baixa em PDF e compartilha com seu código verificável. Se o curso ainda está em construção, aparece "Em breve" com o que falta.',
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
    strong: ['evaluaciones', 'evaluations', 'resultados', 'results', 'notas', 'calificaciones', 'estadisticas', 'statistics', 'estatisticas', 'simulador', 'simulator', 'llamadas', 'calls'],
    keywords: ['aprendices', 'ver', 'quizzes', 'simulaciones', 'simulations', 'desempeno', 'curso', 'course', 'promedio', 'certificados', 'empatia', 'checklist'],
    answer: {
      es: 'En **Personas → Progreso** eliges una de tres vistas: **Progreso de Módulos**, **Progreso de Mundos** (avance gamificado) o **Progreso de Simulaciones** (puntaje, empatía, checklist, resolución y feedback de IA, con filtro por escenario). Abre [Progreso](/admin/progress). Progreso de Módulos tiene dos pestañas: **Panorama** —KPIs del programa (personas alcanzadas, participación, nota promedio, certificados, NPS y pendientes por evaluar) con secciones de Resumen, Personas, Cursos, **Examen final** y **Satisfacción**, matriz personas × cursos y exportación a Excel— y **Bandeja**, donde evalúas las entregas una a una. Las estadísticas por curso y los certificados viven ahí (antes eran la "Vista global").',
      en: 'In **People → Progress** you pick one of three views: **Module Progress**, **World Progress** (gamified) or **Simulation Progress** (score, empathy, checklist, resolution and AI feedback, with a scenario filter). Open [Progress](/admin/progress). Module Progress has two tabs: **Overview** —program KPIs (people reached, participation, average score, certificates, NPS and pending reviews) with Summary, People, Courses, **Final exam** and **Satisfaction** sections, a people × courses matrix and Excel export— and **Inbox**, where you review submissions one by one. Per-course stats and certificates live there (this replaced the old "Global view").',
      pt: 'Em **Pessoas → Progresso** você escolhe uma de três vistas: **Progresso de Módulos**, **Progresso de Mundos** (gamificado) ou **Progresso de Simulações** (pontuação, empatia, checklist, resolução e feedback de IA, com filtro por cenário). Abra [Progresso](/admin/progress). O Progresso de Módulos tem duas abas: **Panorama** —KPIs do programa (pessoas alcançadas, participação, nota média, certificados, NPS e pendentes de avaliação) com seções de Resumo, Pessoas, Cursos, **Prova final** e **Satisfação**, matriz pessoas × cursos e exportação para Excel— e **Caixa**, onde você avalia as entregas uma a uma. As estatísticas por curso e os certificados ficam ali (substituiu a antiga "Visão global").',
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
  // ─── Aprendiz: evaluación, certificación y opinión ─────────
  {
    id: 'final-exam',
    audience: 'learner',
    strong: ['examen final', 'examen', 'final exam', 'exame final', 'prueba final'],
    keywords: ['presentar', 'intentos', 'attempts', 'tiempo', 'aprobar', 'pass', 'banco', 'reprobe'],
    answer: {
      es: 'El **examen final** se abre desde tu curso, cuando el capacitador lo habilita. Antes de empezar ves las reglas: cuántas preguntas trae, el tiempo, el puntaje para aprobar y los intentos. Las preguntas se sortean de un banco, así que cada intento es distinto; el reloj corre en el servidor (sigue aunque cierres la pestaña) y tus respuestas se guardan solas. Al terminar recibes un informe con tu desempeño por área.',
      en: 'The **final exam** opens from your course once your trainer enables it. Before starting you see the rules: how many questions, the time limit, the passing score and the attempts allowed. Questions are drawn from a bank, so every attempt is different; the clock runs on the server (it keeps going even if you close the tab) and your answers save themselves. At the end you get a report with your performance per area.',
      pt: 'A **prova final** abre dentro do seu curso, quando o instrutor a habilita. Antes de começar você vê as regras: quantas perguntas, o tempo, a nota para aprovar e as tentativas. As perguntas são sorteadas de um banco, então cada tentativa é diferente; o relógio corre no servidor (continua mesmo se você fechar a aba) e suas respostas são salvas sozinhas. No fim você recebe um relatório por área.',
    },
  },
  {
    id: 'reinforcement',
    audience: 'learner',
    strong: ['refuerzo', 'repaso', 'reinforcement', 'reforco', 'reintentar', 'volver a presentar'],
    keywords: ['reprobe', 'perdi', 'failed', 'examen', 'marcar', 'repasar'],
    answer: {
      es: 'Si reprobaste el examen y tu curso lo exige, se abre una **ruta de refuerzo**: tienes que volver a recorrer los módulos de las áreas que fallaste y marcarlos como repasados antes de reintentar. Se mide el tiempo real que pasas dentro del módulo, así que saltar al final no cuenta. Cuando termines el refuerzo, el examen se habilita de nuevo.',
      en: 'If you failed the exam and your course requires it, a **reinforcement path** opens: you must go through the modules of the areas you failed and mark them as reviewed before retrying. Real time spent inside the module is measured, so skipping to the end does not count. Once you finish the reinforcement, the exam unlocks again.',
      pt: 'Se você não passou na prova e o curso exige, abre uma **rota de reforço**: é preciso percorrer de novo os módulos das áreas em que errou e marcá-los como revisados antes de tentar outra vez. O tempo real dentro do módulo é medido, então pular para o fim não conta. Ao terminar o reforço, a prova é liberada novamente.',
    },
  },
  {
    id: 'survey',
    audience: 'learner',
    strong: ['encuesta', 'survey', 'pesquisa', 'satisfaccion', 'satisfacao'],
    keywords: ['curso', 'certificado', 'contestar', 'responder', 'cierre'],
    answer: {
      es: 'Algunos cursos cierran con una **encuesta de satisfacción** de tres preguntas cortas. Es el último paso antes del certificado: mientras no la contestes, el certificado no se emite. Si se te vence el tiempo no pasa nada, simplemente vuelves a empezarla.',
      en: 'Some courses end with a short three-question **satisfaction survey**. It is the last step before the certificate: until you answer it, the certificate is not issued. If the time runs out nothing is lost, you just start it again.',
      pt: 'Alguns cursos terminam com uma **pesquisa de satisfação** de três perguntas curtas. É o último passo antes do certificado: enquanto não respondê-la, o certificado não é emitido. Se o tempo acabar não há problema, basta recomeçar.',
    },
  },
  {
    id: 'verify-certificate',
    audience: 'all',
    strong: ['verificar certificado', 'codigo del certificado', 'qr', 'linkedin', 'compartir certificado'],
    keywords: ['valido', 'verify', 'enlace', 'link', 'publico', 'comprobar'],
    answer: {
      es: 'Cada certificado trae un **código verificable** y un enlace público: quien lo abra ve quién se certificó, en qué curso, la intensidad horaria y el pénsum módulo a módulo. Ese mismo enlace es el que se comparte en LinkedIn desde el botón del certificado.',
      en: 'Every certificate carries a **verifiable code** and a public link: whoever opens it sees who got certified, in which course, the hours and the full syllabus module by module. That same link is what the certificate button shares to LinkedIn.',
      pt: 'Cada certificado traz um **código verificável** e um link público: quem abrir vê quem se certificou, em qual curso, a carga horária e a ementa módulo a módulo. Esse mesmo link é o que o botão do certificado compartilha no LinkedIn.',
    },
  },
  {
    id: 'course-deadline',
    audience: 'learner',
    strong: ['plazo', 'vencio', 'cerrado', 'deadline', 'expirou', 'se me cerro'],
    keywords: ['curso', 'fecha', 'tiempo', 'no puedo entrar', 'bloqueado'],
    answer: {
      es: 'Algunos cursos tienen **plazo**. Si se vence, el curso queda cerrado y no puedes seguir avanzando: escríbele a tu capacitador para que amplíe el plazo. Tu avance no se pierde.',
      en: 'Some courses have a **deadline**. Once it passes the course closes and you cannot keep going: ask your trainer to extend it. Your progress is not lost.',
      pt: 'Alguns cursos têm **prazo**. Quando vence, o curso fecha e você não consegue avançar: peça ao seu instrutor que amplie o prazo. Seu progresso não se perde.',
    },
  },
  {
    id: 'report-problem',
    audience: 'all',
    strong: ['reportar', 'sugerencia', 'opinion', 'feedback del sitio', 'algo fallo', 'report a bug', 'sugestao'],
    keywords: ['error', 'idea', 'proponer', 'captura', 'no funciona', 'bug'],
    answer: {
      es: 'Usa el **botón de opinión** que está flotando en la pantalla: eliges si es "Algo falló", "Tengo una idea", "Algo me encantó" o "Tengo una duda", lo escribes y puedes adjuntar una captura (pégala con Ctrl+V o arrástrala). Después le haces seguimiento en [Mis sugerencias](/suggestions), donde también te responde el equipo.',
      en: 'Use the floating **feedback button**: pick whether it is "Something broke", "I have an idea", "I loved something" or "I have a question", write it and attach a screenshot if you want (paste with Ctrl+V or drag it in). You can follow it up in [My suggestions](/suggestions), where the team replies to you.',
      pt: 'Use o **botão de opinião** flutuante na tela: escolha se é "Algo falhou", "Tenho uma ideia", "Amei algo" ou "Tenho uma dúvida", escreva e anexe uma captura se quiser (cole com Ctrl+V ou arraste). Depois acompanhe em [Minhas sugestões](/suggestions), onde a equipe responde.',
    },
  },
  {
    id: 'biometric-login',
    audience: 'all',
    strong: ['huella', 'face id', 'biometrico', 'windows hello', 'passkey', 'dactilar'],
    keywords: ['entrar', 'login', 'activar', 'seguridad', 'ingreso'],
    answer: {
      es: 'El ingreso con huella o Face ID se activa en [Mi perfil](/profile) → pestaña **Seguridad** → "Activar en este dispositivo". Hay que hacerlo en cada equipo o celular que uses, y la primera entrada siempre es con correo y contraseña. Tu huella nunca sale del dispositivo, y la contraseña sigue funcionando como respaldo.',
      en: 'Fingerprint or Face ID sign-in is enabled in [My profile](/profile) → **Security** tab → "Enable on this device". You must do it on each computer or phone you use, and the first sign-in is always with email and password. Your fingerprint never leaves the device, and your password still works as a fallback.',
      pt: 'A entrada com digital ou Face ID é ativada em [Meu perfil](/profile) → aba **Segurança** → "Ativar neste dispositivo". É preciso fazer isso em cada computador ou celular que usar, e a primeira entrada é sempre com e-mail e senha. Sua digital nunca sai do aparelho, e a senha continua como alternativa.',
    },
  },
  // ─── Gestión: publicación, examen, progreso, IA ────────────
  {
    id: 'publish-course',
    audience: 'staff',
    strong: ['publicar curso', 'aprobacion', 'publicaciones', 'publish course', 'en revision'],
    keywords: ['borrador', 'draft', 'aprobar', 'devolver', 'no lo ve', 'visible'],
    answer: {
      es: 'El aprendiz solo ve lo **publicado**. En el editor del curso, panel de **Publicación**, publicas el curso y sus módulos. Si el sitio tiene aprobación activada, el curso queda "En revisión" y un aprobador designado lo aprueba, lo devuelve con un motivo o lo baja después desde **Supervisión → Publicaciones**. Si asignaste el curso y nadie lo ve, casi siempre sigue en borrador o esperando aprobación.',
      en: 'Learners only see what is **published**. In the course editor, the **Publishing** panel is where you publish the course and its modules. If approval is enabled, the course sits "Under review" until a designated approver approves it, sends it back with a reason, or takes it down later from **Supervision → Publishing**. If you assigned a course and nobody sees it, it is almost always still a draft or awaiting approval.',
      pt: 'O aprendiz só vê o que está **publicado**. No editor do curso, no painel de **Publicação**, você publica o curso e seus módulos. Se a aprovação estiver ativa, o curso fica "Em revisão" até que um aprovador designado aprove, devolva com um motivo ou o baixe depois em **Supervisão → Publicações**. Se você atribuiu o curso e ninguém o vê, quase sempre ele ainda é rascunho ou aguarda aprovação.',
    },
  },
  {
    id: 'staff-exam',
    audience: 'staff',
    strong: ['crear examen', 'banco de preguntas', 'examen final', 'exam bank', 'areas de conocimiento'],
    keywords: ['curso', 'preguntas', 'aprobar', 'intentos', 'generar', 'ia'],
    answer: {
      es: 'Abre el curso → pestaña **Examen**. Ahí defines las **áreas de conocimiento** (reparten las preguntas y deciden qué se manda a repasar), las preguntas por intento, el puntaje para aprobar, los intentos y el tiempo. Después llenas el **banco**: a mano, con la plantilla, reutilizando quizzes ya calificados del curso o generando con IA por tandas. El banco tiene que ser más grande que el examen para poder publicarlo.',
      en: 'Open the course → **Exam** tab. There you set the **knowledge areas** (they split the questions and drive what gets sent to review), questions per attempt, passing score, attempts and time. Then you fill the **bank**: by hand, from the template, by reusing already graded quizzes from the course, or generating with AI in batches. The bank must be larger than the exam before you can publish it.',
      pt: 'Abra o curso → aba **Prova**. Ali você define as **áreas de conhecimento** (distribuem as perguntas e definem o que vai para revisão), perguntas por tentativa, nota para aprovar, tentativas e tempo. Depois preenche o **banco**: à mão, pelo modelo, reaproveitando quizzes já corrigidos do curso ou gerando com IA em lotes. O banco precisa ser maior que a prova para publicar.',
    },
  },
  {
    id: 'staff-reset-progress',
    audience: 'staff',
    strong: ['restablecer', 'reiniciar progreso', 'reset', 'borrar avance', 'zerar'],
    keywords: ['usuario', 'aprendiz', 'curso', 'modulo', 'simulador', 'mundo'],
    answer: {
      es: 'Ve a **Personas → Usuarios**, abre a la persona y entra a "Ver y restablecer cursos". Puedes restablecer un curso entero, un módulo, una actividad puntual, el mundo o los intentos del simulador. Ojo: restablecer **no se puede deshacer**.',
      en: 'Go to **People → Users**, open the person and use "View and reset courses". You can reset a whole course, one module, a single activity, the world or the simulator attempts. Careful: a reset **cannot be undone**.',
      pt: 'Vá em **Pessoas → Usuários**, abra a pessoa e use "Ver e redefinir cursos". Você pode redefinir um curso inteiro, um módulo, uma atividade específica, o mundo ou as tentativas do simulador. Atenção: redefinir **não pode ser desfeito**.',
    },
  },
  {
    id: 'staff-ai-quota',
    audience: 'staff',
    strong: ['cupo de ia', 'limite de ia', 'se acabo la ia', 'ai quota', 'cota de ia', 'operaciones con ia'],
    keywords: ['generar', 'tope', 'diario', 'ampliar', 'bloqueado'],
    answer: {
      es: 'Cada capacitador tiene un **cupo diario de operaciones con IA** (generar módulos, mundos, simulaciones, traducciones). Si se agota, el superadmin lo amplía en **Inteligencia Artificial → Límites de IA**: puede subir el cupo por defecto, dar un cupo propio, un extra solo por hoy o quitar el tope. Ahí mismo se ve cuánto se ha usado.',
      en: 'Each trainer has a **daily AI operations quota** (generating modules, worlds, simulations, translations). If it runs out, the superadmin raises it in **Artificial Intelligence → AI limits**: they can raise the default, give a personal quota, a bonus just for today, or remove the cap. Usage is visible there too.',
      pt: 'Cada instrutor tem uma **cota diária de operações com IA** (gerar módulos, mundos, simulações, traduções). Se acabar, o superadmin amplia em **Inteligência Artificial → Limites de IA**: dá para subir a cota padrão, dar cota própria, um extra só para hoje ou tirar o limite. O uso também aparece ali.',
    },
  },
  {
    id: 'staff-progress',
    audience: 'staff',
    strong: ['progreso', 'panorama', 'estadisticas', 'reportes', 'excel', 'kpi'],
    keywords: ['curso', 'aprendices', 'certificados', 'exportar', 'nps', 'bandeja'],
    answer: {
      es: 'Todo vive en **Personas → Progreso**, con tres vistas: **Progreso de Módulos** (pestaña *Panorama* con KPIs, certificados, resultados del examen final, NPS de la encuesta y exportación a Excel; pestaña *Bandeja* para revisar entregas y dar retroalimentación), **Progreso de Mundos** y **Progreso de Simulaciones**. El **Panel** solo tiene contadores.',
      en: 'It all lives in **People → Progress**, with three views: **Module progress** (the *Overview* tab has KPIs, certificates, final exam results, survey NPS and Excel export; the *Inbox* tab is where you review submissions and send feedback), **World progress** and **Simulation progress**. The **Dashboard** only has counters.',
      pt: 'Tudo fica em **Pessoas → Progresso**, com três visões: **Progresso de Módulos** (aba *Panorama* com KPIs, certificados, resultados da prova final, NPS da pesquisa e exportação para Excel; aba *Caixa* para revisar entregas e dar retorno), **Progresso de Mundos** e **Progresso de Simulações**. O **Painel** tem apenas contadores.',
    },
  },
  {
    id: 'staff-module-library',
    audience: 'staff',
    strong: ['biblioteca de modulos', 'reutilizar modulo', 'copiar modulo', 'mover modulo'],
    keywords: ['curso', 'otra campana', 'duplicar', 'agregar'],
    answer: {
      es: 'En el curso → pestaña **Módulos** → **Biblioteca de módulos**: ahí reutilizas módulos de tu campaña o de otras. **Mover** traslada el mismo módulo (deja de estar donde estaba) y **Copiar** crea una copia independiente que puedes editar sin tocar el original.',
      en: 'In the course → **Modules** tab → **Module library**: reuse modules from your campaign or others. **Move** relocates the same module (it leaves its previous place) and **Copy** creates an independent copy you can edit without touching the original.',
      pt: 'No curso → aba **Módulos** → **Biblioteca de módulos**: reaproveite módulos da sua campanha ou de outras. **Mover** transfere o mesmo módulo (sai de onde estava) e **Copiar** cria uma cópia independente, editável sem mexer no original.',
    },
  },
  {
    id: 'staff-restore-deleted',
    audience: 'staff',
    strong: ['recuperar', 'papelera', 'restaurar', 'borre sin querer', 'trash', 'lixeira'],
    keywords: ['eliminado', 'borrado', 'aprobaciones', 'volver'],
    answer: {
      es: 'Lo que se borra no desaparece de una: queda en **Supervisión → Aprobaciones**, en la pestaña *Papelera*, unos días. Desde ahí el superadmin lo **restaura** tal como estaba, aprueba el borrado definitivo o vacía la papelera antes de tiempo.',
      en: 'Deleted items do not vanish right away: they sit in **Supervision → Approvals**, under the *Trash* tab, for a few days. From there the superadmin can **restore** them exactly as they were, approve the permanent deletion, or empty the trash early.',
      pt: 'O que é apagado não some de imediato: fica em **Supervisão → Aprovações**, na aba *Lixeira*, por alguns dias. Dali o superadmin **restaura** como estava, aprova a exclusão definitiva ou esvazia a lixeira antes do prazo.',
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
