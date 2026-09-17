import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Lightbulb, Mic, Rabbit, Snail, Square, Volume2 } from 'lucide-react';
import type { PronunciationBlock, PronunciationPhrase } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import {
  SPEECH_RATES, listenOnce, recognitionSupported, scorePronunciation, speak, speechSupported, stopSpeaking,
  voiceInfoFor, type ListenError, type PronunciationResult, type SpeechRate, type VoiceInfo,
} from '@/lib/speech';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';

interface Props {
  block: PronunciationBlock;
  language: Language;
}

// La velocidad elegida se recuerda en este equipo: quien necesita ir lento lo
// necesita en todas las prácticas, no solo en la primera.
const RATE_KEY = 'pronunciation-rate';
const RATE_NAMES: Record<SpeechRate, string> = { 0.6: 'very_slow', 0.8: 'slow', 1: 'normal', 1.2: 'fast' };
const EASE = [0.16, 1, 0.3, 1] as const;

function readRate(): SpeechRate {
  try {
    const v = Number(localStorage.getItem(RATE_KEY));
    return (SPEECH_RATES as readonly number[]).includes(v) ? (v as SpeechRate) : 1;
  } catch {
    return 1;
  }
}

function saveRate(rate: SpeechRate) {
  try { localStorage.setItem(RATE_KEY, String(rate)); } catch { /* sin almacenamiento: solo dura esta visita */ }
}

function pick(v: { es: string; en: string; pt: string } | undefined, lang: Language): string {
  if (!v) return '';
  return v[lang]?.trim() || v.es?.trim() || v.en?.trim() || v.pt?.trim() || '';
}

type Tone = 'great' | 'good' | 'retry';
function toneOf(score: number): Tone {
  return score >= 85 ? 'great' : score >= 60 ? 'good' : 'retry';
}
const TONE_CHIP: Record<Tone, string> = {
  great: 'bg-neon-green/15 text-neon-green border-neon-green/25',
  good: 'bg-amber-400/15 text-amber-500 border-amber-400/25',
  retry: 'bg-danger/10 text-danger border-danger/20',
};
const TONE_DOT: Record<Tone, string> = { great: 'bg-neon-green', good: 'bg-amber-400', retry: 'bg-danger' };

// ─── Piezas ─────────────────────────────────────────────────────

/** Selector segmentado de velocidad: tortuga · 0.6× 0.8× 1× 1.2× · conejo. */
function SpeedControl({ value, onChange }: { value: SpeechRate; onChange: (r: SpeechRate) => void }) {
  const { t } = useTranslation();
  const pillId = useId();
  const reduce = useReducedMotion();

  return (
    <div
      role="radiogroup"
      aria-label={t('module.blocks.pronunciation.speed')}
      className="inline-flex items-center gap-0.5 rounded-full border border-line bg-subtle/60 p-0.5"
    >
      <Snail className="ml-1.5 mr-0.5 h-3 w-3 shrink-0 text-text-subtle" aria-hidden />
      {SPEECH_RATES.map((rate) => {
        const active = rate === value;
        const name = t(`module.blocks.pronunciation.speed_${RATE_NAMES[rate]}`);
        return (
          <Tooltip key={rate} label={name} anchor="element">
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={name}
              onClick={() => onChange(rate)}
              className={cn(
                'relative min-w-[2.4rem] rounded-full px-1.5 py-1 text-[11px] font-semibold tabular-nums transition-colors',
                active ? 'text-neon-green' : 'text-text-muted hover:text-text',
              )}
            >
              {active && (
                <motion.span
                  layoutId={`speed-pill-${pillId}`}
                  className="absolute inset-0 rounded-full border border-neon-green/30 bg-neon-green/10"
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative">{rate}×</span>
            </button>
          </Tooltip>
        );
      })}
      <Rabbit className="ml-0.5 mr-1.5 h-3 w-3 shrink-0 text-text-subtle" aria-hidden />
    </div>
  );
}

/** Tres barritas que laten mientras suena la voz. */
function Equalizer() {
  const reduce = useReducedMotion();
  if (reduce) return <Square className="h-3.5 w-3.5 fill-current" />;
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0, 0.18, 0.36].map((delay) => (
        <motion.span
          key={delay}
          className="w-[3px] origin-bottom rounded-full bg-current"
          style={{ height: '100%' }}
          animate={{ scaleY: [0.35, 1, 0.5, 0.85, 0.35] }}
          transition={{ duration: 0.9, repeat: Infinity, delay, ease: 'easeInOut' }}
        />
      ))}
    </span>
  );
}

interface CardProps {
  phrase: PronunciationPhrase;
  number: number;
  lang: string;
  language: Language;
  canListen: boolean;
  speaking: boolean;
  onPlay: () => void;
  result: PronunciationResult | undefined;
  onResult: (r: PronunciationResult | undefined) => void;
  /** Tarjeta grande de «una a la vez»: letra mayor y consejo abierto. */
  hero?: boolean;
}

function PhraseCard({ phrase, number, lang, language, canListen, speaking, onPlay, result, onResult, hero }: CardProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<ListenError | null>(null);
  const [tipOpen, setTipOpen] = useState(!!hero);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const translation = pick(phrase.translation, language);
  const tip = pick(phrase.tip, language);
  const ipa = phrase.ipa?.replace(/^\/|\/$/g, '');

  const record = () => {
    if (recording) { stopRef.current?.(); return; }
    stopSpeaking();
    setError(null);
    onResult(undefined);
    setRecording(true);
    const handle = listenOnce(lang, {
      onResult: (alts) => onResult(scorePronunciation(phrase.text, alts)),
      onError: (e) => setError(e),
      onEnd: () => { setRecording(false); stopRef.current = null; },
    });
    stopRef.current = handle.stop;
  };

  const tone = result ? toneOf(result.score) : null;
  const reveal = reduce
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: 'auto' },
        exit: { opacity: 0, height: 0 },
        transition: { duration: 0.28, ease: EASE },
      };

  return (
    <div
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-surface transition-all duration-300 ease-apple',
        hero ? 'p-5 sm:p-6' : 'p-4',
        speaking
          ? 'border-neon-green/40 shadow-[0_0_0_4px_rgb(var(--neon-green)/0.06)]'
          : recording
            ? 'border-neon-magenta/40 shadow-[0_0_0_4px_rgb(var(--neon-magenta)/0.06)]'
            : 'border-line hover:-translate-y-0.5 hover:border-text-subtle/30 hover:shadow-card-hover',
      )}
    >
      {/* Frase + escuchar */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <span className="mb-1 inline-block font-mono text-[10.5px] font-semibold tracking-wider text-text-subtle">
            {String(number).padStart(2, '0')}
          </span>
          <p
            className={cn('font-semibold leading-snug tracking-tight text-text break-words', hero ? 'text-[22px] sm:text-[26px]' : 'text-[16px]')}
            lang={lang}
          >
            {phrase.text}
          </p>
          {(ipa || translation) && (
            <p className={cn('mt-1 leading-relaxed', hero ? 'text-[14px]' : 'text-[12.5px]')}>
              {ipa && <span className="font-mono text-text-subtle">/{ipa}/</span>}
              {ipa && translation && <span className="mx-1.5 text-text-subtle/60">·</span>}
              {translation && <span className="text-text-muted">{translation}</span>}
            </p>
          )}
        </div>
        <Tooltip label={speaking ? t('module.blocks.pronunciation.stop') : t('module.blocks.pronunciation.listen')} anchor="element">
          <button
            type="button"
            onClick={onPlay}
            aria-pressed={speaking}
            aria-label={speaking ? t('module.blocks.pronunciation.stop') : t('module.blocks.pronunciation.listen')}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full transition-all duration-200 active:scale-95',
              hero ? 'h-12 w-12' : 'h-10 w-10',
              speaking
                ? 'bg-neon-green text-black shadow-[0_6px_20px_-6px_rgb(var(--neon-green)/0.7)]'
                : 'bg-neon-green/10 text-neon-green hover:bg-neon-green/20',
            )}
          >
            {speaking ? <Equalizer /> : <Volume2 className={hero ? 'h-5 w-5' : 'h-4 w-4'} />}
          </button>
        </Tooltip>
      </div>

      {/* Acciones */}
      <div className="mt-3 flex flex-wrap items-center gap-2 pt-3 border-t border-line/70">
        {canListen && (
          <button
            type="button"
            onClick={record}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-all active:scale-[0.97]',
              recording
                ? 'bg-danger text-white'
                : 'bg-neon-magenta/15 text-neon-magenta hover:bg-neon-magenta hover:text-white',
            )}
          >
            {recording ? (
              <>
                <span className="relative flex h-2 w-2">
                  {!reduce && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />}
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
                {t('module.blocks.pronunciation.stop')}
              </>
            ) : (
              <>
                <Mic className="h-3.5 w-3.5" />
                {t('module.blocks.pronunciation.say_it')}
              </>
            )}
          </button>
        )}
        {tip && (
          <button
            type="button"
            onClick={() => setTipOpen((v) => !v)}
            aria-expanded={tipOpen}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors',
              tipOpen ? 'bg-amber-400/15 text-amber-500' : 'text-text-muted hover:bg-subtle hover:text-text',
            )}
          >
            <Lightbulb className="h-3.5 w-3.5" />
            {t('module.blocks.pronunciation.tip')}
          </button>
        )}
        {result && tone && !recording && (
          <motion.span
            initial={reduce ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn('ml-auto inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-bold tabular-nums', TONE_CHIP[tone])}
          >
            {result.score}%
          </motion.span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {recording && (
          <motion.p key="listening" {...reveal} className="overflow-hidden text-[12px] text-text-subtle">
            <span className="block pt-2">{t('module.blocks.pronunciation.listening')}</span>
          </motion.p>
        )}
        {error && !recording && (
          <motion.p key="error" {...reveal} className="overflow-hidden text-[12px] text-amber-500">
            <span className="block pt-2">{t(`module.blocks.pronunciation.error_${error.replace('-', '_')}`)}</span>
          </motion.p>
        )}
        {result && tone && !recording && (
          <motion.div key="result" {...reveal} className="overflow-hidden">
            <div className="pt-2.5 space-y-1">
              <p className="text-[12px] font-medium text-text">{t(`module.blocks.pronunciation.score_${tone}`)}</p>
              <p className="text-[13.5px] leading-relaxed" lang={lang}>
                {result.words.map((w, i) => (
                  <span key={i} className={cn(w.ok ? 'text-text' : 'text-danger underline decoration-dotted underline-offset-4')}>
                    {w.word}{' '}
                  </span>
                ))}
              </p>
              {result.heard && (
                <p className="text-[11.5px] text-text-subtle">
                  {t('module.blocks.pronunciation.heard')} <span className="italic" lang={lang}>«{result.heard}»</span>
                </p>
              )}
            </div>
          </motion.div>
        )}
        {tip && tipOpen && (
          <motion.div key="tip" {...reveal} className="overflow-hidden">
            <p className="mt-2.5 rounded-xl bg-amber-400/10 px-3 py-2 text-[12.5px] leading-relaxed text-text-muted">
              {tip}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Bloque ─────────────────────────────────────────────────────

export function PronunciationBlockRenderer({ block, language }: Props) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [rate, setRate] = useState<SpeechRate>(readRate);
  // Los puntajes viven aquí y no en la tarjeta: en «una a la vez» la tarjeta se
  // desmonta al pasar a la siguiente y el puntaje no debe perderse.
  const [results, setResults] = useState<Record<number, PronunciationResult>>({});
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [voice, setVoice] = useState<VoiceInfo | null>(null);
  // Cada reproducción lleva un turno: Chrome dispara el `onend` de la frase
  // cortada DESPUÉS de arrancar la nueva, y sin turno apagaría el botón activo.
  const turn = useRef(0);
  const phrases = block.phrases.filter((p) => p.text.trim());
  const layout = block.layout ?? 'grid';
  const title = pick(block.title, language);
  const canSpeak = speechSupported();
  const canListen = recognitionSupported();
  const practiced = Object.keys(results).length;

  // Al salir del módulo no debe seguir hablando.
  useEffect(() => () => stopSpeaking(), []);

  // Qué voz va a sonar. Si el equipo no tiene la del país del curso, hay que
  // decirlo: una voz de Portugal leyendo portugués de Brasil enseña otra
  // pronunciación, y quien aprende no tiene cómo saberlo.
  useEffect(() => {
    let alive = true;
    void voiceInfoFor(block.lang).then((v) => { if (alive) setVoice(v); });
    return () => { alive = false };
  }, [block.lang]);

  const play = (idx: number, atRate: SpeechRate) => {
    const mine = ++turn.current;
    setSpeakingIdx(idx);
    void speak(phrases[idx].text, block.lang, {
      rate: atRate,
      onEnd: () => { if (turn.current === mine) setSpeakingIdx(null); },
    });
  };

  const silence = () => {
    turn.current++;
    stopSpeaking();
    setSpeakingIdx(null);
  };

  const toggle = (idx: number) => {
    if (speakingIdx === idx) { silence(); return; }
    play(idx, rate);
  };

  const changeRate = (next: SpeechRate) => {
    setRate(next);
    saveRate(next);
    // Si está sonando, se repite ya a la nueva velocidad: así se nota la diferencia.
    if (speakingIdx !== null) play(speakingIdx, next);
  };

  const goTo = (idx: number) => {
    const next = Math.max(0, Math.min(phrases.length - 1, idx));
    if (next === step) return;
    silence();
    setDir(next > step ? 1 : -1);
    setStep(next);
  };

  const setResult = (idx: number) => (r: PronunciationResult | undefined) =>
    setResults((prev) => {
      const next = { ...prev };
      if (r) next[idx] = r;
      else delete next[idx];
      return next;
    });

  if (!phrases.length) return null;

  const card = (i: number, hero?: boolean) => (
    <PhraseCard
      phrase={phrases[i]}
      number={i + 1}
      lang={block.lang}
      language={language}
      canListen={canListen}
      speaking={speakingIdx === i}
      onPlay={() => toggle(i)}
      result={results[i]}
      onResult={setResult(i)}
      hero={hero}
    />
  );

  const current = Math.min(step, phrases.length - 1);

  return (
    <section className="space-y-3.5">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Tooltip label={voice ? t('module.blocks.pronunciation.voice_is', { name: voice.name }) : t('module.blocks.pronunciation.default_title')} anchor="element">
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-neon-magenta/20 to-neon-magenta/5 text-neon-magenta ring-1 ring-inset ring-neon-magenta/15">
              <Mic className="h-4 w-4" />
            </span>
          </Tooltip>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold tracking-tight text-text">
                {title || t('module.blocks.pronunciation.default_title')}
              </p>
              <span className="rounded-full bg-subtle px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-text-muted">
                {practiced > 0
                  ? t('module.blocks.pronunciation.practiced', { done: practiced, total: phrases.length })
                  : t('module.blocks.pronunciation.phrase_count', { count: phrases.length })}
              </span>
            </div>
            <p className="text-[12px] text-text-subtle">{t('module.blocks.pronunciation.how_to')}</p>
          </div>
        </div>
        {canSpeak && <SpeedControl value={rate} onChange={changeRate} />}
      </div>

      {canSpeak && voice && !voice.sameRegion && (
        <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[12px] text-text-muted">
          {t('module.blocks.pronunciation.wrong_region', { want: block.lang, got: voice.lang, name: voice.name })}
        </p>
      )}

      {(!canSpeak || !canListen) && (
        <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[12px] text-text-muted">
          {t(canSpeak ? 'module.blocks.pronunciation.no_mic_support' : 'module.blocks.pronunciation.no_voice_support')}
        </p>
      )}

      {layout === 'steps' ? (
        <div className="space-y-3">
          <div className="relative overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={dir}>
              <motion.div
                key={current}
                custom={dir}
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -40 }}
                transition={{ duration: 0.32, ease: EASE }}
              >
                {card(current, true)}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => goTo(current - 1)}
              disabled={current === 0}
              aria-label={t('module.blocks.pronunciation.prev')}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-text-muted transition-colors hover:bg-subtle hover:text-text disabled:pointer-events-none disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex min-w-0 items-center gap-3">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {phrases.map((_, i) => {
                  const r = results[i];
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => goTo(i)}
                      aria-label={t('module.blocks.pronunciation.go_to', { n: i + 1 })}
                      aria-current={i === current ? 'step' : undefined}
                      className="flex h-4 items-center"
                    >
                      <span
                        className={cn(
                          'block h-1.5 rounded-full transition-all duration-300 ease-apple',
                          i === current ? 'w-5' : 'w-1.5',
                          r ? TONE_DOT[toneOf(r.score)] : i === current ? 'bg-text' : 'bg-text-subtle/35',
                        )}
                      />
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-text-subtle">
                {current + 1}/{phrases.length}
              </span>
            </div>

            <button
              type="button"
              onClick={() => goTo(current + 1)}
              disabled={current === phrases.length - 1}
              aria-label={t('module.blocks.pronunciation.next')}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-neon-green/10 text-neon-green transition-colors hover:bg-neon-green/20 disabled:pointer-events-none disabled:opacity-35"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className={cn('grid items-start gap-3', layout === 'grid' && phrases.length > 1 && 'sm:grid-cols-2')}>
          {phrases.map((_, i) => (
            <div key={i}>{card(i)}</div>
          ))}
        </div>
      )}
    </section>
  );
}
