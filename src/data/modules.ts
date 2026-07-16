import type { Language } from '@/stores/userStore';
import type { ContentBlock } from '@/types/blocks';

export interface SectionQuiz {
  question: Record<Language, string>;
  options: Record<Language, string[]>;
  correct: number;
  explanation: Record<Language, string>;
}

export interface SectionMedia {
  type: 'image' | 'youtube' | 'vimeo' | 'video';
  url: string;
  caption?: Record<Language, string>;
  size?: MediaSize;
  align?: MediaAlign;
  shadow?: boolean;
}

export type CalloutKind = 'tip' | 'important' | 'warning' | 'success' | 'quote' | 'note';
export type SectionStyle = 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | 'game-sort' | 'game-classify';
export type MediaSize = 'sm' | 'md' | 'lg' | 'full' | 'bleed';
export type MediaAlign = 'left' | 'center' | 'right';

// ─── Video Interactive types ───────────────────────────────────

export interface VideoQuizQuestion {
  id: string;
  question: Record<Language, string>;
  options: Record<Language, string[]>;
  correct: number;
  explanation: Record<Language, string>;
}

export interface VideoChapterMarker {
  id: string;
  timeSeconds: number;
  type: 'chapter';
  title: Record<Language, string>;
}

export interface VideoQuizMarker {
  id: string;
  timeSeconds: number;
  type: 'quiz';
  title: Record<Language, string>;
  questions: VideoQuizQuestion[];
}

export type VideoMarker = VideoChapterMarker | VideoQuizMarker;

// ──────────────────────────────────────────────────────────────

export interface ModuleSection {
  id?: string;
  heading: Record<Language, string>;
  body: Record<Language, string[]>;
  media?: SectionMedia;
  callout?: {
    kind: CalloutKind;
    text: Record<Language, string>;
  };
  quiz?: SectionQuiz;
  style?: SectionStyle;
  videoMarkers?: VideoMarker[];
  /** Rich content blocks. When present, rendered instead of body/callout/quiz. */
  blocks?: ContentBlock[];
}

export interface SectionMediaMeta {
  size?: MediaSize;
  align?: MediaAlign;
  shadow?: boolean;
}

export interface LearningModule {
  id: string;
  dbId?: string;
  campaign_id?: string;
  /** Curso al que pertenece; null/undefined = Plan de Formación general */
  courseId?: string | null;
  courseSortOrder?: number;
  title: Record<Language, string>;
  subtitle: Record<Language, string>;
  icon: string;
  duration: number;
  objectives: Record<Language, string[]>;
  keyTakeaways: Record<Language, string[]>;
  /** Tema de sonido de los quizzes ('chime' | 'arcade' | 'soft' | 'off'). */
  soundTheme?: string;
  sections: ModuleSection[];
}

const T = (es: string, en: string, pt: string) => ({ es, en, pt });
const TL = (es: string[], en: string[], pt: string[]) => ({ es, en, pt });

export const MODULES: LearningModule[] = [
  {
    id: 'bienvenida',
    dbId: 'tu-uuid-aqui',
    icon: 'Sparkles',
    duration: 8,
    title: T('Bienvenida a la operación', 'Operation onboarding', 'Bem-vindo à operação'),
    subtitle: T(
      'Conoce la cultura, la misión y qué se espera de ti en tu primera semana.',
      'Meet the culture, mission and what is expected of you in your first week.',
      'Conheça a cultura, a missão e o que se espera de você na primeira semana.',
    ),
    objectives: TL(
      [
        'Comprender la misión y el alcance de la operación regional.',
        'Identificar el protocolo base de toda llamada.',
        'Saber por qué la disposición correcta importa para todo el equipo.',
      ],
      [
        'Understand the mission and scope of the regional operation.',
        'Identify the base protocol present in every call.',
        'Know why the right disposition matters for the whole team.',
      ],
      [
        'Compreender a missão e o escopo da operação regional.',
        'Identificar o protocolo base presente em toda chamada.',
        'Saber por que a disposição correta importa para todo o time.',
      ],
    ),
    keyTakeaways: TL(
      [
        'Cada contacto es una persona confiando en una solución rápida y humana.',
        'Saludo, verificación, diagnóstico, resolución y cierre — siempre en ese orden.',
        'Disposiciones precisas alimentan las métricas que sostienen al equipo.',
      ],
      [
        'Every contact is a person trusting us for a fast, human solution.',
        'Greeting, verification, diagnosis, resolution and closing — always in that order.',
        'Precise dispositions feed the metrics that sustain the team.',
      ],
      [
        'Cada contato é uma pessoa confiando em uma solução rápida e humana.',
        'Saudação, verificação, diagnóstico, resolução e encerramento — sempre nessa ordem.',
        'Disposições precisas alimentam as métricas que sustentam o time.',
      ],
    ),
    sections: [
      {
        style: 'video-interactive' as const,
        heading: T('Video de introducción', 'Introduction video', 'Vídeo de introdução'),
        body: TL([], [], []),
        media: {
          type: 'video' as const,
          url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        },
        videoMarkers: [
          {
            id: 'c1', timeSeconds: 5, type: 'chapter' as const,
            title: T('Bienvenida al equipo', 'Team welcome', 'Boas-vindas à equipe'),
          },
          {
            id: 'c2', timeSeconds: 25, type: 'chapter' as const,
            title: T('Nuestra misión', 'Our mission', 'Nossa missão'),
          },
          {
            id: 'q1', timeSeconds: 55, type: 'quiz' as const,
            title: T('Verificación 1 · Misión y alcance', 'Check 1 · Mission & scope', 'Verificação 1 · Missão e escopo'),
            questions: [
              {
                id: 'q1p1',
                question: T(
                  '¿Cuál es el objetivo principal de la operación?',
                  'What is the main goal of the operation?',
                  'Qual é o objetivo principal da operação?',
                ),
                options: {
                  es: ['Reducir costos operativos al mínimo', 'Brindar experiencias memorables en cada llamada', 'Aumentar las ventas por llamada', 'Gestionar quejas de clientes'],
                  en: ['Minimize operating costs', 'Deliver memorable experiences on every call', 'Increase per-call sales', 'Manage customer complaints'],
                  pt: ['Minimizar custos operacionais', 'Entregar experiências memoráveis em cada ligação', 'Aumentar vendas por ligação', 'Gerenciar reclamações de clientes'],
                },
                correct: 1,
                explanation: T(
                  'La excelencia en el servicio es el diferenciador clave. Cada llamada es una persona confiando en una solución rápida y humana.',
                  'Service excellence is the key differentiator. Every call is a person trusting us for a fast, human solution.',
                  'A excelência no serviço é o diferencial-chave. Cada ligação é uma pessoa confiando em uma solução rápida e humana.',
                ),
              },
              {
                id: 'q1p2',
                question: T(
                  '¿Cuántos países cubre la operación?',
                  'How many countries does the operation cover?',
                  'Quantos países a operação cobre?',
                ),
                options: {
                  es: ['Solo Colombia', 'Colombia y México', 'Colombia, México y Argentina', 'Toda Latinoamérica'],
                  en: ['Colombia only', 'Colombia and Mexico', 'Colombia, Mexico and Argentina', 'All of Latin America'],
                  pt: ['Apenas Colômbia', 'Colômbia e México', 'Colômbia, México e Argentina', 'Toda a América Latina'],
                },
                correct: 2,
                explanation: T(
                  'La operación atiende clientes en Colombia, México y Argentina desde una misma plataforma LearningAI.',
                  'The operation serves customers in Colombia, Mexico and Argentina from one LearningAI platform.',
                  'A operação atende clientes na Colômbia, México e Argentina a partir de uma única plataforma LearningAI.',
                ),
              },
              {
                id: 'q1p3',
                question: T(
                  '¿Qué plataforma coordina toda la operación?',
                  'Which platform coordinates the entire operation?',
                  'Qual plataforma coordena toda a operação?',
                ),
                options: {
                  es: ['Salesforce', 'Zendesk', 'LearningAI', 'Freshdesk'],
                  en: ['Salesforce', 'Zendesk', 'LearningAI', 'Freshdesk'],
                  pt: ['Salesforce', 'Zendesk', 'LearningAI', 'Freshdesk'],
                },
                correct: 2,
                explanation: T(
                  'LearningAI es la plataforma centralizada que une los tres países bajo una misma gestión.',
                  'LearningAI is the centralized platform that unites the three countries under one management.',
                  'LearningAI é a plataforma centralizada que une os três países sob uma mesma gestão.',
                ),
              },
            ],
          },
          {
            id: 'c3', timeSeconds: 90, type: 'chapter' as const,
            title: T('Protocolo de llamada', 'Call protocol', 'Protocolo de chamada'),
          },
          {
            id: 'q2', timeSeconds: 130, type: 'quiz' as const,
            title: T('Verificación final · Protocolo', 'Final check · Protocol', 'Verificação final · Protocolo'),
            questions: [
              {
                id: 'q2p1',
                question: T(
                  '¿Cuándo debes registrar la disposición de la llamada?',
                  'When should you record the call disposition?',
                  'Quando você deve registrar a disposição da chamada?',
                ),
                options: {
                  es: ['Al final del turno, en lote', 'Solo si el supervisor lo pide', 'Antes de tomar la siguiente llamada', 'Una vez al día'],
                  en: ['At end of shift, in batch', 'Only when supervisor requests it', 'Before taking the next call', 'Once a day'],
                  pt: ['No final do turno, em lote', 'Apenas quando o supervisor pedir', 'Antes de atender a próxima chamada', 'Uma vez ao dia'],
                },
                correct: 2,
                explanation: T(
                  'Cada llamada se cierra con su disposición antes de pasar a la siguiente — siempre, sin excepción.',
                  'Every call closes with its disposition before the next — always, no exception.',
                  'Cada chamada é encerrada com sua disposição antes da próxima — sempre, sem exceção.',
                ),
              },
              {
                id: 'q2p2',
                question: T(
                  '¿Cuál es el primer paso en el protocolo de toda llamada?',
                  'What is the first step in every call protocol?',
                  'Qual é o primeiro passo no protocolo de toda chamada?',
                ),
                options: {
                  es: ['Diagnóstico del problema', 'Verificación de identidad', 'Saludo', 'Ofrecer solución'],
                  en: ['Problem diagnosis', 'Identity verification', 'Greeting', 'Offer solution'],
                  pt: ['Diagnóstico do problema', 'Verificação de identidade', 'Saudação', 'Oferecer solução'],
                },
                correct: 2,
                explanation: T(
                  'El saludo siempre es el primer paso. Crea la primera impresión y establece el tono de la llamada.',
                  'The greeting is always the first step. It creates the first impression and sets the call tone.',
                  'A saudação é sempre o primeiro passo. Ela cria a primeira impressão e define o tom da chamada.',
                ),
              },
            ],
          },
          {
            id: 'c4', timeSeconds: 175, type: 'chapter' as const,
            title: T('Cierre y resumen', 'Wrap-up & summary', 'Encerramento e resumo'),
          },
        ],
      },
      {
        heading: T('Nuestra misión', 'Our mission', 'Nossa missão'),
        body: {
          es: [
            'Entregamos experiencias memorables en cada llamada. Detrás de cada contacto hay una persona confiando en que encontraremos una solución rápida, humana y clara.',
            'Este módulo es una visión panorámica: la operación atiende clientes en Colombia, México y Argentina desde una misma plataforma LearningAI, coordinada por supervisores regionales.',
          ],
          en: [
            'We deliver memorable experiences on every call. Behind each contact there is a person trusting us to find a fast, human and clear solution.',
            'This module is a panoramic view: the operation serves customers in Colombia, Mexico and Argentina from one LearningAI platform, coordinated by regional supervisors.',
          ],
          pt: [
            'Entregamos experiências memoráveis em cada ligação. Atrás de cada contato há uma pessoa confiando que encontraremos uma solução rápida, humana e clara.',
            'Este módulo é uma visão panorâmica: a operação atende clientes na Colômbia, México e Argentina a partir de uma única plataforma LearningAI, coordenada por supervisores regionais.',
          ],
        },
        quiz: {
          question: T(
            '¿Qué describe mejor el alcance de la operación?',
            'Which best describes the operation scope?',
            'O que descreve melhor o escopo da operação?',
          ),
          options: {
            es: [
              'Solo Colombia, con supervisores locales.',
              'Tres países (CO, MX, AR) coordinados desde una sola plataforma LearningAI.',
              'Una operación global multilenguaje.',
            ],
            en: [
              'Colombia only, with local supervisors.',
              'Three countries (CO, MX, AR) coordinated from a single LearningAI platform.',
              'A global multilingual operation.',
            ],
            pt: [
              'Apenas Colômbia, com supervisores locais.',
              'Três países (CO, MX, AR) coordenados em uma única plataforma LearningAI.',
              'Uma operação global multilíngue.',
            ],
          },
          correct: 1,
          explanation: T(
            'La operación cubre CO, MX y AR sobre una misma plataforma LearningAI con supervisores regionales.',
            'The operation covers CO, MX and AR on the same LearningAI platform with regional supervisors.',
            'A operação cobre CO, MX e AR na mesma plataforma LearningAI com supervisores regionais.',
          ),
        },
      },
      {
        heading: T('Qué se espera de ti', 'What we expect from you', 'O que esperamos de você'),
        body: {
          es: [
            'Puntualidad absoluta en el login de LearningAI al inicio del turno.',
            'Seguir el protocolo de saludo, verificación de identidad, diagnóstico, resolución y cierre.',
            'Documentar cada llamada con la disposición correcta antes de pasar a la siguiente.',
          ],
          en: [
            'Absolute punctuality when logging into LearningAI at shift start.',
            'Follow the protocol: greeting, ID verification, diagnosis, resolution and closing.',
            'Document every call with the correct disposition before taking the next one.',
          ],
          pt: [
            'Pontualidade absoluta no login do LearningAI no início do turno.',
            'Seguir o protocolo: saudação, verificação de identidade, diagnóstico, resolução e encerramento.',
            'Documentar cada ligação com a disposição correta antes de atender a próxima.',
          ],
        },
        callout: {
          kind: 'tip',
          text: T(
            'Tu disciplina con las disposiciones mantiene al equipo entero midiendo lo correcto.',
            'Your discipline with dispositions keeps the whole team measuring the right things.',
            'Sua disciplina com as disposições mantém todo o time medindo o que importa.',
          ),
        },
        quiz: {
          question: T(
            '¿Cuándo documentas la disposición de la llamada?',
            'When do you document the call disposition?',
            'Quando você documenta a disposição da chamada?',
          ),
          options: {
            es: [
              'Al final del turno, en lote.',
              'Antes de tomar la siguiente llamada.',
              'Solo si el supervisor lo pide.',
            ],
            en: [
              'At the end of the shift, in batch.',
              'Before taking the next call.',
              'Only when the supervisor asks for it.',
            ],
            pt: [
              'No final do turno, em lote.',
              'Antes de atender a próxima chamada.',
              'Apenas se o supervisor pedir.',
            ],
          },
          correct: 1,
          explanation: T(
            'Cada llamada se cierra con su disposición antes de pasar a la siguiente — siempre.',
            'Every call closes with its disposition before moving to the next — always.',
            'Cada chamada é fechada com sua disposição antes de passar à próxima — sempre.',
          ),
        },
      },
    ],
  },
  {
    id: 'plataforma-fundamentos',
    icon: 'Headphones',
    duration: 14,
    title: T('Fundamentos de LearningAI', 'LearningAI fundamentals', 'Fundamentos do LearningAI'),
    subtitle: T(
      'Interfaz, estados del agente, disposiciones y atajos que usarás todos los días.',
      'Interface, agent states, dispositions and shortcuts you will use every day.',
      'Interface, estados do agente, disposições e atalhos do dia a dia.',
    ),
    objectives: TL(
      [
        'Distinguir entre los estados READY, NOT READY y ACW.',
        'Reconocer cada zona de la interfaz LearningAI.',
        'Aplicar buenas prácticas con el softphone.',
      ],
      [
        'Distinguish between READY, NOT READY and ACW states.',
        'Recognize every zone of the LearningAI interface.',
        'Apply best practices with the softphone.',
      ],
      [
        'Distinguir entre os estados READY, NOT READY e ACW.',
        'Reconhecer cada área da interface LearningAI.',
        'Aplicar boas práticas com o softphone.',
      ],
    ),
    keyTakeaways: TL(
      [
        'READY el mayor tiempo posible; ACW lo mínimo necesario.',
        'Toda pausa debe registrarse con motivo.',
        'Nunca cierres el navegador con una llamada activa.',
      ],
      [
        'READY as much as possible; ACW the minimum needed.',
        'Every pause must be logged with a reason.',
        'Never close the browser while a call is active.',
      ],
      [
        'READY o máximo possível; ACW o mínimo necessário.',
        'Toda pausa deve ser registrada com motivo.',
        'Nunca feche o navegador com uma chamada ativa.',
      ],
    ),
    sections: [
      {
        heading: T('Estados del agente', 'Agent states', 'Estados do agente'),
        body: {
          es: [
            'READY: disponible para recibir llamadas. Tu objetivo es pasar la mayor parte del turno aquí.',
            'NOT READY: pausado con un motivo (descanso, capacitación, reunión). Siempre con razón registrada.',
            'ACW (After Call Work): tipificas y cierras notas. Limítalo a lo necesario; impacta directo el nivel de servicio.',
          ],
          en: [
            'READY: available to receive calls. Your goal is to spend most of the shift here.',
            'NOT READY: paused with a reason (break, training, meeting). Always with the reason logged.',
            'ACW (After Call Work): you disposition and close notes. Keep it tight; it hits service level directly.',
          ],
          pt: [
            'READY: disponível para receber chamadas. O objetivo é passar a maior parte do turno aqui.',
            'NOT READY: pausado com um motivo (pausa, treinamento, reunião). Sempre com razão registrada.',
            'ACW (After Call Work): você tipifica e fecha notas. Mantenha curto; impacta direto o nível de serviço.',
          ],
        },
        quiz: {
          question: T(
            '¿Qué estado debería ocupar la mayor parte de tu turno?',
            'Which state should take up most of your shift?',
            'Qual estado deveria ocupar a maior parte do seu turno?',
          ),
          options: {
            es: ['NOT READY', 'READY', 'ACW'],
            en: ['NOT READY', 'READY', 'ACW'],
            pt: ['NOT READY', 'READY', 'ACW'],
          },
          correct: 1,
          explanation: T(
            'READY es el estado productivo: estar disponible para tomar llamadas.',
            'READY is the productive state: available to take calls.',
            'READY é o estado produtivo: disponível para atender chamadas.',
          ),
        },
      },
      {
        heading: T('La interfaz', 'The interface', 'A interface'),
        body: {
          es: [
            'Soft-phone con controles de atención, espera, transferencia y finalización.',
            'Panel de información del contacto: número, datos disponibles desde el CRM, historial reciente.',
            'Barra superior con tu estado actual y cronómetro de llamada.',
          ],
          en: [
            'Softphone with answer, hold, transfer and end controls.',
            'Contact info panel: number, CRM data, recent history.',
            'Top bar with your current state and call timer.',
          ],
          pt: [
            'Softphone com controles de atender, espera, transferência e encerrar.',
            'Painel do contato: número, dados do CRM, histórico recente.',
            'Barra superior com o estado atual e cronômetro da chamada.',
          ],
        },
        callout: {
          kind: 'important',
          text: T(
            'Nunca cierres el navegador con una llamada activa. Usa End Call siempre.',
            'Never close the browser while a call is active. Always use End Call.',
            'Nunca feche o navegador com uma chamada ativa. Sempre use End Call.',
          ),
        },
        quiz: {
          question: T(
            'Tienes una llamada activa y necesitas reiniciar el navegador. ¿Qué haces?',
            'You have an active call and need to restart the browser. What do you do?',
            'Você tem uma chamada ativa e precisa reiniciar o navegador. O que faz?',
          ),
          options: {
            es: [
              'Cierro el navegador para reiniciar rápido.',
              'Termino la llamada con End Call y luego reinicio.',
              'Pongo en espera y cierro el navegador.',
            ],
            en: [
              'Close the browser to restart quickly.',
              'End the call with End Call, then restart.',
              'Put it on hold and close the browser.',
            ],
            pt: [
              'Fecho o navegador para reiniciar rápido.',
              'Encerro a chamada com End Call e depois reinicio.',
              'Coloco em espera e fecho o navegador.',
            ],
          },
          correct: 1,
          explanation: T(
            'Cerrar el navegador con una llamada activa rompe la sesión y deja al cliente colgado.',
            'Closing the browser with an active call breaks the session and leaves the customer hanging.',
            'Fechar o navegador com uma chamada ativa quebra a sessão e deixa o cliente na linha.',
          ),
        },
      },
    ],
  },
  {
    id: 'atencion-cliente',
    icon: 'HeartHandshake',
    duration: 12,
    title: T('Atención al cliente', 'Customer care', 'Atendimento ao cliente'),
    subtitle: T(
      'Empatía, escucha activa y comunicación clara bajo presión.',
      'Empathy, active listening and clear communication under pressure.',
      'Empatia, escuta ativa e comunicação clara sob pressão.',
    ),
    objectives: TL(
      [
        'Practicar escucha activa sin interrumpir.',
        'Nombrar emociones para desarmar tensión.',
        'Comunicar pasos antes de ejecutarlos.',
      ],
      [
        'Practice active listening without interrupting.',
        'Name emotions to disarm tension.',
        'Announce steps before taking them.',
      ],
      [
        'Praticar escuta ativa sem interromper.',
        'Nomear emoções para desarmar tensão.',
        'Anunciar passos antes de executá-los.',
      ],
    ),
    keyTakeaways: TL(
      [
        'Parafrasear confirma que entendiste antes de actuar.',
        'Frases cortas y sin tecnicismos suben la claridad.',
        'El silencio en línea genera ansiedad — anúncialo.',
      ],
      [
        'Paraphrasing confirms you understood before acting.',
        'Short sentences without jargon raise clarity.',
        'Dead air creates anxiety — announce your pauses.',
      ],
      [
        'Parafrasear confirma que você entendeu antes de agir.',
        'Frases curtas sem jargão elevam a clareza.',
        'Silêncio na linha gera ansiedade — anuncie suas pausas.',
      ],
    ),
    sections: [
      {
        heading: T('Escucha activa', 'Active listening', 'Escuta ativa'),
        body: {
          es: [
            'No interrumpas mientras el cliente describe su caso. Parafrasea al final para confirmar.',
            'Nombra la emoción: "entiendo que esto te genera frustración" desarma la tensión.',
            'Confirma antes de actuar: "entonces lo que necesitas es X, ¿correcto?".',
          ],
          en: [
            'Don\'t interrupt while the customer describes the case. Paraphrase at the end to confirm.',
            'Name the emotion: "I understand this is frustrating" disarms tension.',
            'Confirm before acting: "so what you need is X, correct?".',
          ],
          pt: [
            'Não interrompa enquanto o cliente descreve o caso. Parafraseie ao final para confirmar.',
            'Nomeie a emoção: "entendo que isso causa frustração" desarma a tensão.',
            'Confirme antes de agir: "então o que você precisa é X, correto?".',
          ],
        },
        quiz: {
          question: T(
            'El cliente termina de describir un problema. ¿Cuál es tu primer paso?',
            'The customer finished describing a problem. What is your first step?',
            'O cliente terminou de descrever um problema. Qual é o seu primeiro passo?',
          ),
          options: {
            es: [
              'Proponer la solución de inmediato.',
              'Parafrasear para confirmar que entendiste.',
              'Pedirle datos de identificación.',
            ],
            en: [
              'Propose a solution right away.',
              'Paraphrase to confirm you understood.',
              'Ask for identification details.',
            ],
            pt: [
              'Propor a solução imediatamente.',
              'Parafrasear para confirmar que você entendeu.',
              'Pedir dados de identificação.',
            ],
          },
          correct: 1,
          explanation: T(
            'Parafrasear evita resolver el problema equivocado y muestra que escuchaste.',
            'Paraphrasing avoids solving the wrong problem and shows you listened.',
            'Parafrasear evita resolver o problema errado e mostra que você escutou.',
          ),
        },
      },
      {
        heading: T('Comunicación clara', 'Clear communication', 'Comunicação clara'),
        body: {
          es: [
            'Frases cortas, pausas naturales, evita tecnicismos.',
            'Anuncia cada paso que vas a tomar antes de hacerlo.',
            'Cuando necesites tiempo di: "déjame revisar esto un momento", no dejes silencio en línea.',
          ],
          en: [
            'Short sentences, natural pauses, avoid jargon.',
            'Announce each step before you take it.',
            'When you need time say "let me check this for a moment"; avoid dead air.',
          ],
          pt: [
            'Frases curtas, pausas naturais, evite jargões.',
            'Anuncie cada passo antes de dá-lo.',
            'Quando precisar de tempo diga: "deixa eu verificar isso um instante"; evite silêncio na linha.',
          ],
        },
        quiz: {
          question: T(
            'Necesitas 30 segundos para revisar un caso. ¿Qué dices?',
            'You need 30 seconds to look up a case. What do you say?',
            'Você precisa de 30 segundos para verificar um caso. O que diz?',
          ),
          options: {
            es: [
              'Me callo y reviso rápido.',
              '"Déjame revisar esto un momento, sigo contigo."',
              '"Espera un segundo" sin más explicación.',
            ],
            en: [
              'Stay silent and look it up quickly.',
              '"Let me check this for a moment, I\'m still with you."',
              '"Hold on a second" with no further detail.',
            ],
            pt: [
              'Fico em silêncio e verifico rápido.',
              '"Deixe-me verificar isso um instante, sigo com você."',
              '"Espera um segundo", sem mais explicação.',
            ],
          },
          correct: 1,
          explanation: T(
            'Anunciar la pausa evita el silencio incómodo y mantiene la sensación de atención.',
            'Announcing the pause avoids dead air and keeps the sense of attention.',
            'Anunciar a pausa evita silêncio incômodo e mantém a sensação de atenção.',
          ),
        },
      },
    ],
  },
  {
    id: 'protocolos-regionales',
    icon: 'Globe',
    duration: 10,
    title: T('Protocolos regionales', 'Regional protocols', 'Protocolos regionais'),
    subtitle: T(
      'Diferencias culturales y de registro entre Colombia, México y Argentina.',
      'Cultural and register differences between Colombia, Mexico and Argentina.',
      'Diferenças culturais e de registro entre Colômbia, México e Argentina.',
    ),
    objectives: TL(
      [
        'Adaptar el registro de tratamiento a cada país.',
        'Conocer los husos horarios operativos.',
        'Reconocer expresiones locales esperadas.',
      ],
      [
        'Adapt the treatment register to each country.',
        'Know the operational time zones.',
        'Recognize expected local expressions.',
      ],
      [
        'Adaptar o registro de tratamento a cada país.',
        'Conhecer os fusos horários operacionais.',
        'Reconhecer expressões locais esperadas.',
      ],
    ),
    keyTakeaways: TL(
      [
        'Colombia: tono formal, cálido, "señor/señora" por defecto.',
        'México: formal salvo invitación; cuidado con diminutivos.',
        'Argentina: voseo natural y honestidad directa.',
      ],
      [
        'Colombia: formal warm tone, default "señor/señora".',
        'Mexico: formal unless invited; careful with diminutives.',
        'Argentina: natural voseo and direct honesty.',
      ],
      [
        'Colômbia: tom formal, caloroso, padrão "señor/señora".',
        'México: formal salvo convite; cuidado com diminutivos.',
        'Argentina: voseo natural e honestidade direta.',
      ],
    ),
    sections: [
      {
        heading: T('Colombia', 'Colombia', 'Colômbia'),
        body: {
          es: [
            'Tratamiento formal: "señor/señora" por defecto. Tono cálido y servicial.',
            'Franja horaria: UTC-5. Respeta horas de descanso en la costa Atlántica.',
            'Expresiones comunes: "con mucho gusto", "a la orden".',
          ],
          en: [
            'Formal register: default "señor/señora". Warm, service-oriented tone.',
            'Time zone: UTC-5. Respect rest hours on the Atlantic coast.',
            'Common phrases: "con mucho gusto", "a la orden".',
          ],
          pt: [
            'Registro formal: padrão "señor/señora". Tom caloroso e servicial.',
            'Fuso horário: UTC-5. Respeite os horários de descanso na costa Atlântica.',
            'Expressões comuns: "con mucho gusto", "a la orden".',
          ],
        },
        quiz: {
          question: T(
            'En Colombia, ¿cuál es el tratamiento por defecto?',
            'In Colombia, what is the default form of address?',
            'Na Colômbia, qual é o tratamento padrão?',
          ),
          options: {
            es: ['Tutearlo siempre', '"señor/señora" formal y cálido', 'Sin tratamiento explícito'],
            en: ['Always informal', 'Formal warm "señor/señora"', 'No explicit form'],
            pt: ['Sempre informal', 'Formal e caloroso "señor/señora"', 'Sem forma explícita'],
          },
          correct: 1,
          explanation: T(
            'En CO el cliente espera trato formal y cálido por defecto.',
            'In CO the customer expects a default formal and warm treatment.',
            'Na CO o cliente espera tratamento formal e caloroso por padrão.',
          ),
        },
      },
      {
        heading: T('México', 'Mexico', 'México'),
        body: {
          es: [
            'Tratamiento formal salvo que el cliente pida tutearlo.',
            'Franja horaria: UTC-6 (CDMX). Varía por región.',
            'Evita diminutivos excesivos; mantén profesional.',
          ],
          en: [
            'Formal register unless the customer asks to be addressed as "tú".',
            'Time zone: UTC-6 (CDMX). Varies by region.',
            'Avoid excessive diminutives; keep it professional.',
          ],
          pt: [
            'Registro formal, a menos que o cliente peça para ser tratado por "tú".',
            'Fuso horário: UTC-6 (CDMX). Varia por região.',
            'Evite diminutivos em excesso; mantenha o tom profissional.',
          ],
        },
        quiz: {
          question: T(
            'En México, ¿qué evitas en el registro?',
            'In Mexico, what do you avoid in your register?',
            'No México, o que você evita no registro?',
          ),
          options: {
            es: ['El tratamiento formal', 'Diminutivos excesivos', 'Las expresiones de cortesía'],
            en: ['Formal address', 'Excessive diminutives', 'Courtesy expressions'],
            pt: ['Tratamento formal', 'Diminutivos em excesso', 'Expressões de cortesia'],
          },
          correct: 1,
          explanation: T(
            'Los diminutivos en exceso suenan poco profesionales en MX.',
            'Excessive diminutives sound unprofessional in MX.',
            'Diminutivos em excesso soam pouco profissionais no MX.',
          ),
        },
      },
      {
        heading: T('Argentina', 'Argentina', 'Argentina'),
        body: {
          es: [
            'Voseo estándar: "vos tenés", "decime". No forzar tuteo.',
            'Franja horaria: UTC-3. Horario corrido.',
            'Clientes valoran la honestidad directa: no prometas lo que no puedas cumplir.',
          ],
          en: [
            'Voseo is standard: "vos tenés", "decime". Don\'t force "tú".',
            'Time zone: UTC-3. Single workday schedule.',
            'Customers value direct honesty: don\'t promise what you can\'t deliver.',
          ],
          pt: [
            'Voseo é padrão: "vos tenés", "decime". Não force o tuteo.',
            'Fuso horário: UTC-3. Jornada contínua.',
            'Clientes valorizam honestidade direta: não prometa o que não pode cumprir.',
          ],
        },
        quiz: {
          question: T(
            'En Argentina, ¿qué tratamiento es estándar?',
            'In Argentina, what address form is standard?',
            'Na Argentina, qual tratamento é padrão?',
          ),
          options: {
            es: ['Tuteo ("tú tienes")', 'Voseo ("vos tenés")', 'Solo formal con usted'],
            en: ['Tuteo ("tú tienes")', 'Voseo ("vos tenés")', 'Only formal usted'],
            pt: ['Tuteo ("tú tienes")', 'Voseo ("vos tenés")', 'Só formal usted'],
          },
          correct: 1,
          explanation: T(
            'En AR el voseo es la norma; forzar tuteo suena artificial.',
            'In AR voseo is the norm; forcing tuteo sounds artificial.',
            'Na AR o voseo é a norma; forçar tuteo soa artificial.',
          ),
        },
      },
    ],
  },
  {
    id: 'objeciones',
    icon: 'Shield',
    duration: 11,
    title: T('Manejo de objeciones', 'Handling objections', 'Lidando com objeções'),
    subtitle: T(
      'Técnicas para contener, reformular y resolver cuando el cliente está molesto.',
      'Techniques to contain, reframe and resolve when the customer is upset.',
      'Técnicas para conter, reformular e resolver quando o cliente está chateado.',
    ),
    objectives: TL(
      [
        'Aplicar el método LAER paso a paso.',
        'Validar emociones sin admitir culpa innecesaria.',
        'Ofrecer soluciones concretas con plazo.',
      ],
      [
        'Apply the LAER method step by step.',
        'Validate emotions without admitting unnecessary fault.',
        'Offer concrete solutions with a timeframe.',
      ],
      [
        'Aplicar o método LAER passo a passo.',
        'Validar emoções sem admitir culpa desnecessária.',
        'Oferecer soluções concretas com prazo.',
      ],
    ),
    keyTakeaways: TL(
      [
        'No discutas. Tu rol no es ganar, es resolver.',
        'L-A-E-R: escuchar, reconocer, explorar, responder.',
        'Una solución sin plazo es una promesa vacía.',
      ],
      [
        'Don\'t argue. Your role is not to win, it\'s to resolve.',
        'L-A-E-R: listen, acknowledge, explore, respond.',
        'A solution without a timeframe is an empty promise.',
      ],
      [
        'Não discuta. Seu papel não é ganhar, é resolver.',
        'L-A-E-R: ouvir, reconhecer, explorar, responder.',
        'Uma solução sem prazo é uma promessa vazia.',
      ],
    ),
    sections: [
      {
        heading: T('El método LAER', 'The LAER method', 'O método LAER'),
        body: {
          es: [
            'Listen — deja que el cliente descargue sin interrumpir.',
            'Acknowledge — valida su emoción sin admitir culpa innecesaria.',
            'Explore — haz preguntas específicas para aislar el problema.',
            'Respond — ofrece una solución concreta con plazo.',
          ],
          en: [
            'Listen — let the customer vent without interrupting.',
            'Acknowledge — validate their emotion without admitting unnecessary fault.',
            'Explore — ask targeted questions to isolate the problem.',
            'Respond — offer a concrete solution with a timeframe.',
          ],
          pt: [
            'Listen — deixe o cliente desabafar sem interromper.',
            'Acknowledge — valide a emoção sem admitir culpa desnecessária.',
            'Explore — faça perguntas específicas para isolar o problema.',
            'Respond — ofereça uma solução concreta com prazo.',
          ],
        },
        callout: {
          kind: 'tip',
          text: T(
            'Nunca discutas. Tu rol no es ganar, es resolver.',
            'Never argue. Your role is not to win, it\'s to resolve.',
            'Nunca discuta. Seu papel não é ganhar, é resolver.',
          ),
        },
        quiz: {
          question: T(
            'En el método LAER, ¿qué viene después de escuchar?',
            'In the LAER method, what comes after listening?',
            'No método LAER, o que vem depois de ouvir?',
          ),
          options: {
            es: ['Responder con la solución', 'Reconocer la emoción del cliente', 'Pedir su número de cuenta'],
            en: ['Respond with the solution', 'Acknowledge the customer\'s emotion', 'Ask for their account number'],
            pt: ['Responder com a solução', 'Reconhecer a emoção do cliente', 'Pedir o número da conta'],
          },
          correct: 1,
          explanation: T(
            'L → A: reconocer la emoción antes de explorar el problema desarma tensión.',
            'L → A: acknowledging the emotion before exploring the issue disarms tension.',
            'L → A: reconhecer a emoção antes de explorar o problema desarma tensão.',
          ),
        },
      },
    ],
  },
  {
    id: 'cierre-documentacion',
    icon: 'FileCheck',
    duration: 9,
    title: T('Cierre y documentación', 'Closing and documentation', 'Encerramento e documentação'),
    subtitle: T(
      'El final de la llamada es donde se construye la recompra.',
      'The end of the call is where repeat business is built.',
      'O fim da chamada é onde se constrói a recompra.',
    ),
    objectives: TL(
      [
        'Cerrar con un resumen claro de la solución.',
        'Despedir con marca y nombre del agente.',
        'Documentar con precisión y brevedad.',
      ],
      [
        'Close with a clear summary of the solution.',
        'Sign off with brand and agent name.',
        'Document with precision and brevity.',
      ],
      [
        'Encerrar com um resumo claro da solução.',
        'Despedir com marca e nome do agente.',
        'Documentar com precisão e brevidade.',
      ],
    ),
    keyTakeaways: TL(
      [
        'Resume la solución en una frase antes de despedir.',
        'La firma con marca refuerza identidad y confianza.',
        'Notas precisas evitan reaperturas innecesarias.',
      ],
      [
        'Summarize the solution in one sentence before signing off.',
        'A branded sign-off reinforces identity and trust.',
        'Precise notes prevent unnecessary reopenings.',
      ],
      [
        'Resuma a solução em uma frase antes de despedir.',
        'A despedida com marca reforça identidade e confiança.',
        'Notas precisas evitam reaberturas desnecessárias.',
      ],
    ),
    sections: [
      {
        heading: T('Cierre impecable', 'Impeccable closing', 'Encerramento impecável'),
        body: {
          es: [
            'Resume la solución aplicada en una frase.',
            'Pregunta: "¿hay algo más en lo que pueda ayudarte hoy?" antes de despedir.',
            'Despide con marca y nombre: "soy {{agente}} de LearningAI, que tengas un excelente día".',
          ],
          en: [
            'Summarize the applied solution in one sentence.',
            'Ask: "is there anything else I can help you with today?" before closing.',
            'Sign off with brand and name: "I\'m {{agent}} from LearningAI, have a great day".',
          ],
          pt: [
            'Resuma a solução aplicada em uma frase.',
            'Pergunte: "há algo mais em que eu possa ajudar hoje?" antes de encerrar.',
            'Despeça-se com marca e nome: "sou {{agente}} da LearningAI, tenha um ótimo dia".',
          ],
        },
        quiz: {
          question: T(
            '¿Qué pregunta haces antes de despedirte?',
            'What question do you ask before signing off?',
            'Que pergunta você faz antes de despedir-se?',
          ),
          options: {
            es: [
              '"¿Está conforme con la solución?"',
              '"¿Hay algo más en lo que pueda ayudarte hoy?"',
              'Ninguna, pasas directo al cierre.',
            ],
            en: [
              '"Are you satisfied with the solution?"',
              '"Is there anything else I can help you with today?"',
              'None, go straight to the close.',
            ],
            pt: [
              '"Está satisfeito com a solução?"',
              '"Há algo mais em que eu possa ajudar hoje?"',
              'Nenhuma, vai direto ao encerramento.',
            ],
          },
          correct: 1,
          explanation: T(
            'Esa pregunta abre la puerta a resolver más necesidades en el mismo contacto.',
            'That question opens the door to resolving more needs in the same contact.',
            'Essa pergunta abre a porta para resolver mais necessidades no mesmo contato.',
          ),
        },
      },
      {
        heading: T('Documentación en LearningAI', 'Documentation in LearningAI', 'Documentação no LearningAI'),
        body: {
          es: [
            'Selecciona la disposición correcta. Si dudas, pregunta al supervisor en el canal.',
            'Notas: qué pidió el cliente, qué hiciste, qué quedó pendiente.',
            'Evita texto libre innecesario. Sé preciso y breve.',
          ],
          en: [
            'Select the correct disposition. If in doubt, ask the supervisor in the channel.',
            'Notes: what the customer asked, what you did, what is still pending.',
            'Avoid unnecessary free text. Be precise and brief.',
          ],
          pt: [
            'Selecione a disposição correta. Em dúvida, pergunte ao supervisor no canal.',
            'Notas: o que o cliente pediu, o que você fez, o que ficou pendente.',
            'Evite texto livre desnecessário. Seja preciso e breve.',
          ],
        },
        quiz: {
          question: T(
            '¿Qué debe contener una buena nota de cierre?',
            'What should a good closing note contain?',
            'O que uma boa nota de encerramento deve conter?',
          ),
          options: {
            es: [
              'Toda la conversación literal.',
              'Qué pidió, qué hiciste y qué quedó pendiente.',
              'Solo la disposición.',
            ],
            en: [
              'The entire literal conversation.',
              'What was asked, what you did, what is pending.',
              'Just the disposition.',
            ],
            pt: [
              'Toda a conversa literal.',
              'O que foi pedido, o que você fez e o que está pendente.',
              'Apenas a disposição.',
            ],
          },
          correct: 1,
          explanation: T(
            'Tres campos: pedido, acción y pendiente. Suficiente para que cualquiera retome el caso.',
            'Three fields: request, action, pending. Enough for anyone to pick up the case.',
            'Três campos: pedido, ação e pendência. Suficiente para qualquer um retomar o caso.',
          ),
        },
      },
    ],
  },
];
