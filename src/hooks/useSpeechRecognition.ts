import { useCallback, useEffect, useRef, useState } from 'react';
import type { Country, Language } from '@/stores/userStore';

// Web Speech API types (not in all TypeScript DOM libs)
interface SpeechRecognitionAlternative {
  readonly transcript: string;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent {
  readonly error: string;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

const localeMap: Record<Language, Record<Country, string>> = {
  es: { CO: 'es-CO', MX: 'es-MX', AR: 'es-AR' },
  en: { CO: 'en-US', MX: 'en-US', AR: 'en-US' },
  pt: { CO: 'pt-BR', MX: 'pt-BR', AR: 'pt-BR' },
};

interface UseSpeechRecognitionOptions {
  language: Language;
  country: Country;
  onFinalTranscript: (text: string) => void;
}

interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isRecording: boolean;
  interimTranscript: string;
  micError: string | null;
  startRecording: () => void;
  stopRecording: () => void;
  toggleRecording: () => void;
}

const getAPI = (): SpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export function useSpeechRecognition({
  language,
  country,
  onFinalTranscript,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionReturn {
  const API = getAPI();
  const isSupported = API !== null;

  const [isRecording, setIsRecording] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onFinalRef = useRef(onFinalTranscript);

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  });

  const locale = localeMap[language]?.[country] ?? 'es-CO';

  const createInstance = useCallback((): SpeechRecognitionInstance | null => {
    if (!API) return null;
    const rec = new API();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = locale;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const finalText = result[0].transcript.trim();
          if (finalText) onFinalRef.current(finalText);
        } else {
          interim += result[0].transcript;
        }
      }
      setInterimTranscript(interim);
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('[SpeechRecognition] error:', event.error);
      setMicError(event.error);
      if (['not-allowed', 'no-speech', 'aborted'].includes(event.error)) {
        setIsRecording(false);
        setInterimTranscript('');
      }
    };

    rec.onend = () => {
      setIsRecording(false);
      setInterimTranscript('');
    };

    return rec;
  }, [API, locale]);

  useEffect(() => {
    if (!API) return;
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
    }
    recognitionRef.current = createInstance();
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
      }
    };
  }, [API, locale, createInstance]);

  const startRecording = useCallback(() => {
    if (!API) return;
    // Recreate instance so it's always in a clean state (needed after continuous:false auto-stop)
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
    }
    recognitionRef.current = createInstance();
    if (!recognitionRef.current) return;
    try {
      setMicError(null);
      recognitionRef.current.start();
      setIsRecording(true);
    } catch { /* ignore */ }
  }, [API, createInstance]);

  const stopRecording = useCallback(() => {
    if (!recognitionRef.current) return;
    try { recognitionRef.current.stop(); } catch { /* ignore */ }
    setInterimTranscript('');
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, startRecording, stopRecording]);

  if (!isSupported) {
    return {
      isSupported: false,
      isRecording: false,
      interimTranscript: '',
      micError: null,
      startRecording: () => {},
      stopRecording: () => {},
      toggleRecording: () => {},
    };
  }

  return { isSupported, isRecording, interimTranscript, micError, startRecording, stopRecording, toggleRecording };
}
