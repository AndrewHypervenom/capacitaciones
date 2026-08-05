import {
  Sparkles, GraduationCap, BookOpen, BookMarked, Headphones, HeartHandshake,
  Globe, Shield, ShieldCheck, FileCheck, FileText, ClipboardCheck, Award, Trophy,
  Target, Rocket, Lightbulb, Users, Briefcase, PhoneCall, MessageSquare, Brain,
  Star, Zap, Heart, Wrench, Scale, TrendingUp, Map, Compass, Flag, Package,
  Calculator, Building2, Stethoscope, Truck, Laptop, LineChart,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/* ────────────────────────────────────────────────────────────────────────
   Los íconos de cursos y módulos viven en la BD como TEXTO, y ese texto es
   de dos clases según quién creó la fila:
     · un emoji  → "📞" (lo que pide la IA y el selector del editor), o
     · el NOMBRE de un ícono de lucide → "GraduationCap", "Sparkles"
       (los DEFAULT de las columnas `courses.icon` y `modules.icon`).
   Pintar el valor crudo hace que se lea literalmente "GraduationCap" en la
   tarjeta. Este componente decide: nombre conocido → ícono dibujado; emoji →
   emoji; nombre desconocido o vacío → respaldo.
   ──────────────────────────────────────────────────────────────────────── */

const NAMED: Record<string, LucideIcon> = {
  Sparkles, GraduationCap, BookOpen, BookMarked, Headphones, HeartHandshake,
  Globe, Shield, ShieldCheck, FileCheck, FileText, ClipboardCheck, Award, Trophy,
  Target, Rocket, Lightbulb, Users, Briefcase, PhoneCall, MessageSquare, Brain,
  Star, Zap, Heart, Wrench, Scale, TrendingUp, Map, Compass, Flag, Package,
  Calculator, Building2, Stethoscope, Truck, Laptop, LineChart,
};

/** Un identificador ASCII (p. ej. "GraduationCap") NO es un emoji: es un nombre. */
const NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;

interface EntityIconProps {
  /** Valor tal como viene de la BD: emoji o nombre de ícono lucide. */
  value: string | null | undefined;
  /** Emoji de respaldo si no hay valor o el nombre no se reconoce. */
  fallback?: string;
  /** Tamaño en píxeles (lado del ícono / cuerpo del emoji). */
  size?: number;
  className?: string;
}

/** Ícono de un curso o módulo, venga como emoji o como nombre de lucide. */
export function EntityIcon({ value, fallback = '📘', size = 18, className }: EntityIconProps) {
  const raw = value?.trim();

  if (raw && NAME_RE.test(raw)) {
    // Nombre de lucide: si no está en el mapa curado usamos el respaldo
    // dibujado (nunca el texto crudo, que es justo el bug que evitamos).
    const Icon = NAMED[raw] ?? NAMED[fallbackName(fallback)] ?? BookOpen;
    return (
      <Icon
        aria-hidden
        className={cn('shrink-0', className)}
        style={{ width: size, height: size }}
        strokeWidth={1.8}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn('leading-none', className)}
      style={{ fontSize: size }}
    >
      {raw || fallback}
    </span>
  );
}

/** Si el respaldo es un nombre lucide (no un emoji), se usa como ícono. */
function fallbackName(fallback: string): string {
  return NAME_RE.test(fallback) ? fallback : '';
}
