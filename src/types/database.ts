// Tipos para el schema de Supabase.
// Para regenerar automáticamente después de crear el proyecto:
//   npx supabase gen types typescript --project-id <your-project-id> > src/types/database.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** Condiciones de certificación configurables por el capacitador (por curso). */
export interface CertConditions {
  require_all_modules: boolean
  min_modules_pct: number
  /** Puntaje mínimo (0-100) que el aprendiz debe promediar en las actividades
   *  de un módulo (quizzes/juegos) para que ese módulo cuente como aprobado.
   *  Aplica a todos los módulos del curso. */
  module_pass_pct: number
  require_simulator: boolean
  min_score: number
  required_scenario_slugs: string[]
  require_world: boolean
  valid_months: number | null
}

export interface Database {
  public: {
    Tables: {
      activity_log: {
        Row: {
          id: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          action: string
          entity_type: string
          entity_id: string | null
          entity_label: string | null
          campaign_id: string | null
          detail: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          action: string
          entity_type: string
          entity_id?: string | null
          entity_label?: string | null
          campaign_id?: string | null
          detail?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          action?: string
          entity_type?: string
          detail?: Json | null
        }
        Relationships: []
      }
      deletion_requests: {
        Row: {
          id: string
          entity_type: string
          entity_id: string
          entity_label: string | null
          campaign_id: string | null
          requested_by: string | null
          requested_at: string
          status: string
          resolved_by: string | null
          resolved_at: string | null
        }
        Insert: {
          id?: string
          entity_type: string
          entity_id: string
          entity_label?: string | null
          campaign_id?: string | null
          requested_by?: string | null
          requested_at?: string
          status?: string
          resolved_by?: string | null
          resolved_at?: string | null
        }
        Update: {
          status?: string
          resolved_by?: string | null
          resolved_at?: string | null
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          id: string
          slug: string
          name: string
          description: string | null
          logo_url: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          description?: string | null
          logo_url?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          description?: string | null
          logo_url?: string | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      user_temp_credentials: {
        Row: {
          user_id: string
          email: string
          temp_password: string
          created_at: string
        }
        Insert: {
          user_id: string
          email: string
          temp_password: string
          created_at?: string
        }
        Update: {
          user_id?: string
          email?: string
          temp_password?: string
          created_at?: string
        }
        Relationships: []
      }
      courses: {
        Row: {
          id: string
          campaign_id: string
          slug: string
          title_es: string
          title_en: string | null
          title_pt: string | null
          description_es: string | null
          description_en: string | null
          description_pt: string | null
          cover_url: string | null
          cover_fit: 'cover' | 'contain'
          icon: string
          color: string
          category: string | null
          level: 'basico' | 'medio' | 'avanzado'
          visibility: 'assigned' | 'catalog'
          is_published: boolean
          sort_order: number
          is_shareable: boolean
          copied_from: string | null
          created_by: string | null
          cert_conditions: CertConditions
          sim_unlock_rule: 'after_modules' | 'from_start' | 'after_module'
          sim_unlock_module_id: string | null
          sim_max_attempts: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          slug: string
          title_es: string
          title_en?: string | null
          title_pt?: string | null
          description_es?: string | null
          description_en?: string | null
          description_pt?: string | null
          cover_url?: string | null
          cover_fit?: 'cover' | 'contain'
          icon?: string
          color?: string
          category?: string | null
          level?: 'basico' | 'medio' | 'avanzado'
          visibility?: 'assigned' | 'catalog'
          is_published?: boolean
          sort_order?: number
          is_shareable?: boolean
          copied_from?: string | null
          created_by?: string | null
          cert_conditions?: CertConditions
          sim_unlock_rule?: 'after_modules' | 'from_start' | 'after_module'
          sim_unlock_module_id?: string | null
          sim_max_attempts?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          slug?: string
          title_es?: string
          title_en?: string | null
          title_pt?: string | null
          description_es?: string | null
          description_en?: string | null
          description_pt?: string | null
          cover_url?: string | null
          cover_fit?: 'cover' | 'contain'
          icon?: string
          color?: string
          category?: string | null
          level?: 'basico' | 'medio' | 'avanzado'
          visibility?: 'assigned' | 'catalog'
          is_published?: boolean
          sort_order?: number
          is_shareable?: boolean
          cert_conditions?: CertConditions
          sim_unlock_rule?: 'after_modules' | 'from_start' | 'after_module'
          sim_unlock_module_id?: string | null
          sim_max_attempts?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      campaign_collaborators: {
        Row: {
          campaign_id: string
          user_id: string
          added_by: string | null
          created_at: string
        }
        Insert: {
          campaign_id: string
          user_id: string
          added_by?: string | null
          created_at?: string
        }
        Update: {
          added_by?: string | null
        }
        Relationships: []
      }
      course_campaigns: {
        Row: {
          course_id: string
          campaign_id: string
          is_mandatory: boolean
          assigned_by: string | null
          assigned_at: string
        }
        Insert: {
          course_id: string
          campaign_id: string
          is_mandatory?: boolean
          assigned_by?: string | null
          assigned_at?: string
        }
        Update: {
          is_mandatory?: boolean
        }
        Relationships: []
      }
      course_assignments: {
        Row: {
          course_id: string
          user_id: string
          is_mandatory: boolean
          assigned_by: string | null
          assigned_at: string
        }
        Insert: {
          course_id: string
          user_id: string
          is_mandatory?: boolean
          assigned_by?: string | null
          assigned_at?: string
        }
        Update: {
          is_mandatory?: boolean
        }
        Relationships: []
      }
      modules: {
        Row: {
          id: string
          campaign_id: string
          course_id: string | null
          course_sort_order: number
          slug: string
          icon: string
          duration_min: number
          sort_order: number
          title_es: string
          title_en: string | null
          title_pt: string | null
          subtitle_es: string | null
          subtitle_en: string | null
          subtitle_pt: string | null
          objectives_es: string[]
          objectives_en: string[] | null
          objectives_pt: string[] | null
          key_takeaways_es: string[]
          key_takeaways_en: string[] | null
          key_takeaways_pt: string[] | null
          sound_theme: string | null
          is_published: boolean
          /** Módulo del que se clonó este (deep-copy). NULL = original. */
          copied_from: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          course_id?: string | null
          course_sort_order?: number
          slug: string
          icon?: string
          duration_min?: number
          sort_order?: number
          title_es: string
          title_en?: string | null
          title_pt?: string | null
          subtitle_es?: string | null
          subtitle_en?: string | null
          subtitle_pt?: string | null
          objectives_es?: string[]
          objectives_en?: string[] | null
          objectives_pt?: string[] | null
          key_takeaways_es?: string[]
          key_takeaways_en?: string[] | null
          key_takeaways_pt?: string[] | null
          sound_theme?: string | null
          is_published?: boolean
          copied_from?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          course_id?: string | null
          course_sort_order?: number
          slug?: string
          icon?: string
          duration_min?: number
          sort_order?: number
          title_es?: string
          title_en?: string | null
          title_pt?: string | null
          subtitle_es?: string | null
          subtitle_en?: string | null
          subtitle_pt?: string | null
          objectives_es?: string[]
          objectives_en?: string[] | null
          objectives_pt?: string[] | null
          key_takeaways_es?: string[]
          key_takeaways_en?: string[] | null
          key_takeaways_pt?: string[] | null
          sound_theme?: string | null
          is_published?: boolean
          copied_from?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      module_sections: {
        Row: {
          id: string
          module_id: string
          sort_order: number
          heading_es: string
          heading_en: string | null
          heading_pt: string | null
          body_es: string[]
          body_en: string[] | null
          body_pt: string[] | null
          callout_kind: 'tip' | 'important' | 'warning' | 'success' | 'quote' | 'note' | null
          callout_es: string | null
          callout_en: string | null
          callout_pt: string | null
          media_type: 'image' | 'youtube' | 'vimeo' | 'video' | null
          media_url: string | null
          media_caption_es: string | null
          media_caption_en: string | null
          media_caption_pt: string | null
          media_size: 'sm' | 'md' | 'lg' | 'full' | 'bleed' | null
          media_align: 'left' | 'center' | 'right' | null
          media_shadow: boolean
          section_style: 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | 'game-sort' | 'game-classify' | null
          video_markers: Json | null
          blocks_data: Json | null
        }
        Insert: {
          id?: string
          module_id: string
          sort_order?: number
          heading_es: string
          heading_en?: string | null
          heading_pt?: string | null
          body_es?: string[]
          body_en?: string[] | null
          body_pt?: string[] | null
          callout_kind?: 'tip' | 'important' | 'warning' | 'success' | 'quote' | 'note' | null
          callout_es?: string | null
          callout_en?: string | null
          callout_pt?: string | null
          media_type?: 'image' | 'youtube' | 'vimeo' | 'video' | null
          media_url?: string | null
          media_caption_es?: string | null
          media_caption_en?: string | null
          media_caption_pt?: string | null
          media_size?: 'sm' | 'md' | 'lg' | 'full' | 'bleed' | null
          media_align?: 'left' | 'center' | 'right' | null
          media_shadow?: boolean
          section_style?: 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | 'game-sort' | 'game-classify' | null
          video_markers?: Json | null
          blocks_data?: Json | null
        }
        Update: {
          id?: string
          module_id?: string
          sort_order?: number
          heading_es?: string
          heading_en?: string | null
          heading_pt?: string | null
          body_es?: string[]
          body_en?: string[] | null
          body_pt?: string[] | null
          callout_kind?: 'tip' | 'important' | 'warning' | 'success' | 'quote' | 'note' | null
          callout_es?: string | null
          callout_en?: string | null
          callout_pt?: string | null
          media_type?: 'image' | 'youtube' | 'vimeo' | 'video' | null
          media_url?: string | null
          media_caption_es?: string | null
          media_caption_en?: string | null
          media_caption_pt?: string | null
          media_size?: 'sm' | 'md' | 'lg' | 'full' | 'bleed' | null
          media_align?: 'left' | 'center' | 'right' | null
          media_shadow?: boolean
          section_style?: 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | 'game-sort' | 'game-classify' | null
          video_markers?: Json | null
          blocks_data?: Json | null
        }
        Relationships: []
      }
      section_quizzes: {
        Row: {
          id: string
          section_id: string
          question_es: string
          question_en: string | null
          question_pt: string | null
          options_es: string[]
          options_en: string[] | null
          options_pt: string[] | null
          correct_index: number
          explanation_es: string | null
          explanation_en: string | null
          explanation_pt: string | null
        }
        Insert: {
          id?: string
          section_id: string
          question_es: string
          question_en?: string | null
          question_pt?: string | null
          options_es?: string[]
          options_en?: string[] | null
          options_pt?: string[] | null
          correct_index?: number
          explanation_es?: string | null
          explanation_en?: string | null
          explanation_pt?: string | null
        }
        Update: {
          id?: string
          section_id?: string
          question_es?: string
          question_en?: string | null
          question_pt?: string | null
          options_es?: string[]
          options_en?: string[] | null
          options_pt?: string[] | null
          correct_index?: number
          explanation_es?: string | null
          explanation_en?: string | null
          explanation_pt?: string | null
        }
        Relationships: []
      }
      activity_attempts: {
        Row: {
          id: string
          user_id: string
          campaign_id: string
          module_id: string
          section_id: string
          game_type: string
          score: number
          attempt_number: number
          status: 'in_progress' | 'completed'
          started_at: string
          completed_at: string | null
          time_spent_seconds: number | null
          submitted_answers: Json
          trainer_id: string | null
          trainer_comment: string | null
          feedback_date: string | null
        }
        Insert: {
          id?: string
          user_id: string
          campaign_id: string
          module_id: string
          section_id: string
          game_type: string
          score: number
          attempt_number: number
          status: 'in_progress' | 'completed'
          time_spent_seconds?: number | null
          submitted_answers: Json
          trainer_id?: string | null
          trainer_comment?: string | null
          feedback_date?: string | null
          started_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          campaign_id?: string
          module_id?: string
          section_id?: string
          game_type?: string
          score?: number
          attempt_number?: number
          status?: 'in_progress' | 'completed'
          time_spent_seconds?: number | null
          submitted_answers?: Json
          trainer_id?: string | null
          trainer_comment?: string | null
          feedback_date?: string | null
          started_at?: string
          completed_at?: string | null
        }
        Relationships: []
      }
      scenarios: {
        Row: {
          id: string
          campaign_id: string
          slug: string
          country: 'CO' | 'MX' | 'AR'
          difficulty: number
          title_es: string
          title_en: string | null
          title_pt: string | null
          summary_es: string | null
          summary_en: string | null
          summary_pt: string | null
          customer_name: string | null
          customer_phone: string | null
          customer_reason_es: string | null
          customer_reason_en: string | null
          customer_reason_pt: string | null
          avatar_seed: number | null
          checklist_items: Json
          empathy_keywords: string[] | null
          max_turns: number | null
          start_node_id: string
          nodes: Json
          is_published: boolean
          course_id: string | null
          pass_score: number
          counts_for_cert: boolean
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          slug: string
          country?: 'CO' | 'MX' | 'AR'
          difficulty?: number
          title_es: string
          title_en?: string | null
          title_pt?: string | null
          summary_es?: string | null
          summary_en?: string | null
          summary_pt?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_reason_es?: string | null
          customer_reason_en?: string | null
          customer_reason_pt?: string | null
          avatar_seed?: number | null
          checklist_items?: Json
          empathy_keywords?: string[] | null
          max_turns?: number | null
          start_node_id?: string
          nodes?: Json
          is_published?: boolean
          course_id?: string | null
          pass_score?: number
          counts_for_cert?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          slug?: string
          country?: 'CO' | 'MX' | 'AR'
          difficulty?: number
          title_es?: string
          title_en?: string | null
          title_pt?: string | null
          summary_es?: string | null
          summary_en?: string | null
          summary_pt?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_reason_es?: string | null
          customer_reason_en?: string | null
          customer_reason_pt?: string | null
          avatar_seed?: number | null
          checklist_items?: Json
          empathy_keywords?: string[] | null
          max_turns?: number | null
          start_node_id?: string
          nodes?: Json
          is_published?: boolean
          course_id?: string | null
          pass_score?: number
          counts_for_cert?: boolean
        }
        Relationships: []
      }
      simulator_attempts: {
        Row: {
          id: string
          user_id: string
          course_id: string | null
          campaign_id: string | null
          scenario_slug: string
          score: number
          checklist_pct: number
          empathy_pct: number
          resolved: boolean
          duration_sec: number
          created_at: string
          ai_feedback: { summary: string; strengths: string[]; improvements: string[] } | null
        }
        Insert: {
          id?: string
          user_id: string
          course_id?: string | null
          campaign_id?: string | null
          scenario_slug: string
          score?: number
          checklist_pct?: number
          empathy_pct?: number
          resolved?: boolean
          duration_sec?: number
          created_at?: string
          ai_feedback?: { summary: string; strengths: string[]; improvements: string[] } | null
        }
        Update: {
          score?: number
          checklist_pct?: number
          empathy_pct?: number
          resolved?: boolean
          duration_sec?: number
        }
        Relationships: []
      }
      certifications: {
        Row: {
          id: string
          user_id: string
          course_id: string
          campaign_id: string | null
          cert_id: string
          score: number
          issued_at: string
        }
        Insert: {
          id?: string
          user_id: string
          course_id: string
          campaign_id?: string | null
          cert_id: string
          score?: number
          issued_at?: string
        }
        Update: {
          score?: number
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          id: string
          user_id: string
          kind: string
          scope: 'course' | 'module' | 'section' | 'world' | 'simulator'
          course_id: string | null
          payload: Json
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          kind?: string
          scope: 'course' | 'module' | 'section' | 'world' | 'simulator'
          course_id?: string | null
          payload?: Json
          created_at?: string
          read_at?: string | null
        }
        Update: {
          read_at?: string | null
        }
        Relationships: []
      }
      choice_scenarios: {
        Row: {
          id: string
          campaign_id: string
          slug: string
          title_es: string
          title_en: string | null
          title_pt: string | null
          description: string | null
          client_name: string | null
          client_company: string | null
          objective: string | null
          level: 'basico' | 'medio' | 'avanzado'
          start_node_id: string
          nodes: Json
          is_published: boolean
          course_id: string | null
          pass_score: number
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          slug: string
          title_es: string
          title_en?: string | null
          title_pt?: string | null
          description?: string | null
          client_name?: string | null
          client_company?: string | null
          objective?: string | null
          level?: 'basico' | 'medio' | 'avanzado'
          start_node_id?: string
          nodes?: Json
          is_published?: boolean
          course_id?: string | null
          pass_score?: number
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          slug?: string
          title_es?: string
          title_en?: string | null
          title_pt?: string | null
          description?: string | null
          client_name?: string | null
          client_company?: string | null
          objective?: string | null
          level?: 'basico' | 'medio' | 'avanzado'
          start_node_id?: string
          nodes?: Json
          is_published?: boolean
          course_id?: string | null
          pass_score?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          display_name: string | null
          country: string | null
          language: string | null
          role: 'superadmin' | 'capacitador' | 'learner'
          campaign_id: string | null
          onboarded: boolean
          avatar_url: string | null
          phone: string | null
          national_id: string | null
          job_title: string | null
          bio: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          country?: string | null
          language?: string | null
          role?: 'superadmin' | 'capacitador' | 'learner'
          campaign_id?: string | null
          onboarded?: boolean
          avatar_url?: string | null
          phone?: string | null
          national_id?: string | null
          job_title?: string | null
          bio?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string | null
          country?: string | null
          language?: string | null
          role?: 'superadmin' | 'capacitador' | 'learner'
          campaign_id?: string | null
          onboarded?: boolean
          avatar_url?: string | null
          phone?: string | null
          national_id?: string | null
          job_title?: string | null
          bio?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      achievement_defs: {
        Row: {
          id: string
          emoji: string
          category: 'progress' | 'streak' | 'excellence' | 'certification' | 'optional'
          metric: string
          threshold: number
          rare: boolean
          requires: 'world' | 'simulator' | null
          enabled: boolean
          builtin: boolean
          sort_order: number
          label_es: string
          label_en: string | null
          label_pt: string | null
          description_es: string
          description_en: string | null
          description_pt: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          emoji?: string
          category?: 'progress' | 'streak' | 'excellence' | 'certification' | 'optional'
          metric: string
          threshold?: number
          rare?: boolean
          requires?: 'world' | 'simulator' | null
          enabled?: boolean
          builtin?: boolean
          sort_order?: number
          label_es: string
          label_en?: string | null
          label_pt?: string | null
          description_es?: string
          description_en?: string | null
          description_pt?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          emoji?: string
          category?: 'progress' | 'streak' | 'excellence' | 'certification' | 'optional'
          metric?: string
          threshold?: number
          rare?: boolean
          requires?: 'world' | 'simulator' | null
          enabled?: boolean
          builtin?: boolean
          sort_order?: number
          label_es?: string
          label_en?: string | null
          label_pt?: string | null
          description_es?: string
          description_en?: string | null
          description_pt?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      xp_levels: {
        Row: {
          level: number
          min_xp: number
          max_xp: number
          color: string
          label_es: string
          label_en: string | null
          label_pt: string | null
        }
        Insert: {
          level: number
          min_xp: number
          max_xp: number
          color?: string
          label_es: string
          label_en?: string | null
          label_pt?: string | null
        }
        Update: {
          level?: number
          min_xp?: number
          max_xp?: number
          color?: string
          label_es?: string
          label_en?: string | null
          label_pt?: string | null
        }
        Relationships: []
      }
      live_quizzes: {
        Row: {
          id: string
          campaign_id: string
          created_by: string
          title: string
          pin: string
          status: 'lobby' | 'active' | 'ended'
          current_question: number
          questions: Json
          created_at: string
          question_started_at: string | null
          pin_expires_at: string | null
        }
        Insert: {
          id?: string
          campaign_id: string
          created_by: string
          title: string
          pin: string
          status?: 'lobby' | 'active' | 'ended'
          current_question?: number
          questions?: Json
          created_at?: string
          question_started_at?: string | null
          pin_expires_at?: string | null
        }
        Update: {
          title?: string
          campaign_id?: string
          status?: 'lobby' | 'active' | 'ended'
          current_question?: number
          questions?: Json
          pin?: string
          question_started_at?: string | null
          pin_expires_at?: string | null
        }
        Relationships: []
      }
      live_quiz_answers: {
        Row: {
          id: string
          quiz_id: string
          user_id: string
          display_name: string
          question_idx: number
          selected_option: number
          is_correct: boolean
          answered_at: string
          score: number
        }
        Insert: {
          id?: string
          quiz_id: string
          user_id: string
          display_name: string
          question_idx: number
          selected_option: number
          is_correct: boolean
          answered_at?: string
          score?: number
        }
        Update: Record<string, never>
        Relationships: []
      }
      user_progress: {
        Row: {
          id: string
          user_id: string
          campaign_id: string
          completed_modules: string[]
          check_answers: Json
          attempts: Json
          xp_total: number
          streak_days: number
          last_activity: string | null
          badges: string[]
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          campaign_id: string
          completed_modules?: string[]
          check_answers?: Json
          attempts?: Json
          xp_total?: number
          streak_days?: number
          last_activity?: string | null
          badges?: string[]
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          campaign_id?: string
          completed_modules?: string[]
          check_answers?: Json
          attempts?: Json
          xp_total?: number
          streak_days?: number
          last_activity?: string | null
          badges?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      module_time: {
        Row: {
          user_id: string
          module_id: string
          elapsed_ms: number
          completed_at: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          module_id: string
          elapsed_ms?: number
          completed_at?: string | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          module_id?: string
          elapsed_ms?: number
          completed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      worlds: {
        Row: {
          id: string
          campaign_id: string
          name: string
          description: string | null
          color: string
          icon: string
          bg_type: string
          status: string
          created_by: string | null
          created_at: string
          updated_at: string
          sound_theme: string
          transition_type: string
          character_emoji: string
          course_id: string | null
        }
        Insert: {
          id?: string
          campaign_id: string
          name: string
          description?: string | null
          color?: string
          icon?: string
          bg_type?: string
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
          sound_theme?: string
          transition_type?: string
          character_emoji?: string
          course_id?: string | null
        }
        Update: {
          id?: string
          campaign_id?: string
          name?: string
          description?: string | null
          color?: string
          icon?: string
          bg_type?: string
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
          sound_theme?: string
          transition_type?: string
          character_emoji?: string
          course_id?: string | null
        }
        Relationships: []
      }
      world_regions: {
        Row: {
          id: string
          world_id: string
          name: string
          description: string | null
          icon: string
          order_index: number
          created_at: string
          module_id: string | null
        }
        Insert: {
          id?: string
          world_id: string
          name: string
          description?: string | null
          icon?: string
          order_index?: number
          created_at?: string
          module_id?: string | null
        }
        Update: {
          id?: string
          world_id?: string
          name?: string
          description?: string | null
          icon?: string
          order_index?: number
          created_at?: string
          module_id?: string | null
        }
        Relationships: []
      }
      world_levels: {
        Row: {
          id: string
          region_id: string
          world_id: string
          quiz_id: string | null
          name: string
          description: string | null
          icon: string
          order_index: number
          position_x: number
          position_y: number
          created_at: string
          min_score_pct: number | null
          module_id: string | null
        }
        Insert: {
          id?: string
          region_id: string
          world_id: string
          quiz_id?: string | null
          name: string
          description?: string | null
          icon?: string
          order_index?: number
          position_x?: number
          position_y?: number
          created_at?: string
          min_score_pct?: number | null
          module_id?: string | null
        }
        Update: {
          id?: string
          region_id?: string
          world_id?: string
          quiz_id?: string | null
          name?: string
          description?: string | null
          icon?: string
          order_index?: number
          position_x?: number
          position_y?: number
          created_at?: string
          min_score_pct?: number | null
          module_id?: string | null
        }
        Relationships: []
      }
      world_progress: {
        Row: {
          id: string
          user_id: string
          level_id: string
          world_id: string
          campaign_id: string | null
          completed: boolean
          xp_earned: number
          score: number
          completed_at: string | null
          started_at: string
        }
        Insert: {
          id?: string
          user_id: string
          level_id: string
          world_id: string
          campaign_id?: string | null
          completed?: boolean
          xp_earned?: number
          score?: number
          completed_at?: string | null
          started_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          level_id?: string
          world_id?: string
          campaign_id?: string | null
          completed?: boolean
          xp_earned?: number
          score?: number
          completed_at?: string | null
          started_at?: string
        }
        Relationships: []
      }
      arena_quizzes: {
        Row: {
          id: string
          campaign_id: string | null
          world_id: string | null
          title: string
          description: string | null
          status: string
          theme_icon: string
          theme_color: string
          theme_type: string
          xp_per_question: number
          steps: Json
          created_by: string | null
          created_at: string
          updated_at: string
          min_score_pct: number | null
          section_size: number
        }
        Insert: {
          id?: string
          campaign_id?: string | null
          world_id?: string | null
          title: string
          description?: string | null
          status?: string
          theme_icon?: string
          theme_color?: string
          theme_type?: string
          xp_per_question?: number
          steps?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
          min_score_pct?: number | null
          section_size?: number
        }
        Update: {
          id?: string
          campaign_id?: string | null
          world_id?: string | null
          title?: string
          description?: string | null
          status?: string
          theme_icon?: string
          theme_color?: string
          theme_type?: string
          xp_per_question?: number
          steps?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
          min_score_pct?: number | null
          section_size?: number
        }
        Relationships: []
      }
      arena_progress: {
        Row: {
          id: string
          user_id: string
          quiz_id: string
          campaign_id: string | null
          xp_earned: number
          completed: boolean
          score: number
          total_questions: number
          completed_at: string | null
          started_at: string
        }
        Insert: {
          id?: string
          user_id: string
          quiz_id: string
          campaign_id?: string | null
          xp_earned?: number
          completed?: boolean
          score?: number
          total_questions?: number
          completed_at?: string | null
          started_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          quiz_id?: string
          campaign_id?: string | null
          xp_earned?: number
          completed?: boolean
          score?: number
          total_questions?: number
          completed_at?: string | null
          started_at?: string
        }
        Relationships: []
      }
      guided_missions: {
        Row: {
          id: string
          campaign_id: string | null
          title: string
          description: string | null
          category: string | null
          status: string
          steps: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id?: string | null
          title: string
          description?: string | null
          category?: string | null
          status?: string
          steps?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string | null
          title?: string
          description?: string | null
          category?: string | null
          status?: string
          steps?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      mission_progress: {
        Row: {
          id: string
          user_id: string
          mission_id: string
          campaign_id: string | null
          xp_earned: number
          completed: boolean
          time_seconds: number
          quiz_score: number
          completed_at: string | null
          started_at: string
        }
        Insert: {
          id?: string
          user_id: string
          mission_id: string
          campaign_id?: string | null
          xp_earned?: number
          completed?: boolean
          time_seconds?: number
          quiz_score?: number
          completed_at?: string | null
          started_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          mission_id?: string
          campaign_id?: string | null
          xp_earned?: number
          completed?: boolean
          time_seconds?: number
          quiz_score?: number
          completed_at?: string | null
          started_at?: string
        }
        Relationships: []
      }
      world_level_attempts: {
        Row: {
          id: string
          user_id: string
          level_id: string
          world_id: string
          campaign_id: string | null
          score: number
          completed_at: string
        }
        Insert: {
          id?: string
          user_id: string
          level_id: string
          world_id: string
          campaign_id?: string | null
          score?: number
          completed_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          level_id?: string
          world_id?: string
          campaign_id?: string | null
          score?: number
          completed_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      auth_role: {
        Args: Record<string, never>
        Returns: string
      }
      request_deletion: {
        Args: { p_entity_type: string; p_entity_id: string }
        Returns: string
      }
      approve_deletion: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      reject_deletion: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      auth_campaign_id: {
        Args: Record<string, never>
        Returns: string
      }
      public_landing_stats: {
        Args: Record<string, never>
        Returns: { lessons: number; questions: number; scenarios: number }
      }
      clone_course: {
        Args: { source_course_id: string }
        Returns: string
      }
      move_course_to_campaign: {
        Args: { p_course_id: string; p_target_campaign_id: string }
        Returns: undefined
      }
      move_module_to_campaign: {
        Args: { p_module_id: string; p_target_campaign_id: string }
        Returns: undefined
      }
      attach_module_to_course: {
        Args: { p_module_id: string; p_course_id: string }
        Returns: undefined
      }
      clone_module_to_course: {
        Args: { p_module_id: string; p_course_id: string }
        Returns: string
      }
      self_enroll_course: {
        Args: { p_course_id: string }
        Returns: undefined
      }
      preview_enroll_self: {
        Args: { p_course_id: string }
        Returns: undefined
      }
      unenroll_self: {
        Args: { p_course_id: string }
        Returns: undefined
      }
      get_course_stats: {
        Args: { p_course_id: string }
        Returns: {
          enrolled: number
          completed: number
          total_modules: number
          completion_pct: number
          avg_progress_pct: number
          is_owner: boolean
          global_enrolled: number
        }
      }
      get_course_certification_status: {
        Args: { p_course_id: string }
        Returns: Json
      }
      get_course_activity_summary: {
        Args: { p_course_id: string; p_user_id: string }
        Returns: Json
      }
      issue_certification: {
        Args: { p_course_id: string }
        Returns: Json
      }
      get_course_evaluation_results: {
        Args: { p_course_id: string }
        Returns: {
          user_id: string
          display_name: string | null
          modules_done: number
          modules_total: number
          best_score: number
          attempts_count: number
          certified: boolean
          cert_id: string | null
          issued_at: string | null
        }[]
      }
      // Recertificación (2026-07-19_cert_snapshot_recert.sql). Un certificado
      // emitido es inmutable; el contenido nuevo NO lo invalida solo.
      get_course_recert_status: {
        Args: { p_course_id: string }
        Returns: {
          user_id: string
          display_name: string | null
          cert_id: string
          issued_at: string
          modules_at_issue: number
          modules_now: number
          new_module_ids: string[]
          expired: boolean
          needs_recert: boolean
        }[]
      }
      request_course_recertification: {
        Args: { p_course_id: string }
        Returns: number
      }
      get_live_quiz_leaderboard: {
        Args: { p_quiz_id: string }
        Returns: {
          user_id: string
          display_name: string
          score: number
          correct: number
          total: number
        }[]
      }
      get_user_courses_admin: {
        Args: { p_user_id: string }
        Returns: Json
      }
      reset_user_course_admin: {
        Args: { p_user_id: string; p_course_id: string }
        Returns: undefined
      }
      reset_user_module_admin: {
        Args: { p_user_id: string; p_module_id: string }
        Returns: undefined
      }
      reset_user_section_admin: {
        Args: { p_user_id: string; p_section_id: string }
        Returns: undefined
      }
      reset_user_world_admin: {
        Args: { p_user_id: string; p_course_id: string }
        Returns: undefined
      }
      reset_user_simulator_admin: {
        Args: { p_user_id: string; p_course_id: string }
        Returns: undefined
      }
      get_user_course_detail_admin: {
        Args: { p_user_id: string; p_course_id: string }
        Returns: Json
      }
      get_all_courses_progress_admin: {
        Args: Record<string, never>
        Returns: Json
      }
      notify_learner_feedback: {
        Args: { p_user_id: string; p_course_id: string | null; p_payload: Json }
        Returns: undefined
      }
      // Verificación pública de certificados (SECURITY DEFINER, accesible anon).
      // Lo consume la página /verify/:certId compartible en LinkedIn.
      get_public_certificate: {
        Args: { p_cert_id: string }
        Returns: {
          cert_id: string
          score: number
          issued_at: string
          display_name: string
          job_title: string | null
          course_id: string
          title_es: string
          title_en: string | null
          title_pt: string | null
          modules_total: number
        }[]
      }
    }
    Enums: Record<string, never>
  }
}

// Tipos de conveniencia
export type Campaign = Database['public']['Tables']['campaigns']['Row']
export type Course = Database['public']['Tables']['courses']['Row']
export type CourseCampaign = Database['public']['Tables']['course_campaigns']['Row']
export type CourseAssignment = Database['public']['Tables']['course_assignments']['Row']
export type Module = Database['public']['Tables']['modules']['Row']
export type ModuleSection = Database['public']['Tables']['module_sections']['Row']
export type SectionQuiz = Database['public']['Tables']['section_quizzes']['Row']
export type Scenario = Database['public']['Tables']['scenarios']['Row']
export type ChoiceScenario = Database['public']['Tables']['choice_scenarios']['Row']
export type SimulatorAttemptRow = Database['public']['Tables']['simulator_attempts']['Row']
export type Certification = Database['public']['Tables']['certifications']['Row']
export type CourseEvaluationResult = Database['public']['Functions']['get_course_evaluation_results']['Returns'][number]
export type CourseRecertStatus = Database['public']['Functions']['get_course_recert_status']['Returns'][number]

/** Estado de certificación devuelto por get_course_certification_status. */
export interface CourseCertStatus {
  modules_done: number
  modules_total: number
  modules_ok: boolean
  best_score: number
  min_score: number
  require_simulator: boolean
  require_all_modules: boolean
  simulator_ok: boolean
  all_met: boolean
  certified: boolean
  cert_id: string | null
  issued_at: string | null
  cert_score: number | null
  /** Mínimo de módulos exigido cuando require_all_modules es false. */
  min_modules_pct: number
  // ── Recertificación (2026-07-19b). Solo con sentido si certified = true. ──
  /** Módulos que tenía el curso cuando se emitió su certificado (congelado). */
  modules_at_issue: number | null
  /** Módulos publicados después de su certificado: contenido que nunca vio. */
  new_modules_count: number
  expires_at: string | null
  expired: boolean
  /** Venció, o el capacitador pidió recertificación después de su emisión. */
  needs_recert: boolean
}

/**
 * Certificado accesible públicamente por su `cert_id` (sin login), para
 * compartir en LinkedIn / verificación por reclutadores. Lo devuelve el RPC
 * `get_public_certificate` (SECURITY DEFINER).
 */
export interface PublicCertificate {
  cert_id: string
  score: number
  issued_at: string
  display_name: string
  job_title: string | null
  course_id: string
  title_es: string
  title_en: string | null
  title_pt: string | null
  modules_total: number
}

/** Constante por defecto de condiciones (coincide con el DEFAULT del SQL). */
export const DEFAULT_CERT_CONDITIONS: CertConditions = {
  require_all_modules: true,
  min_modules_pct: 100,
  module_pass_pct: 80,
  require_simulator: false,
  min_score: 70,
  required_scenario_slugs: [],
  require_world: false,
  valid_months: null,
}
export type Profile = Database['public']['Tables']['profiles']['Row']
export type UserProgress = Database['public']['Tables']['user_progress']['Row']

/**
 * Colaborador de una campaña (equipo de capacitadores). Relación muchos-a-muchos
 * entre campañas y capacitadores; complementa a `profiles.campaign_id` (campaña
 * "casa") permitiendo que varios capacitadores co-gestionen una misma campaña.
 * Tabla definida en supabase/sql/2026-07-15_campaign_collaborators.sql.
 */
export interface CampaignCollaborator {
  campaign_id: string
  user_id: string
  added_by: string | null
  created_at: string
}

/** Capacitador con datos mínimos para el selector de colaboradores. */
export interface CollaboratorProfile {
  id: string
  display_name: string | null
  email: string | null
  job_title: string | null
  avatar_url: string | null
  /** Ya es colaborador de la campaña en cuestión. */
  is_collaborator?: boolean
  /** Es el dueño (campaña casa) — no se puede quitar. */
  is_owner?: boolean
}

export type UserRole = Profile['role']

export interface QuizQuestion {
  text: string
  options: [string, string, string, string]
  correctIndex: number
  timeLimitSec: number
}

export type LiveQuiz = Omit<Database['public']['Tables']['live_quizzes']['Row'], 'questions'> & {
  questions: QuizQuestion[]
}
export type LiveQuizAnswer = Database['public']['Tables']['live_quiz_answers']['Row']

export interface QuizLeaderboardEntry {
  user_id?: string
  display_name: string
  score: number
  correct: number
  total: number
}
