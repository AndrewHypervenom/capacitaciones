import { motion } from 'framer-motion';

interface ProgressRingProps {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  showLabel?: boolean;
  color?: string;
}

export function ProgressRing({ value, size = 40, stroke = 3, label, showLabel, color }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const displayLabel = label ?? (showLabel ? `${Math.round(clamped * 100)}%` : undefined);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgb(var(--line))"
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color ?? 'rgb(var(--brand-green))'}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      {displayLabel !== undefined && (
        <span className="absolute text-[10px] font-medium text-text tabular-nums">{displayLabel}</span>
      )}
    </div>
  );
}
