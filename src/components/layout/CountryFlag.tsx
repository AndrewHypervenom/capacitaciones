import type { Country } from '@/stores/userStore';

const FLAGS: Record<Country, { colors: string[]; label: string }> = {
  CO: { colors: ['#FCD116', '#FCD116', '#003893', '#CE1126'], label: 'CO' },
  MX: { colors: ['#006847', '#FFFFFF', '#CE1126'], label: 'MX' },
  AR: { colors: ['#74ACDF', '#FFFFFF', '#74ACDF'], label: 'AR' },
};

interface CountryFlagProps {
  code: Country;
  size?: number;
  className?: string;
}

export function CountryFlag({ code, size = 22, className = '' }: CountryFlagProps) {
  const flag = FLAGS[code];
  return (
    <span
      className={`inline-flex overflow-hidden rounded-[6px] ring-1 ring-white/10 ${className}`}
      style={{ width: size, height: Math.round(size * 0.68) }}
      aria-label={flag.label}
      role="img"
    >
      {flag.colors.map((c, i) => (
        <span
          key={i}
          style={{
            flex: code === 'CO' && i === 1 ? 1 : 1,
            background: c,
          }}
        />
      ))}
    </span>
  );
}
