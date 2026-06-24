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

export interface Database {
  public: {
    Tables: {
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
      modules: {
        Row: {
          id: string
          campaign_id: string
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
          is_published: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
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
          is_published?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
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
          is_published?: boolean
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
          media_type: 'image' | 'youtube' | 'video' | null
          media_url: string | null
          media_caption_es: string | null
          media_caption_en: string | null
          media_caption_pt: string | null
          media_size: 'sm' | 'md' | 'lg' | 'full' | 'bleed' | null
          media_align: 'left' | 'center' | 'right' | null
          media_shadow: boolean
          section_style: 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | null
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
          media_type?: 'image' | 'youtube' | 'video' | null
          media_url?: string | null
          media_caption_es?: string | null
          media_caption_en?: string | null
          media_caption_pt?: string | null
          media_size?: 'sm' | 'md' | 'lg' | 'full' | 'bleed' | null
          media_align?: 'left' | 'center' | 'right' | null
          media_shadow?: boolean
          section_style?: 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | null
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
          media_type?: 'image' | 'youtube' | 'video' | null
          media_url?: string | null
          media_caption_es?: string | null
          media_caption_en?: string | null
          media_caption_pt?: string | null
          media_size?: 'sm' | 'md' | 'lg' | 'full' | 'bleed' | null
          media_align?: 'left' | 'center' | 'right' | null
          media_shadow?: boolean
          section_style?: 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | null
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
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          display_name: string | null
          country: string | null
          language: string | null
          role: 'superadmin' | 'admin' | 'capacitador' | 'learner'
          campaign_id: string | null
          onboarded: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          country?: string | null
          language?: string | null
          role?: 'superadmin' | 'admin' | 'capacitador' | 'learner'
          campaign_id?: string | null
          onboarded?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string | null
          country?: string | null
          language?: string | null
          role?: 'superadmin' | 'admin' | 'capacitador' | 'learner'
          campaign_id?: string | null
          onboarded?: boolean
          updated_at?: string
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
        }
        Update: {
          status?: 'lobby' | 'active' | 'ended'
          current_question?: number
          questions?: Json
          pin?: string
          question_started_at?: string | null
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
        }
        Insert: {
          id?: string
          world_id: string
          name: string
          description?: string | null
          icon?: string
          order_index?: number
          created_at?: string
        }
        Update: {
          id?: string
          world_id?: string
          name?: string
          description?: string | null
          icon?: string
          order_index?: number
          created_at?: string
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
        }
        Insert: {
          id?: string
          campaign_id?: string | null
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
        }
        Update: {
          id?: string
          campaign_id?: string | null
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
      auth_campaign_id: {
        Args: Record<string, never>
        Returns: string
      }
      public_landing_stats: {
        Args: Record<string, never>
        Returns: { lessons: number; questions: number; scenarios: number }
      }
    }
    Enums: Record<string, never>
  }
}

// Tipos de conveniencia
export type Campaign = Database['public']['Tables']['campaigns']['Row']
export type Module = Database['public']['Tables']['modules']['Row']
export type ModuleSection = Database['public']['Tables']['module_sections']['Row']
export type SectionQuiz = Database['public']['Tables']['section_quizzes']['Row']
export type Scenario = Database['public']['Tables']['scenarios']['Row']
export type ChoiceScenario = Database['public']['Tables']['choice_scenarios']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']
export type UserProgress = Database['public']['Tables']['user_progress']['Row']

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
  display_name: string
  score: number
  correct: number
  total: number
}
