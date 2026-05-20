import type { Language } from '@/stores/userStore';

type L = Record<Language, string>;

export interface ChoiceOption {
  text: L;
  nextId: string;
  points: number;
  feedback?: string;
}

export interface ChoiceNode {
  message: L;
  speaker: 'client' | 'agent';
  options?: ChoiceOption[];
  isEnd?: boolean;
  endType?: 'excellent' | 'good' | 'poor';
  endMessage?: L;
}

export interface ChoiceScenario {
  id: string;
  title: L;
  description: L;
  clientName: string;
  clientCompany: L;
  objective: L;
  startId: string;
  level: 'basico' | 'medio' | 'avanzado';
  nodes: Record<string, ChoiceNode>;
}

export function getChoiceScenario(id: string): ChoiceScenario | undefined {
  return CHOICE_SCENARIOS.find((s) => s.id === id);
}

export function calcMaxPoints(scenario: ChoiceScenario): number {
  let total = 0;
  for (const node of Object.values(scenario.nodes)) {
    if (node.options?.length) {
      total += Math.max(...node.options.map((o) => o.points));
    }
  }
  return total;
}

export const CHOICE_SCENARIOS: ChoiceScenario[] = [
  {
    id: 'cobro-incorrecto',
    title: {
      es: 'Cobro Incorrecto',
      en: 'Incorrect Charge',
      pt: 'Cobrança Incorreta',
    },
    description: {
      es: 'Una cliente reclama un cargo no autorizado de $50 en su cuenta. Debes identificar el problema y ofrecer una solución satisfactoria.',
      en: 'A customer is disputing an unauthorized $50 charge on her account. You must identify the problem and offer a satisfactory solution.',
      pt: 'Uma cliente reclama uma cobrança não autorizada de $50 em sua conta. Você deve identificar o problema e oferecer uma solução satisfatória.',
    },
    clientName: 'María García',
    clientCompany: {
      es: 'Cliente particular',
      en: 'Individual customer',
      pt: 'Cliente particular',
    },
    objective: {
      es: 'Resolver el cobro incorrecto y retener a la cliente',
      en: 'Resolve the incorrect charge and retain the customer',
      pt: 'Resolver a cobrança incorreta e reter a cliente',
    },
    startId: 'start',
    level: 'basico',
    nodes: {
      start: {
        message: {
          es: 'Hola, buenas tardes. Llamo porque me llegó un cobro en mi cuenta de $50 que yo no autoricé. Estoy bastante molesta.',
          en: 'Hello, good afternoon. I\'m calling because there\'s a $50 charge on my account that I didn\'t authorize. I\'m quite upset.',
          pt: 'Olá, boa tarde. Estou ligando porque recebi uma cobrança de $50 na minha conta que não autorizei. Estou bastante aborrecida.',
        },
        speaker: 'client',
        options: [
          {
            text: {
              es: 'Buenas tardes, señora María. Lamento mucho lo ocurrido, entiendo perfectamente su preocupación. Permítame revisar su cuenta de inmediato para identificar ese cargo.',
              en: 'Good afternoon, Mrs. María. I\'m very sorry about what happened, I completely understand your concern. Please allow me to review your account immediately to identify that charge.',
              pt: 'Boa tarde, senhora María. Lamento muito o ocorrido, entendo perfeitamente sua preocupação. Permita-me revisar sua conta imediatamente para identificar essa cobrança.',
            },
            nextId: 'ask_details',
            points: 10,
            feedback: 'Empatía y acción inmediata. Excelente apertura.',
          },
          {
            text: {
              es: 'Buenas tardes. Claro, déjeme verificar eso en su cuenta ahora mismo.',
              en: 'Good afternoon. Of course, let me verify that on your account right now.',
              pt: 'Boa tarde. Claro, deixe-me verificar isso em sua conta agora mesmo.',
            },
            nextId: 'ask_details',
            points: 6,
            feedback: 'Respuesta correcta pero le faltó empatía inicial.',
          },
          {
            text: {
              es: 'Buenas tardes. ¿Puede repetirme su problema con más detalle?',
              en: 'Good afternoon. Could you repeat your problem in more detail?',
              pt: 'Boa tarde. Pode repetir seu problema com mais detalhes?',
            },
            nextId: 'ask_details',
            points: 2,
            feedback: 'La cliente ya explicó su problema. Evita pedirle que repita.',
          },
        ],
      },
      ask_details: {
        message: {
          es: 'El cobro aparece con fecha de ayer y dice "Cargo por servicio premium". Yo nunca solicité ese servicio.',
          en: 'The charge appears with yesterday\'s date and says "Premium service charge". I never requested that service.',
          pt: 'A cobrança aparece com data de ontem e diz "Cobrança por serviço premium". Nunca solicitei esse serviço.',
        },
        speaker: 'client',
        options: [
          {
            text: {
              es: 'Entiendo completamente. Voy a investigar el origen de este cargo ahora mismo. ¿Tiene el número de referencia del cobro para que pueda trazarlo más rápido?',
              en: 'I completely understand. I\'m going to investigate the origin of this charge right now. Do you have the charge reference number so I can trace it faster?',
              pt: 'Entendo completamente. Vou investigar a origem dessa cobrança agora mesmo. Você tem o número de referência da cobrança para que eu possa rastreá-la mais rapidamente?',
            },
            nextId: 'offer_solution',
            points: 10,
            feedback: 'Perfecto: investiga y pide datos concretos para agilizar.',
          },
          {
            text: {
              es: 'De acuerdo, voy a revisarlo en el sistema y le digo qué encontré.',
              en: 'Alright, I\'ll review it in the system and let you know what I find.',
              pt: 'Certo, vou verificar no sistema e te digo o que encontrei.',
            },
            nextId: 'offer_solution',
            points: 5,
            feedback: 'Respuesta aceptable pero sin demostrar urgencia ni empatía.',
          },
          {
            text: {
              es: 'Mmm, ¿está segura de que no lo contrató en algún momento?',
              en: 'Hmm, are you sure you didn\'t contract it at some point?',
              pt: 'Hmm, tem certeza de que não contratou em algum momento?',
            },
            nextId: 'offer_solution',
            points: 1,
            feedback: 'Nunca cuestiones la veracidad del cliente. Esto genera desconfianza.',
          },
        ],
      },
      offer_solution: {
        message: {
          es: 'No, definitivamente no lo contraté. Ya revisé mis correos y no hay ninguna confirmación de ese servicio. ¿Qué van a hacer?',
          en: 'No, I definitely did not contract it. I already checked my emails and there is no confirmation of that service. What are you going to do?',
          pt: 'Não, definitivamente não contratei. Já verifiquei meus e-mails e não há nenhuma confirmação desse serviço. O que vão fazer?',
        },
        speaker: 'client',
        options: [
          {
            text: {
              es: 'Por supuesto. Voy a procesar el reembolso completo de $50 hoy mismo y desactivar ese servicio de inmediato. En 24 horas verá reflejado el abono en su cuenta. ¿Le parece bien?',
              en: 'Of course. I\'m going to process the full $50 refund today and deactivate that service immediately. Within 24 hours you\'ll see the credit in your account. Does that work for you?',
              pt: 'Claro. Vou processar o reembolso completo de $50 hoje mesmo e desativar esse serviço imediatamente. Em 24 horas você verá o crédito na sua conta. Está bem?',
            },
            nextId: 'close_excellent',
            points: 10,
            feedback: '¡Solución concreta, rápida y clara! Esto es gestión de calidad.',
          },
          {
            text: {
              es: 'Puedo hacer la solicitud de devolución, aunque puede tardar entre 5 y 7 días hábiles en procesarse.',
              en: 'I can process the refund request, although it may take between 5 and 7 business days to process.',
              pt: 'Posso fazer a solicitação de devolução, embora possa levar entre 5 e 7 dias úteis para ser processada.',
            },
            nextId: 'close_good',
            points: 5,
            feedback: 'Correcta pero los tiempos largos generan insatisfacción innecesaria.',
          },
          {
            text: {
              es: 'Tendría que pasar el caso a otro departamento especializado para que ellos lo resuelvan.',
              en: 'I would have to transfer the case to another specialized department so they can resolve it.',
              pt: 'Teria que encaminhar o caso para outro departamento especializado para que eles o resolvam.',
            },
            nextId: 'close_poor',
            points: 1,
            feedback: 'Escalar sin intentar resolver genera mucha frustración en el cliente.',
          },
        ],
      },
      close_excellent: {
        message: {
          es: '¡Qué bien! Eso es exactamente lo que necesitaba. Gracias por resolverlo tan rápido. Que tenga muy buen día.',
          en: 'How great! That\'s exactly what I needed. Thank you for resolving it so quickly. Have a wonderful day.',
          pt: 'Que ótimo! Era exatamente o que eu precisava. Obrigada por resolver tão rapidamente. Tenha um ótimo dia.',
        },
        speaker: 'client',
        isEnd: true,
        endType: 'excellent',
        endMessage: {
          es: 'Resolviste la queja del cliente de manera eficiente y empática, logrando su satisfacción total. Demostraste las claves de una atención de excelencia: escucha, empatía y solución inmediata.',
          en: 'You resolved the customer\'s complaint efficiently and empathetically, achieving full satisfaction. You demonstrated the keys to excellent service: listening, empathy, and immediate resolution.',
          pt: 'Você resolveu a reclamação da cliente de forma eficiente e empática, alcançando satisfação total. Demonstrou as chaves de um atendimento de excelência: escuta, empatia e solução imediata.',
        },
      },
      close_good: {
        message: {
          es: 'Está bien, espero que se solucione pronto. Gracias por la atención.',
          en: 'Alright, I hope it gets resolved soon. Thank you for your attention.',
          pt: 'Tudo bem, espero que seja resolvido logo. Obrigada pelo atendimento.',
        },
        speaker: 'client',
        isEnd: true,
        endType: 'good',
        endMessage: {
          es: 'Resolviste el problema pero el cliente no quedó completamente satisfecho con los tiempos de respuesta. Busca siempre acortar los plazos de resolución.',
          en: 'You resolved the problem but the customer wasn\'t completely satisfied with the response times. Always look to shorten resolution deadlines.',
          pt: 'Você resolveu o problema, mas a cliente não ficou completamente satisfeita com os prazos de resposta. Sempre busque encurtar os prazos de resolução.',
        },
      },
      close_poor: {
        message: {
          es: '¿Otro departamento? Esto es una pérdida de tiempo. Llevo rato esperando solución. Voy a hacer una queja formal.',
          en: 'Another department? This is a waste of time. I\'ve been waiting for a solution for a while. I\'m going to file a formal complaint.',
          pt: 'Outro departamento? Isso é uma perda de tempo. Estou esperando por uma solução há um tempo. Vou fazer uma reclamação formal.',
        },
        speaker: 'client',
        isEnd: true,
        endType: 'poor',
        endMessage: {
          es: 'El cliente escaló su queja. Tenías las herramientas para resolver el problema directamente. Intenta siempre ofrecer soluciones concretas antes de escalar.',
          en: 'The customer escalated their complaint. You had the tools to solve the problem directly. Always try to offer concrete solutions before escalating.',
          pt: 'A cliente escalou sua reclamação. Você tinha as ferramentas para resolver o problema diretamente. Tente sempre oferecer soluções concretas antes de escalar.',
        },
      },
    },
  },
  {
    id: 'retencion-cliente',
    title: {
      es: 'Retención de Cliente',
      en: 'Customer Retention',
      pt: 'Retenção de Cliente',
    },
    description: {
      es: 'Un cliente amenaza con cancelar su servicio por una oferta de la competencia. Debes escuchar sus razones y construir una propuesta de valor convincente.',
      en: 'A customer threatens to cancel their service due to a competitor\'s offer. You must listen to their reasons and build a convincing value proposition.',
      pt: 'Um cliente ameaça cancelar seu serviço por uma oferta da concorrência. Você deve escutar suas razões e construir uma proposta de valor convincente.',
    },
    clientName: 'Carlos Mendoza',
    clientCompany: {
      es: 'Empresa mediana',
      en: 'Mid-size company',
      pt: 'Empresa de médio porte',
    },
    objective: {
      es: 'Retener al cliente ofreciendo una propuesta de valor superior',
      en: 'Retain the customer by offering a superior value proposition',
      pt: 'Reter o cliente oferecendo uma proposta de valor superior',
    },
    startId: 'start',
    level: 'medio',
    nodes: {
      start: {
        message: {
          es: 'Hola, llamo para cancelar mi contrato. He decidido irme con la competencia, me ofrecen el mismo servicio un 30% más barato.',
          en: 'Hello, I\'m calling to cancel my contract. I\'ve decided to go with the competition, they offer the same service 30% cheaper.',
          pt: 'Olá, estou ligando para cancelar meu contrato. Decidi ir para a concorrência, eles oferecem o mesmo serviço 30% mais barato.',
        },
        speaker: 'client',
        options: [
          {
            text: {
              es: 'Hola Carlos, lamento escuchar eso. Antes de proceder con la cancelación, me gustaría entender qué podríamos mejorar para ofrecerle una solución a su medida. ¿Me permite un momento de su tiempo?',
              en: 'Hello Carlos, I\'m sorry to hear that. Before processing the cancellation, I\'d like to understand what we could improve to offer you a tailored solution. May I have a moment of your time?',
              pt: 'Olá Carlos, lamento ouvir isso. Antes de prosseguir com o cancelamento, gostaria de entender o que poderíamos melhorar para oferecer uma solução sob medida. Posso ter um momento do seu tempo?',
            },
            nextId: 'explore_reason',
            points: 10,
            feedback: 'Perfecto: no procesas la cancelación automáticamente, buscas entender y retener.',
          },
          {
            text: {
              es: 'Hola. Claro, puedo procesar su cancelación. ¿Está totalmente seguro de su decisión?',
              en: 'Hello. Sure, I can process your cancellation. Are you completely sure of your decision?',
              pt: 'Olá. Claro, posso processar seu cancelamento. Tem certeza absoluta da sua decisão?',
            },
            nextId: 'explore_reason',
            points: 3,
            feedback: 'Iniciar con "puedo cancelarlo" acelera la pérdida del cliente. Primero escucha.',
          },
          {
            text: {
              es: 'Hola Carlos. ¿Y qué oferta concreta le hace la competencia?',
              en: 'Hello Carlos. And what specific offer is the competition making you?',
              pt: 'Olá Carlos. E que oferta concreta a concorrência está fazendo para você?',
            },
            nextId: 'explore_reason',
            points: 6,
            feedback: 'Buena pregunta para entender la competencia, pero faltó empatía inicial.',
          },
        ],
      },
      explore_reason: {
        message: {
          es: 'Básicamente es el precio. Pago $200 al mes y la competencia me ofrece exactamente lo mismo por $140. No tiene lógica pagar más.',
          en: 'Basically it\'s the price. I pay $200 a month and the competition offers exactly the same for $140. It doesn\'t make sense to pay more.',
          pt: 'Basicamente é o preço. Pago $200 por mês e a concorrência oferece exatamente o mesmo por $140. Não faz sentido pagar mais.',
        },
        speaker: 'client',
        options: [
          {
            text: {
              es: 'Entiendo perfectamente, Carlos. El precio importa. Cuénteme, ¿qué funcionalidades usa más frecuentemente? Con esa información puedo evaluar si hay un plan más ajustado a su uso real que podría sorprenderle.',
              en: 'I understand perfectly, Carlos. Price matters. Tell me, which features do you use most frequently? With that information I can evaluate if there\'s a plan more adjusted to your actual use that might surprise you.',
              pt: 'Entendo perfeitamente, Carlos. O preço importa. Me diga, quais recursos você usa com mais frequência? Com essa informação posso avaliar se há um plano mais adequado ao seu uso real que pode surpreendê-lo.',
            },
            nextId: 'make_offer',
            points: 10,
            feedback: 'Excelente: en vez de bajar precio inmediatamente, entiendes el valor real para el cliente.',
          },
          {
            text: {
              es: 'Comprendo. Déjeme ver qué descuento puedo ofrecerle para igualar esa oferta.',
              en: 'I understand. Let me see what discount I can offer you to match that offer.',
              pt: 'Compreendo. Deixe-me ver que desconto posso oferecer para igualar essa oferta.',
            },
            nextId: 'make_offer',
            points: 6,
            feedback: 'Válido, pero ir directamente al descuento sin entender el uso puede ser una oferta genérica.',
          },
          {
            text: {
              es: 'Nuestro servicio tiene una calidad superior a la competencia y mayor soporte técnico.',
              en: 'Our service has superior quality to the competition and better technical support.',
              pt: 'Nosso serviço tem qualidade superior à concorrência e maior suporte técnico.',
            },
            nextId: 'make_offer',
            points: 2,
            feedback: 'Hablar de calidad sin datos concretos no convence. El cliente ya comparó precios.',
          },
        ],
      },
      make_offer: {
        message: {
          es: 'Uso principalmente el almacenamiento en la nube y las videollamadas del equipo. ¿Y qué pueden ofrecerme?',
          en: 'I mainly use cloud storage and team video calls. And what can you offer me?',
          pt: 'Uso principalmente o armazenamento em nuvem e as videochamadas da equipe. E o que podem me oferecer?',
        },
        speaker: 'client',
        options: [
          {
            text: {
              es: 'Para esos dos usos concretos tenemos el plan Colaboración Plus a $145 al mes: igual precio que la competencia pero con 3x más almacenamiento y videollamadas HD ilimitadas. Le ahorra dinero y obtiene más. ¿Lo analizamos?',
              en: 'For those two specific uses we have the Collaboration Plus plan at $145 per month: same price as the competition but with 3x more storage and unlimited HD video calls. You save money and get more. Shall we analyze it?',
              pt: 'Para esses dois usos específicos temos o plano Colaboração Plus a $145 por mês: mesmo preço que a concorrência mas com 3x mais armazenamento e videochamadas HD ilimitadas. Você economiza e obtém mais. Vamos analisar?',
            },
            nextId: 'close_excellent',
            points: 10,
            feedback: '¡Propuesta específica basada en sus necesidades reales! Esto es venta consultiva.',
          },
          {
            text: {
              es: 'Puedo ofrecerle un 20% de descuento permanente en su plan actual si se compromete a 12 meses más.',
              en: 'I can offer you a permanent 20% discount on your current plan if you commit to 12 more months.',
              pt: 'Posso oferecer um desconto permanente de 20% no seu plano atual se você se comprometer com mais 12 meses.',
            },
            nextId: 'close_good',
            points: 6,
            feedback: 'Descuento razonable pero no aprovechaste la información de uso que te dio.',
          },
          {
            text: {
              es: 'Lo siento, el máximo descuento que tengo autorizado es del 10% en su plan actual.',
              en: 'I\'m sorry, the maximum discount I\'m authorized to give is 10% on your current plan.',
              pt: 'Desculpe, o desconto máximo que tenho autorização para dar é 10% no seu plano atual.',
            },
            nextId: 'close_poor',
            points: 2,
            feedback: 'Un 10% es insuficiente frente a un 30% de diferencia. Debías explorar otras opciones.',
          },
        ],
      },
      close_excellent: {
        message: {
          es: 'Vaya, eso no lo sabía. Si el almacenamiento es mayor y el precio es similar, me conviene quedarme con ustedes. Cuéntenme cómo hago el cambio de plan.',
          en: 'Wow, I didn\'t know that. If the storage is greater and the price is similar, it\'s worth staying with you. Tell me how to switch plans.',
          pt: 'Nossa, não sabia disso. Se o armazenamento é maior e o preço é similar, vale a pena ficar com vocês. Me diga como faço a troca de plano.',
        },
        speaker: 'client',
        isEnd: true,
        endType: 'excellent',
        endMessage: {
          es: '¡Retención exitosa! Escuchaste activamente las necesidades del cliente y construiste una propuesta de valor específica y superior. Esto es lo que diferencia a un asesor comercial excepcional.',
          en: 'Successful retention! You actively listened to the customer\'s needs and built a specific and superior value proposition. This is what differentiates an exceptional commercial advisor.',
          pt: 'Retenção bem-sucedida! Você ouviu ativamente as necessidades do cliente e construiu uma proposta de valor específica e superior. Isso é o que diferencia um assessor comercial excepcional.',
        },
      },
      close_good: {
        message: {
          es: 'Hmm, el 20% me deja en $160. Todavía es más caro que la competencia. Déjeme pensarlo y le llamo mañana.',
          en: 'Hmm, the 20% leaves me at $160. Still more expensive than the competition. Let me think about it and I\'ll call you tomorrow.',
          pt: 'Hmm, o 20% me deixa em $160. Ainda é mais caro que a concorrência. Deixa eu pensar e te ligo amanhã.',
        },
        speaker: 'client',
        isEnd: true,
        endType: 'good',
        endMessage: {
          es: 'El cliente está considerando quedarse pero no está convencido. La retención no está garantizada. Profundizar en el valor real hubiera aumentado tus posibilidades.',
          en: 'The customer is considering staying but is not convinced. Retention is not guaranteed. Going deeper into the real value would have increased your chances.',
          pt: 'O cliente está considerando ficar, mas não está convencido. A retenção não está garantida. Aprofundar no valor real teria aumentado suas chances.',
        },
      },
      close_poor: {
        message: {
          es: 'Un 10% no compensa la diferencia. Proceda con la cancelación, por favor. Me voy con la competencia.',
          en: 'A 10% doesn\'t make up for the difference. Please proceed with the cancellation. I\'m going with the competition.',
          pt: 'Um 10% não compensa a diferença. Prossiga com o cancelamento, por favor. Vou para a concorrência.',
        },
        speaker: 'client',
        isEnd: true,
        endType: 'poor',
        endMessage: {
          es: 'El cliente decidió irse. Tenías información valiosa sobre su uso que no aprovechaste para construir una propuesta diferenciada. El precio no siempre es el único factor.',
          en: 'The customer decided to leave. You had valuable information about their usage that you didn\'t use to build a differentiated proposal. Price isn\'t always the only factor.',
          pt: 'O cliente decidiu sair. Você tinha informações valiosas sobre o uso que não aproveitou para construir uma proposta diferenciada. O preço nem sempre é o único fator.',
        },
      },
    },
  },
  {
    id: 'escalacion-tecnica',
    title: {
      es: 'Escalación Técnica Crítica',
      en: 'Critical Technical Escalation',
      pt: 'Escalação Técnica Crítica',
    },
    description: {
      es: 'Un cliente lleva 3 días sin servicio y ha llamado múltiples veces sin solución. Está furioso. Debes manejar la situación con empatía firme y compromisos concretos.',
      en: 'A customer has been without service for 3 days and has called multiple times without a solution. They are furious. You must handle the situation with firm empathy and concrete commitments.',
      pt: 'Um cliente está há 3 dias sem serviço e ligou várias vezes sem solução. Está furioso. Você deve gerenciar a situação com empatia firme e compromissos concretos.',
    },
    clientName: 'Roberto Vargas',
    clientCompany: {
      es: 'PyME — 15 empleados',
      en: 'SME — 15 employees',
      pt: 'PME — 15 funcionários',
    },
    objective: {
      es: 'Recuperar la confianza del cliente y garantizar la resolución del problema',
      en: 'Recover the customer\'s trust and guarantee problem resolution',
      pt: 'Recuperar a confiança do cliente e garantir a resolução do problema',
    },
    startId: 'start',
    level: 'avanzado',
    nodes: {
      start: {
        message: {
          es: '¡Llevo 3 días sin internet y nadie me soluciona nada! He llamado cuatro veces y cada uno me dice algo diferente. Mi empresa está parada. ¡Esto es inaceptable!',
          en: 'I\'ve been without internet for 3 days and nobody solves anything! I\'ve called four times and each one tells me something different. My business is at a standstill. This is unacceptable!',
          pt: 'Estou há 3 dias sem internet e ninguém resolve nada! Liguei quatro vezes e cada um me diz algo diferente. Minha empresa está parada. Isso é inaceitável!',
        },
        speaker: 'client',
        options: [
          {
            text: {
              es: 'Roberto, comprendo perfectamente su frustración y le pido una sincera disculpa en nombre de la empresa por la experiencia tan negativa que ha tenido. Esto no debe ocurrir. Voy a tomar el control total de su caso ahora mismo y no le soltaré hasta que esté resuelto.',
              en: 'Roberto, I perfectly understand your frustration and I sincerely apologize on behalf of the company for the very negative experience you\'ve had. This should not happen. I\'m going to take full control of your case right now and I won\'t let go until it\'s resolved.',
              pt: 'Roberto, compreendo perfeitamente sua frustração e peço uma sincera desculpa em nome da empresa pela experiência tão negativa que teve. Isso não deve ocorrer. Vou assumir o controle total do seu caso agora mesmo e não vou largá-lo até que esteja resolvido.',
            },
            nextId: 'diagnose',
            points: 10,
            feedback: 'Reconoces el error de la empresa, te apropias del problema y das certeza. Manejo de crisis de primer nivel.',
          },
          {
            text: {
              es: 'Lamento mucho la situación, señor Vargas. Permítame revisar los registros de sus llamadas anteriores.',
              en: 'I\'m very sorry about the situation, Mr. Vargas. Please allow me to review the records of your previous calls.',
              pt: 'Lamento muito a situação, senhor Vargas. Permita-me revisar os registros de suas ligações anteriores.',
            },
            nextId: 'diagnose',
            points: 5,
            feedback: 'Correcto pero frío. Ante un cliente tan enojado, primero debes validar su frustración con más intensidad.',
          },
          {
            text: {
              es: 'Cálmese, señor. Vamos a resolver esto paso a paso. ¿Cuál es exactamente el problema?',
              en: 'Please calm down, sir. We\'re going to resolve this step by step. What exactly is the problem?',
              pt: 'Acalme-se, senhor. Vamos resolver isso passo a passo. Qual é exatamente o problema?',
            },
            nextId: 'diagnose',
            points: 2,
            feedback: 'Decirle "cálmese" a un cliente frustrado aumenta el conflicto. Nunca uses esa expresión.',
          },
        ],
      },
      diagnose: {
        message: {
          es: 'Los técnicos dicen que es el router, el área de infraestructura dice que es la línea y el sistema me muestra el servicio activo. Mientras tanto mis empleados no pueden trabajar. ¿Quién tiene razón?',
          en: 'The technicians say it\'s the router, the infrastructure area says it\'s the line, and the system shows the service as active. Meanwhile my employees can\'t work. Who is right?',
          pt: 'Os técnicos dizem que é o roteador, a área de infraestrutura diz que é a linha e o sistema mostra o serviço ativo. Enquanto isso meus funcionários não podem trabalhar. Quem tem razão?',
        },
        speaker: 'client',
        options: [
          {
            text: {
              es: 'Esta contradicción entre áreas es inaceptable y es responsabilidad nuestra, no suya. Voy a abrir un ticket de prioridad máxima, escalar a ingeniería de nivel 2 y garantizarle una llamada de seguimiento en las próximas 2 horas con un diagnóstico definitivo.',
              en: 'This contradiction between departments is unacceptable and it\'s our responsibility, not yours. I\'m going to open a maximum priority ticket, escalate to level 2 engineering, and guarantee you a follow-up call within the next 2 hours with a definitive diagnosis.',
              pt: 'Essa contradição entre áreas é inaceitável e é responsabilidade nossa, não sua. Vou abrir um ticket de prioridade máxima, escalar para engenharia de nível 2 e garantir uma ligação de acompanhamento nas próximas 2 horas com um diagnóstico definitivo.',
            },
            nextId: 'commitment',
            points: 10,
            feedback: 'Asumes la responsabilidad institucional y ofreces pasos concretos con tiempos definidos. Excelente.',
          },
          {
            text: {
              es: 'Voy a enviar un técnico especializado a su domicilio mañana entre las 9am y las 1pm para un diagnóstico presencial.',
              en: 'I\'m going to send a specialized technician to your location tomorrow between 9am and 1pm for an in-person diagnosis.',
              pt: 'Vou enviar um técnico especializado ao seu local amanhã entre 9h e 13h para um diagnóstico presencial.',
            },
            nextId: 'commitment',
            points: 6,
            feedback: 'Buena solución pero "mañana" es tarde para alguien parado 3 días. Necesitas actuar hoy.',
          },
          {
            text: {
              es: 'Déjeme hacer un diagnóstico remoto del sistema desde acá y así identificamos el origen.',
              en: 'Let me do a remote system diagnosis from here and identify the source.',
              pt: 'Deixe-me fazer um diagnóstico remoto do sistema daqui e assim identificamos a origem.',
            },
            nextId: 'commitment',
            points: 3,
            feedback: 'Ya se han hecho diagnósticos. El cliente necesita acción, no otro diagnóstico.',
          },
        ],
      },
      commitment: {
        message: {
          es: '¿Qué garantías me da de que esta vez sí se va a resolver? Ya me han prometido cosas cuatro veces y nada. No tengo por qué creerle.',
          en: 'What guarantees do you give me that this time it will actually be resolved? I\'ve already been promised things four times and nothing happened. I have no reason to believe you.',
          pt: 'Que garantias você me dá de que desta vez vai ser resolvido? Já me prometeram coisas quatro vezes e nada. Não tenho motivo para acreditar em você.',
        },
        speaker: 'client',
        options: [
          {
            text: {
              es: 'Tiene toda la razón en desconfiar. Por eso voy a darle mi número de caso personal, me comprometo a llamarle yo directamente en 2 horas con una actualización real, y además voy a aplicar un crédito del 100% en su próxima factura por los 3 días de servicio interrumpido.',
              en: 'You\'re absolutely right to distrust. That\'s why I\'m going to give you my personal case number, I commit to calling you myself in 2 hours with a real update, and I\'m also going to apply a 100% credit on your next bill for the 3 days of interrupted service.',
              pt: 'Tem toda a razão em desconfiar. Por isso vou dar meu número de caso pessoal, comprometo-me a ligar diretamente em 2 horas com uma atualização real, e também vou aplicar um crédito de 100% na sua próxima fatura pelos 3 dias de serviço interrompido.',
            },
            nextId: 'close_excellent',
            points: 10,
            feedback: 'Reconoces la desconfianza legítima, ofreces responsabilidad personal y compensación tangible. Gestión de crisis magistral.',
          },
          {
            text: {
              es: 'Le asigno un número de ticket prioritario y un agente le contactará dentro del día de hoy.',
              en: 'I\'ll assign you a priority ticket number and an agent will contact you within today.',
              pt: 'Vou atribuir um número de ticket prioritário e um agente entrará em contato hoje.',
            },
            nextId: 'close_good',
            points: 5,
            feedback: 'Respuesta razonable pero impersonal. Un ticket no genera confianza en un cliente que ya llamó 4 veces.',
          },
          {
            text: {
              es: 'Haré todo lo posible para que esto se resuelva lo antes posible, señor Vargas.',
              en: 'I\'ll do everything possible to get this resolved as soon as possible, Mr. Vargas.',
              pt: 'Farei tudo o possível para que isso seja resolvido o mais rápido possível, senhor Vargas.',
            },
            nextId: 'close_poor',
            points: 1,
            feedback: '"Todo lo posible" es una frase vacía para alguien que ya escuchó promesas. Necesitas compromisos específicos y medibles.',
          },
        ],
      },
      close_excellent: {
        message: {
          es: 'Bueno... si me llama en 2 horas con una respuesta real y me aplican el crédito, le doy una última oportunidad. Más vale que esta vez sí se cumpla.',
          en: 'Well... if you call me in 2 hours with a real answer and apply the credit, I\'ll give you one last chance. You better follow through this time.',
          pt: 'Bem... se você me ligar em 2 horas com uma resposta real e aplicar o crédito, vou dar uma última chance. É melhor que desta vez se cumpra.',
        },
        speaker: 'client',
        isEnd: true,
        endType: 'excellent',
        endMessage: {
          es: 'Manejaste una situación de crisis extrema con profesionalismo, empatía y compromisos concretos y personales. El cliente está dispuesto a continuar gracias a tu gestión. Este tipo de interacciones define la reputación de la empresa.',
          en: 'You handled an extreme crisis situation with professionalism, empathy, and concrete personal commitments. The customer is willing to continue thanks to your management. These types of interactions define the company\'s reputation.',
          pt: 'Você gerenciou uma situação de crise extrema com profissionalismo, empatia e compromissos concretos e pessoais. O cliente está disposto a continuar graças à sua gestão. Esse tipo de interação define a reputação da empresa.',
        },
      },
      close_good: {
        message: {
          es: 'De acuerdo. Pero si no me llaman hoy, mañana cancelo el contrato y los demando por los perjuicios.',
          en: 'Alright. But if they don\'t call me today, tomorrow I\'ll cancel the contract and sue you for damages.',
          pt: 'De acordo. Mas se não me ligarem hoje, amanhã cancelo o contrato e processo por danos.',
        },
        speaker: 'client',
        isEnd: true,
        endType: 'good',
        endMessage: {
          es: 'La situación se estabilizó pero hay riesgo latente de pérdida. El cliente necesitaba una respuesta más personal y comprometida. Siempre ofrece responsabilidad individual, no solo tickets.',
          en: 'The situation stabilized but there is a latent risk of loss. The customer needed a more personal and committed response. Always offer individual responsibility, not just tickets.',
          pt: 'A situação se estabilizou, mas há risco latente de perda. O cliente precisava de uma resposta mais pessoal e comprometida. Sempre ofereça responsabilidade individual, não apenas tickets.',
        },
      },
      close_poor: {
        message: {
          es: 'Eso mismo me dijeron las otras cuatro veces. Voy a hablar con mi abogado y a poner una denuncia formal ante el ente regulador. Que tengan buen día.',
          en: 'That\'s exactly what the other four people told me. I\'m going to talk to my lawyer and file a formal complaint with the regulatory authority. Have a good day.',
          pt: 'Foi exatamente o que os outros quatro disseram. Vou falar com meu advogado e fazer uma denúncia formal ao órgão regulador. Tenham um bom dia.',
        },
        speaker: 'client',
        isEnd: true,
        endType: 'poor',
        endMessage: {
          es: 'El cliente escaló a instancias legales. Las frases genéricas no funcionan con clientes que ya agotaron su paciencia. Siempre ofrece compromisos específicos, tiempos concretos y compensación cuando hay una falla de servicio clara.',
          en: 'The customer escalated to legal channels. Generic phrases don\'t work with customers who have already exhausted their patience. Always offer specific commitments, concrete timelines, and compensation when there is a clear service failure.',
          pt: 'O cliente escalou para instâncias legais. Frases genéricas não funcionam com clientes que já esgotaram a paciência. Sempre ofereça compromissos específicos, prazos concretos e compensação quando há uma falha de serviço clara.',
        },
      },
    },
  },
];
