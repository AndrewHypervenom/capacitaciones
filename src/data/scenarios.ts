import type { Country, Language } from '@/stores/userStore';

type L = Record<Language, string>;

export interface ChecklistItem {
  id: string;
  label: L;
  keywords: string[];
}

export interface DialogueBranch {
  keywords: string[];
  next: string;
}

export interface DialogueNode {
  id: string;
  customerLine: L;
  branches: DialogueBranch[];
  /** Node to go to when no branch matches (customer nudges back). */
  fallback?: string;
  /** Optional fallback line override used on mismatches. */
  nudge?: L;
  terminal?: 'resolved' | 'unresolved';
}

export interface Scenario {
  id: string;
  country: Country;
  difficulty: 1 | 2 | 3;
  title: L;
  summary: L;
  customer: {
    name: string;
    phone: string;
    reason: L;
    avatarSeed: number;
  };
  checklist: ChecklistItem[];
  /** Keywords that signal empathy regardless of node. Accumulated across turns. */
  empathyKeywords: string[];
  /** Max turns before auto-ending unresolved. */
  maxTurns: number;
  start: string;
  nodes: Record<string, DialogueNode>;
}

const GREETING = {
  id: 'greeting',
  label: { es: 'Saludo con marca', en: 'Branded greeting', pt: 'Saudação com marca' },
  keywords: ['learningai', 'buenos dias', 'buenas tardes', 'buenas noches', 'hola', 'good morning', 'good afternoon', 'ola', 'bom dia', 'boa tarde'],
};
const IDENTITY = {
  id: 'identity',
  label: { es: 'Verificación de identidad', en: 'Identity verification', pt: 'Verificação de identidade' },
  keywords: ['nombre', 'documento', 'cedula', 'dni', 'numero de cliente', 'identificacion', 'verificar', 'name', 'id number', 'document'],
};
const EMPATHY = {
  id: 'empathy',
  label: { es: 'Empatía y escucha', en: 'Empathy & listening', pt: 'Empatia e escuta' },
  keywords: ['entiendo', 'lamento', 'comprendo', 'disculpa', 'disculpe', 'siento mucho', 'i understand', 'sorry', 'i apologize', 'entendo', 'compreendo', 'sinto muito'],
};
const DIAGNOSIS = {
  id: 'diagnosis',
  label: { es: 'Diagnóstico de la solicitud', en: 'Request diagnosis', pt: 'Diagnóstico da solicitação' },
  keywords: ['cuentame', 'explicame', 'cual es', 'que pasa', 'que sucede', 'tell me', 'what happened', 'me conta', 'o que aconteceu'],
};
const RESOLUTION = {
  id: 'resolution',
  label: { es: 'Propuesta de solución', en: 'Solution proposal', pt: 'Proposta de solução' },
  keywords: ['voy a', 'podemos', 'te ofrezco', 'la solucion', 'vamos a', 'i will', 'we can', 'vou', 'podemos resolver'],
};
const CLOSING = {
  id: 'closing',
  label: { es: 'Cierre profesional', en: 'Professional closing', pt: 'Encerramento profissional' },
  keywords: ['algo mas', 'que tenga', 'excelente dia', 'feliz dia', 'anything else', 'great day', 'mais alguma', 'otimo dia', 'bom dia'],
};

const BASE_EMPATHY = [
  'entiendo',
  'comprendo',
  'lamento',
  'disculpa',
  'disculpe',
  'siento mucho',
  'gracias por',
  'tienes razon',
  'tiene razon',
  'understand',
  'sorry',
  'thank you for',
  'apologize',
  'entendo',
  'compreendo',
  'desculpa',
  'obrigado por',
];

export const SCENARIOS: Scenario[] = [
  {
    id: 'cobro-inesperado-co',
    country: 'CO',
    difficulty: 2,
    title: {
      es: 'Cobro inesperado en la factura',
      en: 'Unexpected charge on the bill',
      pt: 'Cobrança inesperada na fatura',
    },
    summary: {
      es: 'Claudia revisa su factura y encuentra un cargo que no reconoce. Tono contenido pero firme.',
      en: 'Claudia reviews her bill and finds a charge she doesn\'t recognize. Composed but firm tone.',
      pt: 'Claudia revisa sua fatura e encontra uma cobrança que não reconhece. Tom contido mas firme.',
    },
    customer: {
      name: 'Claudia Restrepo',
      phone: '+57 310 •••• 842',
      reason: {
        es: 'Cargo no reconocido de $38.900 en la factura de marzo.',
        en: 'Unrecognized $38,900 COP charge on March bill.',
        pt: 'Cobrança não reconhecida de R$ 38.900 na fatura de março.',
      },
      avatarSeed: 41,
    },
    checklist: [GREETING, IDENTITY, EMPATHY, DIAGNOSIS, RESOLUTION, CLOSING],
    empathyKeywords: BASE_EMPATHY,
    maxTurns: 10,
    start: 'start',
    nodes: {
      start: {
        id: 'start',
        customerLine: {
          es: 'Buenos días… estoy revisando mi factura del mes y hay un cobro de treinta y ocho mil pesos que yo no reconozco. Necesito que me expliquen qué es eso, por favor.',
          en: 'Good morning… I\'m reviewing this month\'s bill and there is a charge for thirty-eight thousand pesos that I don\'t recognize. I need you to explain what that is, please.',
          pt: 'Bom dia… estou revisando a fatura do mês e há uma cobrança de trinta e oito mil pesos que não reconheço. Preciso que me expliquem o que é isso, por favor.',
        },
        branches: [
          { keywords: ['learningai', 'buenos dias', 'buenas tardes', 'hola', 'mi nombre', 'good morning', 'my name', 'bom dia', 'ola'], next: 'askIdentity' },
        ],
        fallback: 'nudgeGreeting',
      },
      nudgeGreeting: {
        id: 'nudgeGreeting',
        customerLine: {
          es: '¿Aló? ¿Con quién estoy hablando? Necesito saber su nombre, por favor.',
          en: 'Hello? Who am I speaking with? I need to know your name, please.',
          pt: 'Alô? Com quem estou falando? Preciso saber seu nome, por favor.',
        },
        branches: [
          { keywords: ['learningai', 'soy', 'mi nombre', 'le habla', 'my name', 'this is', 'meu nome', 'aqui e'], next: 'askIdentity' },
        ],
        fallback: 'askIdentity',
      },
      askIdentity: {
        id: 'askIdentity',
        customerLine: {
          es: 'Mucho gusto. Claudia Restrepo, cédula 1.039.456.721. El cobro aparece el día 14 y dice “servicio adicional”, pero nunca contraté nada adicional.',
          en: 'Nice to meet you. Claudia Restrepo, ID 1.039.456.721. The charge appears on the 14th and says "additional service", but I never contracted anything extra.',
          pt: 'Muito prazer. Claudia Restrepo, documento 1.039.456.721. A cobrança aparece no dia 14 e diz "serviço adicional", mas nunca contratei nada a mais.',
        },
        branches: [
          { keywords: ['entiendo', 'lamento', 'comprendo', 'understand', 'sorry', 'entendo', 'compreendo'], next: 'empathize' },
          { keywords: ['revisar', 'verificar', 'consultar', 'check', 'look', 'verificar', 'consultar'], next: 'investigate' },
        ],
        fallback: 'nudgeListen',
      },
      nudgeListen: {
        id: 'nudgeListen',
        customerLine: {
          es: 'Lo que necesito es que me ayude, por favor. Me urge entender qué es ese cobro.',
          en: 'What I need is for you to help me, please. I really need to understand that charge.',
          pt: 'O que preciso é que você me ajude, por favor. Estou precisando entender essa cobrança.',
        },
        branches: [
          { keywords: ['entiendo', 'lamento', 'comprendo', 'understand', 'sorry', 'entendo'], next: 'empathize' },
          { keywords: ['revisar', 'verificar', 'check', 'verificar'], next: 'investigate' },
        ],
        fallback: 'investigate',
      },
      empathize: {
        id: 'empathize',
        customerLine: {
          es: 'Gracias. Aprecio que me escuche. ¿Puede revisar qué generó ese cargo?',
          en: 'Thank you. I appreciate that you listen. Can you check what generated that charge?',
          pt: 'Obrigada. Aprecio que me escute. Pode verificar o que gerou essa cobrança?',
        },
        branches: [
          { keywords: ['revisar', 'verificar', 'consultar', 'voy a buscar', 'i will check', 'let me check', 'vou verificar'], next: 'investigate' },
        ],
        fallback: 'investigate',
      },
      investigate: {
        id: 'investigate',
        customerLine: {
          es: 'Sí, por favor. Espero en línea.',
          en: 'Yes, please. I\'ll hold.',
          pt: 'Sim, por favor. Aguardo na linha.',
        },
        branches: [
          { keywords: ['servicio adicional', 'demo', 'prueba', 'activacion', 'error', 'additional service', 'trial', 'activation', 'servico adicional'], next: 'explainCharge' },
          { keywords: ['reverso', 'devolver', 'refund', 'reembolso', 'reversar', 'credito', 'credit'], next: 'offerRefund' },
        ],
        fallback: 'explainCharge',
      },
      explainCharge: {
        id: 'explainCharge',
        customerLine: {
          es: 'Yo nunca pedí esa prueba. No recuerdo haberla aceptado. ¿Qué pueden hacer?',
          en: 'I never asked for that trial. I don\'t remember accepting it. What can you do?',
          pt: 'Eu nunca pedi essa demonstração. Não lembro de ter aceitado. O que podem fazer?',
        },
        branches: [
          { keywords: ['reverso', 'devolver', 'refund', 'reembolso', 'ajuste', 'credito', 'vamos a', 'voy a hacer', 'credit', 'adjustment', 'reversar', 'nota credito', 'eliminar cobro', 'quitar cobro'], next: 'offerRefund' },
        ],
        fallback: 'nudgeOffer',
      },
      nudgeOffer: {
        id: 'nudgeOffer',
        customerLine: {
          es: 'Sigo esperando. ¿Qué van a hacer con ese cobro? No pienso pagar algo que no contraté.',
          en: 'I\'m still waiting. What are you going to do about that charge? I\'m not paying for something I didn\'t contract.',
          pt: 'Ainda estou aguardando. O que vão fazer com essa cobrança? Não vou pagar por algo que não contratei.',
        },
        branches: [
          { keywords: ['reverso', 'devolver', 'refund', 'reembolso', 'ajuste', 'credito', 'vamos a', 'voy a hacer', 'credit', 'adjustment', 'reversar', 'nota credito', 'eliminar cobro', 'quitar cobro'], next: 'offerRefund' },
        ],
        fallback: 'nudgeOffer2',
      },
      nudgeOffer2: {
        id: 'nudgeOffer2',
        customerLine: {
          es: 'Mire, necesito que me den una solución concreta ahora. ¿Van a reversar ese cargo o no?',
          en: 'Look, I need a concrete solution right now. Are you going to reverse that charge or not?',
          pt: 'Olha, preciso de uma solução concreta agora. Vão estornar essa cobrança ou não?',
        },
        branches: [
          { keywords: ['reverso', 'devolver', 'refund', 'reembolso', 'ajuste', 'credito', 'vamos a', 'voy a hacer', 'credit', 'adjustment', 'reversar', 'nota credito', 'eliminar cobro', 'quitar cobro', 'si'], next: 'offerRefund' },
        ],
        fallback: 'offerRefund',
      },
      offerRefund: {
        id: 'offerRefund',
        customerLine: {
          es: 'Perfecto, eso me parece justo. ¿Cuándo se refleja?',
          en: 'Perfect, that sounds fair. When will it be reflected?',
          pt: 'Perfeito, me parece justo. Quando aparece?',
        },
        branches: [
          { keywords: ['48 horas', '72 horas', 'proxima factura', 'next bill', '48 hours', 'proximo mes', 'proxima fatura'], next: 'closePositive' },
          { keywords: ['hoy mismo', 'inmediatamente', 'today', 'hoje'], next: 'closePositive' },
        ],
        fallback: 'closePositive',
      },
      closePositive: {
        id: 'closePositive',
        customerLine: {
          es: 'Listo, le agradezco mucho. Ha sido muy amable.',
          en: 'Alright, thanks a lot. You\'ve been very kind.',
          pt: 'Certo, muito obrigada. Você foi muito gentil.',
        },
        branches: [
          { keywords: ['algo mas', 'algo más', 'anything else', 'mais alguma', 'de nada', 'feliz dia', 'great day', 'otimo dia', 'que tenga', 'have a great'], next: 'end_resolved' },
        ],
        fallback: 'end_resolved',
      },
      end_resolved: {
        id: 'end_resolved',
        customerLine: {
          es: 'Igualmente. Hasta luego.',
          en: 'Same to you. Goodbye.',
          pt: 'Igualmente. Até logo.',
        },
        branches: [],
        terminal: 'resolved',
      },
    },
  },

  {
    id: 'soporte-tecnico-mx',
    country: 'MX',
    difficulty: 1,
    title: {
      es: 'Soporte técnico básico',
      en: 'Basic tech support',
      pt: 'Suporte técnico básico',
    },
    summary: {
      es: 'Roberto no puede acceder a su cuenta. Ansioso pero colaborativo.',
      en: 'Roberto cannot access his account. Anxious but cooperative.',
      pt: 'Roberto não consegue acessar sua conta. Ansioso mas colaborativo.',
    },
    customer: {
      name: 'Roberto Méndez',
      phone: '+52 55 •••• 3120',
      reason: {
        es: 'No puede iniciar sesión desde ayer; dice que la contraseña es correcta.',
        en: 'Cannot log in since yesterday; says the password is correct.',
        pt: 'Não consegue entrar desde ontem; diz que a senha está correta.',
      },
      avatarSeed: 22,
    },
    checklist: [GREETING, IDENTITY, EMPATHY, DIAGNOSIS, RESOLUTION, CLOSING],
    empathyKeywords: BASE_EMPATHY,
    maxTurns: 10,
    start: 'start',
    nodes: {
      start: {
        id: 'start',
        customerLine: {
          es: 'Buenas tardes… llevo desde ayer tratando de entrar a mi cuenta y no me deja. Ya intenté tres veces y nada. ¿Me pueden ayudar?',
          en: 'Good afternoon… I\'ve been trying to get into my account since yesterday and it won\'t let me. I\'ve tried three times and nothing. Can you help me?',
          pt: 'Boa tarde… desde ontem tentando entrar na minha conta e não deixa. Já tentei três vezes e nada. Podem me ajudar?',
        },
        branches: [
          { keywords: ['learningai', 'buenas tardes', 'buenos dias', 'hola', 'mi nombre', 'soy', 'good afternoon', 'boa tarde', 'ola'], next: 'askIdentity' },
        ],
        fallback: 'nudgeGreeting',
      },
      nudgeGreeting: {
        id: 'nudgeGreeting',
        customerLine: {
          es: '¿Hola? ¿Me escucha?',
          en: 'Hello? Can you hear me?',
          pt: 'Alô? Está me ouvindo?',
        },
        branches: [
          { keywords: ['si', 'lo escucho', 'soy', 'yes', 'this is', 'sim', 'meu nome'], next: 'askIdentity' },
        ],
        fallback: 'askIdentity',
      },
      askIdentity: {
        id: 'askIdentity',
        customerLine: {
          es: 'Roberto Méndez, correo roberto.m@ejemplo.mx. Es que ya cambié la contraseña dos veces y siguen rechazándomela.',
          en: 'Roberto Méndez, email roberto.m@example.mx. I\'ve changed the password twice and it still rejects it.',
          pt: 'Roberto Méndez, email roberto.m@exemplo.mx. Já mudei a senha duas vezes e continua recusando.',
        },
        branches: [
          { keywords: ['entiendo', 'comprendo', 'lamento', 'understand', 'sorry', 'entendo'], next: 'diagnose' },
          { keywords: ['navegador', 'cache', 'cookies', 'celular', 'dispositivo', 'browser', 'cache', 'device', 'celular'], next: 'diagnose' },
        ],
        fallback: 'nudgeCalm',
      },
      nudgeCalm: {
        id: 'nudgeCalm',
        customerLine: {
          es: 'Es que ya es muy frustrante. Necesito entrar porque tengo un pago pendiente.',
          en: 'It\'s just really frustrating. I need to get in because I have a pending payment.',
          pt: 'Está ficando muito frustrante. Preciso entrar porque tenho um pagamento pendente.',
        },
        branches: [
          { keywords: ['entiendo', 'comprendo', 'lamento', 'understand', 'sorry', 'entendo'], next: 'diagnose' },
          { keywords: ['navegador', 'browser', 'cookies', 'cache'], next: 'diagnose' },
        ],
        fallback: 'diagnose',
      },
      diagnose: {
        id: 'diagnose',
        customerLine: {
          es: 'Estoy en Chrome, en mi laptop. Probé también en el celular y tampoco.',
          en: 'I\'m on Chrome, on my laptop. I also tried on my phone and no luck.',
          pt: 'Estou no Chrome, no laptop. Também testei no celular e nada.',
        },
        branches: [
          { keywords: ['modo incognito', 'incognito', 'ventana privada', 'private window', 'modo anonimo'], next: 'stepsIncognito' },
          { keywords: ['reseteo', 'restablecer', 'recuperar', 'reset', 'recover', 'recuperar'], next: 'stepsReset' },
        ],
        fallback: 'stepsIncognito',
      },
      stepsIncognito: {
        id: 'stepsIncognito',
        customerLine: {
          es: 'Ok, abro una ventana de incógnito… ya estoy. Ingreso mis datos… entré. ¡Genial!',
          en: 'OK, I\'m opening an incognito window… done. I enter my info… I\'m in. Awesome!',
          pt: 'OK, abro uma janela anônima… pronto. Coloco meus dados… entrei. Ótimo!',
        },
        branches: [
          { keywords: ['cache', 'cookies', 'limpiar', 'borrar', 'clear'], next: 'stepsCleanCache' },
          { keywords: ['algo mas', 'algo más', 'anything else', 'mais alguma'], next: 'closePositive' },
        ],
        fallback: 'stepsCleanCache',
      },
      stepsCleanCache: {
        id: 'stepsCleanCache',
        customerLine: {
          es: 'Perfecto, ya limpié el caché de Chrome. Volví a entrar en modo normal y también funciona. Gracias.',
          en: 'Perfect, I cleared Chrome\'s cache. I logged in normal mode and it works too. Thanks.',
          pt: 'Perfeito, limpei o cache do Chrome. Entrei no modo normal e também funciona. Obrigado.',
        },
        branches: [
          { keywords: ['algo mas', 'algo más', 'anything else', 'mais alguma', 'feliz dia', 'excelente dia', 'great day'], next: 'end_resolved' },
        ],
        fallback: 'closePositive',
      },
      stepsReset: {
        id: 'stepsReset',
        customerLine: {
          es: 'Ya pedí recuperar contraseña, no llega el correo. Por eso estoy llamando.',
          en: 'I already requested a reset, the email isn\'t arriving. That\'s why I\'m calling.',
          pt: 'Já pedi para recuperar a senha, o email não chega. Por isso estou ligando.',
        },
        branches: [
          { keywords: ['spam', 'correo no deseado', 'promociones', 'junk', 'promotions'], next: 'stepsIncognito' },
          { keywords: ['manual', 'yo lo hago', 'enviar de nuevo', 'resend'], next: 'stepsIncognito' },
        ],
        fallback: 'stepsIncognito',
      },
      closePositive: {
        id: 'closePositive',
        customerLine: {
          es: 'No, eso sería todo. Muchas gracias.',
          en: 'No, that\'s all. Thanks a lot.',
          pt: 'Não, é só isso. Muito obrigado.',
        },
        branches: [
          { keywords: ['feliz dia', 'excelente dia', 'que tenga', 'great day', 'otimo dia', 'ate logo', 'hasta luego', 'goodbye'], next: 'end_resolved' },
        ],
        fallback: 'end_resolved',
      },
      end_resolved: {
        id: 'end_resolved',
        customerLine: {
          es: 'Hasta luego.',
          en: 'Goodbye.',
          pt: 'Até logo.',
        },
        branches: [],
        terminal: 'resolved',
      },
    },
  },

  {
    id: 'cliente-molesto-ar',
    country: 'AR',
    difficulty: 3,
    title: {
      es: 'Cliente molesto por demora',
      en: 'Upset customer over delays',
      pt: 'Cliente irritado por demora',
    },
    summary: {
      es: 'Martín lleva tres llamadas sin solución. Voseo, tono subido, exige escalamiento.',
      en: 'Martín has called three times with no fix. Argentine voseo, raised tone, demands escalation.',
      pt: 'Martín ligou três vezes sem solução. Voseo argentino, tom elevado, exige escalonamento.',
    },
    customer: {
      name: 'Martín Cabrera',
      phone: '+54 9 11 •••• 7788',
      reason: {
        es: 'Promesa incumplida tras dos llamadas previas. Exige una respuesta firme.',
        en: 'Broken promise after two previous calls. Demands a firm response.',
        pt: 'Promessa não cumprida após duas ligações anteriores. Exige resposta firme.',
      },
      avatarSeed: 77,
    },
    checklist: [GREETING, EMPATHY, DIAGNOSIS, RESOLUTION, CLOSING],
    empathyKeywords: BASE_EMPATHY,
    maxTurns: 12,
    start: 'start',
    nodes: {
      start: {
        id: 'start',
        customerLine: {
          es: 'Mirá, ya es la tercera vez que llamo por lo mismo. Me dijeron que me iban a llamar y nadie me llamó. Necesito que me des una solución YA.',
          en: 'Look, it\'s the third time I\'m calling about the same thing. They said they\'d call me back and nobody did. I need a solution NOW.',
          pt: 'Olha, é a terceira vez que ligo pelo mesmo motivo. Disseram que iam me retornar e ninguém me ligou. Preciso de uma solução AGORA.',
        },
        branches: [
          { keywords: ['entiendo', 'comprendo', 'lamento', 'siento', 'understand', 'apologize', 'sorry', 'entendo', 'sinto muito'], next: 'deescalate' },
          { keywords: ['learningai', 'mi nombre', 'soy', 'buenas', 'my name', 'this is', 'meu nome'], next: 'hostile' },
        ],
        fallback: 'hostile',
      },
      hostile: {
        id: 'hostile',
        customerLine: {
          es: 'No me interesa tu presentación. Quiero saber qué vas a hacer con MI problema.',
          en: 'I don\'t care about your introduction. I want to know what YOU\'re going to do about MY problem.',
          pt: 'Não me interessa sua apresentação. Quero saber o que VOCÊ vai fazer com o MEU problema.',
        },
        branches: [
          { keywords: ['entiendo', 'comprendo', 'lamento', 'siento', 'disculpa', 'understand', 'sorry', 'apologize', 'entendo', 'sinto muito'], next: 'deescalate' },
        ],
        fallback: 'escalateHeat',
      },
      escalateHeat: {
        id: 'escalateHeat',
        customerLine: {
          es: 'Pasame con un supervisor. No voy a perder más tiempo.',
          en: 'Get me a supervisor. I\'m not wasting any more time.',
          pt: 'Me passe para um supervisor. Não vou perder mais tempo.',
        },
        branches: [
          { keywords: ['entiendo', 'comprendo', 'lamento', 'dejame', 'permitame', 'voy a ayudar', 'understand', 'apologize', 'let me help'], next: 'deescalate' },
          { keywords: ['supervisor', 'escalamiento', 'escalar', 'transferir', 'escalate', 'transfer'], next: 'escalate' },
        ],
        fallback: 'escalate',
      },
      deescalate: {
        id: 'deescalate',
        customerLine: {
          es: 'Está bien… te escucho. Pero te aviso que si esta llamada no resuelve nada, cancelo.',
          en: 'Fine… I\'m listening. But I warn you, if this call doesn\'t fix anything, I\'m cancelling.',
          pt: 'Tudo bem… te escuto. Mas te aviso, se essa ligação não resolver, cancelo.',
        },
        branches: [
          { keywords: ['cuentame', 'contame', 'que paso', 'detalles', 'tell me', 'what happened', 'me conta'], next: 'diagnose' },
        ],
        fallback: 'diagnose',
      },
      diagnose: {
        id: 'diagnose',
        customerLine: {
          es: 'El servicio que contraté el 3 se iba a activar en 48 horas. Hace nueve días que no funciona nada. Dos veces llamé y me dijeron que ya quedaba activo hoy o mañana. Nada.',
          en: 'The service I signed up for on the 3rd was supposed to activate in 48 hours. It\'s been nine days with nothing working. I called twice and was told it would activate today or tomorrow. Nothing.',
          pt: 'O serviço que contratei no dia 3 ia ativar em 48 horas. Faz nove dias sem nada funcionar. Liguei duas vezes e me disseram que ativaria hoje ou amanhã. Nada.',
        },
        branches: [
          { keywords: ['compensacion', 'descuento', 'compensation', 'credito', 'credit', 'ajuste', 'bonificacion', 'desconto'], next: 'offerComp' },
          { keywords: ['escalar', 'supervisor', 'priorizar', 'tecnico', 'escalate', 'priority', 'prioridade'], next: 'offerComp' },
        ],
        fallback: 'offerComp',
      },
      offerComp: {
        id: 'offerComp',
        customerLine: {
          es: '¿Y cuándo se activa? Necesito una fecha concreta, no otra promesa vacía.',
          en: 'And when does it activate? I need a concrete date, not another empty promise.',
          pt: 'E quando ativa? Preciso de uma data concreta, não outra promessa vazia.',
        },
        branches: [
          { keywords: ['hoy', '24 horas', 'manana', 'today', 'tomorrow', '24 hours', 'amanha'], next: 'confirmPlan' },
          { keywords: ['48 horas', 'en 2 dias', '48 hours'], next: 'confirmPlan' },
        ],
        fallback: 'confirmPlan',
      },
      confirmPlan: {
        id: 'confirmPlan',
        customerLine: {
          es: 'Bueno, dale. Quedo atento. Si no sucede, vuelvo a llamar y cancelo.',
          en: 'OK, fine. I\'ll keep an eye out. If it doesn\'t happen, I\'ll call back and cancel.',
          pt: 'Tá, beleza. Fico atento. Se não acontecer, ligo de volta e cancelo.',
        },
        branches: [
          { keywords: ['numero de caso', 'ticket', 'seguimiento', 'case number', 'folio', 'protocolo'], next: 'closePositive' },
          { keywords: ['algo mas', 'algo más', 'anything else', 'mais alguma'], next: 'closePositive' },
        ],
        fallback: 'closePositive',
      },
      escalate: {
        id: 'escalate',
        customerLine: {
          es: 'Más te vale. Te paso a escuchar.',
          en: 'You better. Go ahead.',
          pt: 'É melhor mesmo. Te escuto.',
        },
        branches: [
          { keywords: ['dejame resolver', 'permitame', 'puedo ayudar', 'let me help', 'i can help', 'deixa eu resolver'], next: 'deescalate' },
        ],
        fallback: 'deescalate',
      },
      closePositive: {
        id: 'closePositive',
        customerLine: {
          es: 'Listo, gracias. Anota bien esto por favor. Adiós.',
          en: 'OK, thanks. Log this properly please. Bye.',
          pt: 'Certo, obrigado. Anota direito por favor. Tchau.',
        },
        branches: [
          { keywords: ['excelente dia', 'feliz dia', 'buen dia', 'great day', 'otimo dia', 'que tenga'], next: 'end_resolved' },
        ],
        fallback: 'end_resolved',
      },
      end_resolved: {
        id: 'end_resolved',
        customerLine: {
          es: 'Adiós.',
          en: 'Bye.',
          pt: 'Tchau.',
        },
        branches: [],
        terminal: 'resolved',
      },
    },
  },

  {
    id: 'confusion-plan-mx',
    country: 'MX',
    difficulty: 1,
    title: {
      es: 'Confusión sobre su plan',
      en: 'Confusion about their plan',
      pt: 'Confusão sobre o plano',
    },
    summary: {
      es: 'Lucía no entiende qué incluye su plan actual. Tono curioso y abierto.',
      en: 'Lucía doesn\'t understand what her current plan includes. Curious, open tone.',
      pt: 'Lucía não entende o que seu plano atual inclui. Tom curioso e aberto.',
    },
    customer: {
      name: 'Lucía Hernández',
      phone: '+52 33 •••• 5540',
      reason: {
        es: 'Quiere saber si su plan incluye roaming para un viaje a Colombia.',
        en: 'Wants to know if her plan includes roaming for a trip to Colombia.',
        pt: 'Quer saber se o plano inclui roaming para uma viagem à Colômbia.',
      },
      avatarSeed: 12,
    },
    checklist: [GREETING, IDENTITY, EMPATHY, DIAGNOSIS, RESOLUTION, CLOSING],
    empathyKeywords: BASE_EMPATHY,
    maxTurns: 9,
    start: 'start',
    nodes: {
      start: {
        id: 'start',
        customerLine: {
          es: 'Hola, buenas. Una consulta: viajo la semana que viene a Colombia y quiero saber si con mi plan puedo usar el celular allá sin que me cobren una locura.',
          en: 'Hi, good afternoon. Quick question: I\'m travelling to Colombia next week and I want to know if I can use my phone there with my plan without getting charged crazy fees.',
          pt: 'Oi, boa tarde. Uma dúvida: viajo para a Colômbia semana que vem e quero saber se posso usar o celular lá com meu plano sem ser cobrado absurdos.',
        },
        branches: [
          { keywords: ['learningai', 'buenas tardes', 'buenos dias', 'hola', 'mi nombre', 'good afternoon', 'my name', 'bom dia', 'boa tarde'], next: 'askIdentity' },
        ],
        fallback: 'nudgeGreeting',
      },
      nudgeGreeting: {
        id: 'nudgeGreeting',
        customerLine: {
          es: '¿Bueno? ¿Me escuchan?',
          en: 'Hello? Can you hear me?',
          pt: 'Alô? Está me ouvindo?',
        },
        branches: [
          { keywords: ['si', 'mi nombre', 'yes', 'this is'], next: 'askIdentity' },
        ],
        fallback: 'askIdentity',
      },
      askIdentity: {
        id: 'askIdentity',
        customerLine: {
          es: 'Lucía Hernández, mi número termina en 5540. Quiero saber si tengo roaming incluido.',
          en: 'Lucía Hernández, my number ends in 5540. I want to know if I have roaming included.',
          pt: 'Lucía Hernández, meu número termina em 5540. Quero saber se tenho roaming incluído.',
        },
        branches: [
          { keywords: ['gusto', 'verifico', 'reviso', 'voy a consultar', 'let me check', 'verifico', 'consultar'], next: 'diagnose' },
          { keywords: ['entiendo', 'comprendo', 'understand', 'entendo'], next: 'diagnose' },
        ],
        fallback: 'diagnose',
      },
      diagnose: {
        id: 'diagnose',
        customerLine: {
          es: 'Perfecto, espero.',
          en: 'Perfect, I\'ll wait.',
          pt: 'Perfeito, aguardo.',
        },
        branches: [
          { keywords: ['plan', 'no incluye', 'incluye', 'no tienes', 'not included', 'included'], next: 'explainPlan' },
        ],
        fallback: 'explainPlan',
      },
      explainPlan: {
        id: 'explainPlan',
        customerLine: {
          es: 'Ah, entiendo. ¿Y qué opciones tengo?',
          en: 'Ah, I see. What options do I have?',
          pt: 'Ah, entendi. E que opções eu tenho?',
        },
        branches: [
          { keywords: ['paquete', 'roaming', 'dia', 'activar', 'add on', 'package', 'pacote'], next: 'offerAddon' },
        ],
        fallback: 'offerAddon',
      },
      offerAddon: {
        id: 'offerAddon',
        customerLine: {
          es: 'Me interesa. ¿Cuánto sale?',
          en: 'I\'m interested. How much is it?',
          pt: 'Tenho interesse. Quanto custa?',
        },
        branches: [
          { keywords: ['pesos', 'dolares', 'por dia', 'per day', 'reales'], next: 'confirm' },
          { keywords: ['activar', 'lo activo', 'activate', 'ativar'], next: 'confirm' },
        ],
        fallback: 'confirm',
      },
      confirm: {
        id: 'confirm',
        customerLine: {
          es: 'Dale, activalo por favor. Sale de viaje el lunes.',
          en: 'OK, activate it please. I leave on Monday.',
          pt: 'Tá, ativa por favor. Viajo segunda.',
        },
        branches: [
          { keywords: ['activado', 'listo', 'confirmado', 'done', 'activated', 'ativado'], next: 'closePositive' },
        ],
        fallback: 'closePositive',
      },
      closePositive: {
        id: 'closePositive',
        customerLine: {
          es: 'Genial, muchas gracias.',
          en: 'Great, thanks a lot.',
          pt: 'Ótimo, muito obrigada.',
        },
        branches: [
          { keywords: ['algo mas', 'anything else', 'feliz dia', 'great day', 'otimo dia', 'hasta luego'], next: 'end_resolved' },
        ],
        fallback: 'end_resolved',
      },
      end_resolved: {
        id: 'end_resolved',
        customerLine: {
          es: 'Hasta luego.',
          en: 'Goodbye.',
          pt: 'Até logo.',
        },
        branches: [],
        terminal: 'resolved',
      },
    },
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
