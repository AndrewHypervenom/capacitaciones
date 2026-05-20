import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/scoring';

interface CallTimerProps {
  startedAt: number;
  endedAt?: number;
  className?: string;
}

export function CallTimer({ startedAt, endedAt, className }: CallTimerProps) {
  const [now, setNow] = useState(() => endedAt ?? Date.now());

  useEffect(() => {
    if (endedAt) {
      setNow(endedAt);
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [endedAt]);

  const sec = Math.max(0, Math.round((now - startedAt) / 1000));
  return <span className={className}>{formatDuration(sec)}</span>;
}
