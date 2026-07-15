import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/scoring';

interface CallTimerProps {
  startedAt: number;
  endedAt?: number;
  /** When set (and the call has not ended), the display freezes at this instant. */
  pausedAt?: number | null;
  /** Total ms the call has spent on hold; subtracted from the elapsed time. */
  holdOffsetMs?: number;
  className?: string;
}

export function CallTimer({ startedAt, endedAt, pausedAt, holdOffsetMs = 0, className }: CallTimerProps) {
  const [now, setNow] = useState(() => endedAt ?? Date.now());

  useEffect(() => {
    if (endedAt) {
      setNow(endedAt);
      return;
    }
    if (pausedAt) {
      setNow(pausedAt);
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [endedAt, pausedAt]);

  const ref = endedAt ?? pausedAt ?? now;
  const sec = Math.max(0, Math.round((ref - startedAt - holdOffsetMs) / 1000));
  return <span className={className}>{formatDuration(sec)}</span>;
}
