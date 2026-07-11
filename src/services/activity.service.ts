// src/services/activity.service.ts
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";

// ==========================================
// 1. ADAPTACIÓN DE TIPOS PARA EL CMS
// ==========================================
export interface FeedbackPayload {
  attempt_id: string;
  user_id: string; // Necesario para identificar la fila en user_progress
  trainer_id: string;
  trainer_comment: string;
  feedback_date: string; 
}

// ==========================================
// 2. FUNCIONES DEL APRENDIZ (ESTUDIANTE)
// ==========================================

/**
 * Guarda o registra un intento de juego dentro del JSON 'attempts' de user_progress.
 * Si el usuario todavía no tiene fila en user_progress para esa campaña, la crea.
 */
export const saveActivityAttempt = async (attemptData: any) => {
  console.log("================================");
  console.log("INTENTANDO GUARDAR EN USER_PROGRESS:");
  console.log("Datos:", JSON.stringify(attemptData, null, 2));
  console.log("================================");

  try {
    // 1. Obtener el progreso actual del usuario (si existe).
    // NO usamos .maybeSingle(): si por historial existieran filas duplicadas de
    // (user_id, campaign_id), .maybeSingle() lanzaría y el intento se perdería en
    // silencio. Traemos todas y trabajamos sobre la más reciente.
    const { data: progressRows, error: fetchError } = await supabase
      .from('user_progress')
      .select('id, attempts')
      .eq('user_id', attemptData.user_id)
      .eq('campaign_id', attemptData.campaign_id)
      .order('updated_at', { ascending: false });

    if (fetchError) throw fetchError;

    const currentProgress = progressRows && progressRows.length > 0 ? progressRows[0] : null;

    // 2. Preparar el arreglo de intentos previo o uno nuevo
    let currentAttempts = currentProgress && Array.isArray(currentProgress.attempts)
      ? currentProgress.attempts
      : [];

    // Estructuramos el nuevo intento
    const newAttempt = {
      id: crypto.randomUUID(),
      section_id: attemptData.section_id,
      module_id: attemptData.module_id,
      game_type: attemptData.game_type,
      score: attemptData.score,
      status: attemptData.status || 'completed',
      started_at: new Date().toISOString(),
      submitted_answers: attemptData.submitted_answers || {},
      trainer_comment: null,
      feedback_date: null
    };

    currentAttempts.push(newAttempt);

    let data, error;

    if (currentProgress) {
      // ✅ Ya existe la fila → update por id (no por user+campaign, para no tocar
      // eventuales filas duplicadas y actualizar exactamente la más reciente).
      ({ data, error } = await supabase
        .from('user_progress')
        .update({ attempts: currentAttempts })
        .eq('id', currentProgress.id)
        .select());
    } else {
      // ✅ No existía fila de user_progress para este usuario/campaña → la creamos
      console.log("DEBUG: No existía fila de user_progress, creando una nueva...");
      ({ data, error } = await supabase
        .from('user_progress')
        .insert({
          user_id: attemptData.user_id,
          campaign_id: attemptData.campaign_id,
          attempts: currentAttempts,
        })
        .select());
    }

    if (error) {
      console.error("INSERT/UPDATE ERROR EN USER_PROGRESS:", error);
    } else if (!data || data.length === 0) {
      console.error("ADVERTENCIA: la operación no afectó ninguna fila (data vacío). El intento no se guardó realmente.");
    } else {
      console.log("INTENTO GUARDADO CON ÉXITO EN EL JSON.");

      //  Emitimos el evento global justo en el momento en que Supabase responde 200 OK
      window.dispatchEvent(new Event('activity_attempt_saved'));
      console.log("DEBUG: Evento 'activity_attempt_saved' despachado con éxito.");
    }

    return { data, error };
  } catch (err) {
    console.error("ERROR CRÍTICO AL REALIZAR UPDATE DE INTENTO:", err);
    return { data: null, error: err };
  }
};

/**
 * Recupera todos los intentos guardados dentro de un módulo para un alumno.
 */
export const getModuleFeedbackForUser = async (moduleId: string, userId: string) => {
  try {
    console.log(`DEBUG: Consultando progreso en Supabase para el usuario: ${userId}`);
    
    const { data: progressRows, error } = await supabase
      .from('user_progress')
      .select('*')
      .eq('user_id', userId); // Trae el progreso global del alumno
      
    if (error) throw error;
    if (!progressRows || progressRows.length === 0) {
      console.log("DEBUG: No se encontraron filas de progreso para este usuario.");
      return { data: [], error: null };
    }

    // Extraemos todos los intentos del arreglo JSON del alumno de forma directa
    const allAttempts = progressRows.flatMap(row => Array.isArray(row.attempts) ? row.attempts : []);
    
    console.log(`DEBUG: Conexión exitosa. Se enviaron ${allAttempts.length} intentos a la tarjeta lateral.`);
    return { data: allAttempts, error: null };
  } catch (err) {
    console.error("Falló la conexión en getModuleFeedbackForUser:", err);
    return { data: [], error: err };
  }
};
// ==========================================
// 3. FUNCIONES DEL FORMADOR (ADMIN/CAPACITADOR)
// ==========================================
export const getPendingAttempts = async (opts?: { excludeSuperadmins?: boolean }) => {
  try {
    console.log("DEBUG: Iniciando descarga desde user_progress...");
    const { data: progressRows, error: progressError } = await supabase
      .from('user_progress')
      .select('*');

    if (progressError) throw progressError;
    if (!progressRows || progressRows.length === 0) {
      console.log("DEBUG: La tabla user_progress está completamente vacía.");
      return { data: [], error: null };
    }

    const userIds = progressRows.map(row => row.user_id).filter(Boolean);

    // Traemos perfiles relacionales
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, role')
      .in('id', userIds);

    // Traemos las secciones (para nombre real + estilo del desafío)
    const { data: sections } = await supabase
      .from('module_sections')
      .select('id, module_id, heading_es, section_style');

    // Traemos los módulos reales para no hardcodear el nombre del módulo/curso
    const { data: modules } = await supabase
      .from('modules')
      .select('id, title_es');

    const allFormattedAttempts: any[] = [];

    progressRows.forEach(row => {
      const studentProfile = profiles?.find(p => p.id === row.user_id) || null;

      // El panel del capacitador nunca debe mostrar resultados de un superadmin.
      if (opts?.excludeSuperadmins && studentProfile?.role === 'superadmin') return;

      const rawAttempts = Array.isArray(row.attempts)
        ? row.attempts
        : typeof row.attempts === 'string'
          ? JSON.parse(row.attempts)
          : [];

      console.log(`DEBUG: Usuario ${row.user_id} tiene ${rawAttempts.length} intentos en su JSON.`);

      rawAttempts.forEach((attempt: any) => {
        const sectionData = sections?.find(s => s.id === attempt.section_id) || null;
        // El módulo real: primero por el module_id del intento, si no por el de la sección
        const moduleId = attempt.module_id || sectionData?.module_id || null;
        const moduleData = moduleId ? modules?.find(m => m.id === moduleId) || null : null;
        const isPending = !attempt.trainer_comment || attempt.status !== 'evaluated';

        if (isPending) {
          allFormattedAttempts.push({
            id: attempt.id || crypto.randomUUID(),
            user_id: row.user_id,
            // UUID real del módulo (module.dbId); lo usa el panel para leer el
            // tiempo activo del aprendiz en ese módulo desde module_time.
            module_id: moduleId,
            game_type: attempt.game_type || (sectionData?.section_style === 'game-classify' ? 'CLASSIFY_CASES' : 'SORT_PROCESS'),
            score: attempt.score ?? 100,
            started_at: attempt.started_at || row.updated_at || new Date().toISOString(),
            submitted_answers: attempt.submitted_answers || {},
            trainer_comment: attempt.trainer_comment || null,

            student: {
              id: row.user_id,
              name: studentProfile?.display_name || 'Aprendiz en Evaluación',
              // El email no vive en profiles (está en auth.users), no lo fabricamos.
              email: null,
            },
            section: {
              heading_es: sectionData?.heading_es || (sectionData?.section_style === 'game-classify' ? 'Clasificación de Casos' : 'Secuenciación de Pasos')
            },
            module: { title_es: moduleData?.title_es || 'Módulo' }
          });
        }
      });
    });

    console.log('DEBUG: Total de intentos formateados listos para pintar:', allFormattedAttempts.length, allFormattedAttempts);
    return { data: allFormattedAttempts, error: null };

  } catch (error) {
    console.error("Error crítico recolectando intentos desde user_progress:", error);
    return { data: null, error: error };
  }
};

/**
 * Busca el intento específico en el JSON, inyecta el feedback y guarda el nuevo estado de la celda.
 *
 * Un usuario puede tener VARIAS filas en user_progress (una por campaña), así que
 * no podemos usar .maybeSingle()/.single() por user_id (lanzaría con múltiples
 * filas y el feedback se perdía). Buscamos la fila que realmente contiene el
 * intento y actualizamos ESA por su id.
 */
export const saveTrainerFeedback = async (payload: FeedbackPayload) => {
  try {
    // 1. Traer TODAS las filas de progreso del usuario (puede tener varias campañas).
    const { data: rows, error: fetchError } = await supabase
      .from('user_progress')
      .select('id, attempts')
      .eq('user_id', payload.user_id);

    if (fetchError) throw fetchError;
    if (!rows || rows.length === 0) throw new Error("No se halló el árbol de intentos");

    // 2. Ubicar la fila que contiene el intento a evaluar.
    const targetRow = rows.find(
      (r) => Array.isArray(r.attempts) && r.attempts.some((a: any) => a.id === payload.attempt_id),
    );
    if (!targetRow) throw new Error("No se encontró el intento a evaluar");

    // 3. Inyectar el feedback en ese intento.
    const updatedAttempts = (targetRow.attempts as any[]).map((attempt: any) =>
      attempt.id === payload.attempt_id
        ? {
            ...attempt,
            trainer_id: payload.trainer_id,
            trainer_comment: payload.trainer_comment,
            feedback_date: payload.feedback_date,
            status: 'evaluated',
          }
        : attempt,
    );

    // 4. Guardar de vuelta actualizando exactamente esa fila por su id.
    const { data, error } = await supabase
      .from('user_progress')
      .update({ attempts: updatedAttempts })
      .eq('id', targetRow.id)
      .select()
      .single();

    if (error) throw error;

    //  Disparamos el evento también aquí por si el alumno está viendo su pantalla mientras el profesor califica
    window.dispatchEvent(new Event('activity_attempt_saved'));

    return { data, error: null };
  } catch (error) {
    console.error("Error guardando el feedback en el JSON de user_progress:", error);
    return { data: null, error };
  }
};

// ==========================================
// 4. RETROALIMENTACIONES DEL APRENDIZ (vista central)
// ==========================================

export interface StudentFeedbackItem {
  id: string;
  game_type: string;
  score: number;
  trainer_comment: string;
  feedback_date: string | null;
  started_at: string | null;
  module_slug: string | null;
  module_title: { es: string; en: string | null; pt: string | null } | null;
  section_heading: { es: string; en: string | null; pt: string | null } | null;
}

/**
 * Todas las retroalimentaciones que un capacitador dejó al aprendiz (a través de
 * todos sus módulos/campañas), con el nombre real del módulo/sección para poder
 * consultarlas en un solo lugar. Ordenadas de la más reciente a la más antigua.
 */
export const getMyTrainerFeedback = async (
  userId: string,
): Promise<{ data: StudentFeedbackItem[]; error: unknown }> => {
  try {
    const { data: progressRows, error } = await supabase
      .from('user_progress')
      .select('attempts')
      .eq('user_id', userId);

    if (error) throw error;

    const allAttempts = (progressRows ?? []).flatMap((row) =>
      Array.isArray(row.attempts) ? row.attempts : [],
    );
    const withFeedback = allAttempts.filter(
      (a: any) => a?.trainer_comment && String(a.trainer_comment).trim().length > 0,
    );
    if (withFeedback.length === 0) return { data: [], error: null };

    const sectionIds = [...new Set(withFeedback.map((a: any) => a.section_id).filter(Boolean))];
    const [sectionsRes, modulesRes] = await Promise.all([
      sectionIds.length
        ? supabase
            .from('module_sections')
            .select('id, module_id, heading_es, heading_en, heading_pt')
            .in('id', sectionIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('modules').select('id, slug, title_es, title_en, title_pt'),
    ]);
    const sections = sectionsRes.data ?? [];
    const modules = modulesRes.data ?? [];

    const items: StudentFeedbackItem[] = withFeedback.map((a: any) => {
      const sec = sections.find((s: any) => s.id === a.section_id) || null;
      const moduleId = a.module_id || sec?.module_id || null;
      const mod = moduleId ? modules.find((m: any) => m.id === moduleId) || null : null;
      return {
        id: a.id,
        game_type: a.game_type || '',
        score: a.score ?? 0,
        trainer_comment: String(a.trainer_comment),
        feedback_date: a.feedback_date ?? null,
        started_at: a.started_at ?? null,
        module_slug: mod?.slug ?? null,
        module_title: mod
          ? { es: mod.title_es, en: mod.title_en, pt: mod.title_pt }
          : null,
        section_heading: sec
          ? { es: sec.heading_es, en: sec.heading_en, pt: sec.heading_pt }
          : null,
      };
    });

    // Más reciente primero (por fecha de feedback; si falta, por fecha del intento).
    items.sort((x, y) => {
      const tx = new Date(x.feedback_date || x.started_at || 0).getTime();
      const ty = new Date(y.feedback_date || y.started_at || 0).getTime();
      return ty - tx;
    });

    return { data: items, error: null };
  } catch (error) {
    console.error('Error obteniendo las retroalimentaciones del aprendiz:', error);
    return { data: [], error };
  }
};
