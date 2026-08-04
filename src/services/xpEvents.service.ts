import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { useXPEventStore, startXPEventTicker, type XPEvent } from '@/stores/xpEventStore';

type Row = Database['public']['Tables']['xp_events']['Row'];
type Insert = Database['public']['Tables']['xp_events']['Insert'];

function rowToEvent(r: Row): XPEvent {
  return {
    id: r.id,
    emoji: r.emoji,
    multiplier: Number(r.multiplier),
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    enabled: r.enabled,
    color: r.color,
    label: r.label_es,
    label_en: r.label_en ?? undefined,
    label_pt: r.label_pt ?? undefined,
    description: r.description_es ?? undefined,
    description_en: r.description_en ?? undefined,
    description_pt: r.description_pt ?? undefined,
  };
}

export function eventToRow(e: XPEvent): Insert {
  return {
    id: e.id,
    emoji: e.emoji,
    multiplier: e.multiplier,
    starts_at: e.startsAt,
    ends_at: e.endsAt,
    enabled: e.enabled,
    color: e.color,
    label_es: e.label,
    label_en: e.label_en ?? null,
    label_pt: e.label_pt ?? null,
    description_es: e.description ?? null,
    description_en: e.description_en ?? null,
    description_pt: e.description_pt ?? null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Carga los eventos y arranca el latido de la UI.
 *
 * Se traen TODOS los vigentes y futuros (más los de los últimos días, para que el
 * panel muestre el historial reciente): son pocas filas y así un evento
 * programado se enciende solo, sin recargar la página. Si la consulta falla, la
 * app se queda sin multiplicador — nunca al revés: fallar nunca regala XP.
 */
export async function loadXPEvents(): Promise<void> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { data, error } = await supabase
      .from('xp_events')
      .select('*')
      .gte('ends_at', since)
      .order('starts_at', { ascending: true });
    if (error) throw error;
    useXPEventStore.getState().setEvents((data ?? []).map(rowToEvent));
  } catch {
    useXPEventStore.setState({ loaded: true });
  } finally {
    startXPEventTicker();
  }
}

/** Todos los eventos, incluidos los viejos (solo para el panel de administración). */
export async function listAllXPEvents(): Promise<XPEvent[]> {
  const { data, error } = await supabase
    .from('xp_events')
    .select('*')
    .order('starts_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToEvent);
}

export async function upsertXPEvent(e: XPEvent): Promise<void> {
  const { error } = await supabase.from('xp_events').upsert(eventToRow(e), { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteXPEvent(id: string): Promise<void> {
  const { error } = await supabase.from('xp_events').delete().eq('id', id);
  if (error) throw error;
}
