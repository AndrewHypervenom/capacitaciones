interface Props {
  value: number
  size?: number
}

function Star({ fill, size }: { fill: number; size: number }) {
  const id = `clip-${Math.random().toString(36).slice(2, 9)}`
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <defs>
        <clipPath id={id}>
          <rect x="0" y="0" width={24 * fill} height="24" />
        </clipPath>
      </defs>
      {/* Empty star (background) */}
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"
        fill="#FBBF24"
        opacity={0.2}
      />
      {/* Filled portion */}
      {fill > 0 && (
        <path
          d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"
          fill="#FBBF24"
          clipPath={`url(#${id})`}
        />
      )}
    </svg>
  )
}

export default function StarDisplay({ value, size = 16 }: Props) {
  const clamped = Math.max(0, Math.min(5, value))
  const full = Math.floor(clamped)
  const frac = clamped - full

  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {[...Array(5)].map((_, i) => {
        const fill = i < full ? 1 : i === full ? frac : 0
        return <Star key={i} fill={fill} size={size} />
      })}
    </span>
  )
}
