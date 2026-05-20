import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, SendHorizontal } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { cn } from '@/lib/cn';

interface AgentInputProps {
  disabled?: boolean;
  onSend: (text: string) => void;
}

export function AgentInput({ disabled, onSend }: AgentInputProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');

  const language = useUserStore((s) => s.language);
  const country = useUserStore((s) => s.country);

  const { isSupported, isRecording, interimTranscript, micError, toggleRecording } = useSpeechRecognition({
    language,
    country,
    onFinalTranscript: (text) => {
      setValue((prev) => prev + (prev.trim() ? ' ' : '') + text);
    },
  });

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  // Stop recording when the input gets disabled (e.g. call ended)
  const stopRecordingRef = useRef(toggleRecording);
  useEffect(() => {
    stopRecordingRef.current = toggleRecording;
  });
  useEffect(() => {
    if (disabled && isRecording) stopRecordingRef.current();
  }, [disabled, isRecording]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const displayValue =
    isRecording && interimTranscript
      ? value + (value.trim() ? ' ' : '') + interimTranscript
      : value;

  return (
    <div
      className={cn(
        'surface-card p-3 flex items-end gap-2 transition-opacity',
        disabled && 'opacity-50',
      )}
    >
      {isSupported && (
        <div className="flex flex-col items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={toggleRecording}
            disabled={disabled}
            aria-label={isRecording ? t('simulator.mic_stop') : t('simulator.mic_start')}
            className={cn(
              'relative h-11 w-11 inline-flex items-center justify-center rounded-2xl transition-colors',
              isRecording
                ? 'bg-brand-green/10 text-brand-green hover:bg-brand-green/15'
                : micError
                  ? 'bg-danger/10 text-danger hover:bg-danger/15'
                  : 'bg-subtle text-text-muted hover:text-text',
            )}
          >
            <Mic className="h-4 w-4" />
            {isRecording && (
              <span
                aria-hidden
                className="absolute top-2 right-2 h-2 w-2 rounded-full bg-brand-green"
                style={{ animation: 'mic-pulse 1s ease-in-out infinite' }}
              />
            )}
          </button>
          {micError && !isRecording && (
            <p className="text-[10px] text-danger text-center w-14 leading-tight">
              {micError === 'not-allowed'
                ? t('simulator.mic_permission_denied')
                : t('simulator.mic_error')}
            </p>
          )}
        </div>
      )}

      <textarea
        ref={ref}
        rows={2}
        value={displayValue}
        onChange={(e) => {
          // Only update committed value, not the interim overlay
          if (!isRecording) setValue(e.target.value);
        }}
        onKeyDown={onKeyDown}
        placeholder={t('simulator.input_placeholder')}
        disabled={disabled}
        aria-live={isRecording ? 'polite' : undefined}
        className="flex-1 bg-transparent resize-none outline-none px-3 py-2 text-[15px] leading-relaxed placeholder:text-text-subtle/70"
      />

      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        aria-label={t('simulator.send')}
        className={cn(
          'shrink-0 h-11 w-11 inline-flex items-center justify-center rounded-2xl transition-colors',
          value.trim() && !disabled
            ? 'bg-brand-green text-white dark:text-black hover:brightness-110'
            : 'bg-subtle text-text-subtle',
        )}
      >
        <SendHorizontal className="h-4 w-4" />
      </button>
    </div>
  );
}
