import { useCallback, useRef, useState } from 'react'
import { CheckCircle2, Image, Loader2, Trash2, Upload, Video, Youtube } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { uploadSectionMedia, deleteSectionMedia } from '@/services/modules.service'
import { useConfirm } from '@/components/ui/ConfirmDialog'

type MediaType = 'image' | 'youtube' | 'video'
type Tab = 'image' | 'video' | 'youtube'

interface MediaUploaderProps {
  moduleId: string
  sectionId: string
  campaignId: string
  currentType: MediaType | null
  currentUrl: string | null
  onSaved: (type: MediaType, url: string) => void
  onCleared: () => void
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/ogg'
const IMAGE_MAX = 10 * 1024 * 1024
// Tope de subida de video. Supabase impone un límite GLOBAL de proyecto (50 MB en el
// plan Free) que aplica por encima del file_size_limit del bucket; superarlo da 400.
// Para videos más pesados, usar la pestaña de YouTube.
const VIDEO_MAX = 50 * 1024 * 1024

function extractYouTubeId(input: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ]
  for (const p of patterns) {
    const m = input.trim().match(p)
    if (m) return m[1]
  }
  return null
}

function DropZone({
  accept,
  hint,
  browse,
  sizeHint,
  disabled,
  disabledMsg,
  uploading,
  progress,
  icon,
  onFile,
}: {
  accept: string
  hint: string
  browse: string
  sizeHint: string
  disabled: boolean
  disabledMsg: string
  uploading: boolean
  progress: number
  icon: React.ReactNode
  onFile: (f: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  if (disabled) {
    return (
      <div className="rounded-xl border-2 border-dashed border-line p-8 text-center">
        <p className="text-[13px] text-text-muted">{disabledMsg}</p>
      </div>
    )
  }

  return (
    <div>
      <div
        className={`rounded-xl border-2 border-dashed transition-all cursor-pointer p-8 text-center ${
          dragging
            ? 'border-brand-green bg-brand-green/5 scale-[1.01]'
            : 'border-line hover:border-text-muted hover:bg-subtle/50'
        } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files[0]
          if (f) onFile(f)
        }}
        onClick={() => inputRef.current?.click()}
      >
        <div className={`mx-auto mb-3 h-10 w-10 rounded-xl flex items-center justify-center transition-colors ${
          dragging ? 'bg-brand-green/15 text-brand-green' : 'bg-subtle text-text-muted'
        }`}>
          {icon}
        </div>
        <p className="text-[13px] text-text-muted">
          {hint}{' '}
          <span className="text-text font-medium underline underline-offset-2">{browse}</span>
        </p>
        <p className="text-[11px] text-text-subtle mt-1">{sizeHint}</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
        />
      </div>
      {uploading && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-green" />
              <span className="text-[12px] text-text-muted">{i18n.t('common.uploading')}</span>
            </div>
            <span className="text-[12px] font-mono text-text-muted">{progress}%</span>
          </div>
          <div className="h-1.5 bg-subtle rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-green rounded-full transition-all duration-300"
              style={{ width: `${Math.max(progress, 8)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function MediaUploader({
  moduleId,
  sectionId,
  campaignId,
  currentType,
  currentUrl,
  onSaved,
  onCleared,
}: MediaUploaderProps) {
  const { t } = useTranslation()
  const confirm = useConfirm()

  const [activeTab, setActiveTab] = useState<Tab>(
    currentType === 'video' ? 'video' : currentType === 'youtube' ? 'youtube' : 'image',
  )
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [youtubeInput, setYoutubeInput] = useState(
    currentType === 'youtube' && currentUrl ? currentUrl : '',
  )
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(
    currentType === 'youtube' && currentUrl ? currentUrl : null,
  )
  const [clearing, setClearing] = useState(false)

  const isSectionSaved = sectionId !== ''

  const handleUpload = useCallback(
    async (file: File, kind: 'image' | 'video') => {
      setError(null)
      const isImage = kind === 'image'
      const validTypes = (isImage ? IMAGE_ACCEPT : VIDEO_ACCEPT).split(',')
      const maxSize = isImage ? IMAGE_MAX : VIDEO_MAX

      if (!validTypes.includes(file.type)) {
        setError(t(isImage ? 'admin.modules.media_type_error' : 'admin.modules.media_video_type_error'))
        return
      }
      if (file.size > maxSize) {
        setError(t(isImage ? 'admin.modules.media_size_error' : 'admin.modules.media_video_size_error'))
        return
      }

      setUploading(true)
      setProgress(0)
      try {
        const url = await uploadSectionMedia(file, campaignId, moduleId, sectionId, setProgress)
        onSaved(kind, url)
      } catch (err) {
        console.error('[MediaUploader] upload failed', err)
        const msg = err instanceof Error ? err.message : ''
        setError(msg ? `${t('admin.modules.media_upload_error')}: ${msg}` : t('admin.modules.media_upload_error'))
      } finally {
        setUploading(false)
        setProgress(0)
      }
    },
    [campaignId, moduleId, sectionId, onSaved, t],
  )

  const handleClear = async () => {
    const ok = await confirm({
      title: t('confirm.delete_media_title'),
      description: t('confirm.delete_media_desc'),
      confirmLabel: t('confirm.remove'),
    })
    if (!ok) return
    if (!currentUrl) { onCleared(); return }
    setClearing(true)
    try {
      if (currentType === 'image' || currentType === 'video') {
        await deleteSectionMedia(currentUrl)
      }
      onCleared()
      setYoutubeInput('')
      setPreviewVideoId(null)
    } catch {
      setError(t('admin.modules.media_upload_error'))
    } finally {
      setClearing(false)
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'image', label: t('admin.modules.media_tab_image'), icon: <Image className="h-3.5 w-3.5" /> },
    { id: 'video', label: t('admin.modules.media_tab_video'), icon: <Video className="h-3.5 w-3.5" /> },
    { id: 'youtube', label: t('admin.modules.media_tab_youtube'), icon: <Youtube className="h-3.5 w-3.5" /> },
  ]

  const hasCurrentMedia = !!(currentType && currentUrl)

  return (
    <div className="rounded-2xl border border-line overflow-hidden bg-surface">
      {/* Tab bar */}
      <div className="flex border-b border-line bg-subtle/60">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setError(null) }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-brand-green text-text bg-surface'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}

        {/* Status indicator on right */}
        {hasCurrentMedia && (
          <div className="ml-auto flex items-center gap-1.5 px-4 text-[11px] text-brand-green">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Media lista
          </div>
        )}
      </div>

      <div className="p-4">
        {/* Current media preview when type matches active tab */}
        {currentType === activeTab && currentUrl && activeTab !== 'youtube' && (
          <div className="mb-4 relative rounded-xl overflow-hidden border border-line">
            {activeTab === 'image' && (
              <img src={currentUrl} alt="" className="w-full max-h-40 object-cover block" />
            )}
            {activeTab === 'video' && (
              <video src={currentUrl} controls preload="metadata" className="w-full max-h-40 block bg-black" />
            )}
            <button
              onClick={handleClear}
              disabled={clearing}
              title={t('admin.modules.media_clear')}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}

        {/* Tab: Image upload zone */}
        {activeTab === 'image' && !(currentType === 'image' && currentUrl) && (
          <DropZone
            accept={IMAGE_ACCEPT}
            hint={t('admin.modules.media_drag_hint')}
            browse={t('admin.modules.media_browse')}
            sizeHint="JPG, PNG, WebP, GIF · máx 10 MB"
            disabled={!isSectionSaved}
            disabledMsg={t('admin.modules.media_save_section_first')}
            uploading={uploading}
            progress={progress}
            icon={<Upload className="h-5 w-5" />}
            onFile={(f) => handleUpload(f, 'image')}
          />
        )}

        {/* Tab: Video upload zone */}
        {activeTab === 'video' && !(currentType === 'video' && currentUrl) && (
          <DropZone
            accept={VIDEO_ACCEPT}
            hint={t('admin.modules.media_video_hint')}
            browse={t('admin.modules.media_browse')}
            sizeHint={t('admin.modules.media_video_size_hint')}
            disabled={!isSectionSaved}
            disabledMsg={t('admin.modules.media_save_section_first')}
            uploading={uploading}
            progress={progress}
            icon={<Video className="h-5 w-5" />}
            onFile={(f) => handleUpload(f, 'video')}
          />
        )}

        {/* Tab: YouTube */}
        {activeTab === 'youtube' && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-text-muted uppercase tracking-wide mb-1.5">
                {t('admin.modules.media_youtube_label')}
              </label>
              <input
                value={youtubeInput}
                onChange={(e) => {
                  const val = e.target.value
                  setYoutubeInput(val)
                  setPreviewVideoId(extractYouTubeId(val))
                  setError(null)
                }}
                placeholder={t('admin.modules.media_youtube_placeholder')}
                className="w-full rounded-xl px-4 py-2.5 text-[13px] text-text bg-subtle border border-line outline-none focus:border-text-muted transition-colors"
              />
              {youtubeInput && !previewVideoId && (
                <p className="text-[11px] text-red-400 mt-1.5">{t('admin.modules.media_youtube_invalid')}</p>
              )}
            </div>

            {previewVideoId && (
              <>
                <div className="relative w-full rounded-xl overflow-hidden border border-line bg-black" style={{ paddingTop: '56.25%' }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${previewVideoId}?rel=0&modestbranding=1`}
                    title="YouTube preview"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full border-0"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSaved('youtube', previewVideoId)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black bg-neon-green hover:bg-neon-green/90 transition-colors flex-1 justify-center"
                  >
                    <Youtube className="h-4 w-4" />
                    {t('admin.modules.media_save')}
                  </button>
                  {currentType === 'youtube' && currentUrl && (
                    <button
                      onClick={handleClear}
                      disabled={clearing}
                      className="p-2 rounded-xl border border-line text-text-muted hover:text-red-400 hover:border-red-400/30 transition-colors"
                    >
                      {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </>
            )}

            {/* YouTube active — show clear without new input */}
            {currentType === 'youtube' && currentUrl && !previewVideoId && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-subtle border border-line">
                <Youtube className="h-4 w-4 text-text-muted shrink-0" />
                <span className="text-[12px] text-text-muted flex-1 truncate">{currentUrl}</span>
                <button
                  onClick={handleClear}
                  disabled={clearing}
                  className="p-1.5 text-text-muted hover:text-red-400 transition-colors"
                >
                  {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
          </div>
        )}

        {/* If current media type is different from active tab — show switch notice */}
        {hasCurrentMedia && currentType !== activeTab && activeTab !== 'youtube' && (
          <p className="mt-3 text-[11px] text-text-subtle text-center">
            Ya hay {currentType === 'image' ? 'una imagen' : currentType === 'video' ? 'un video' : 'un video de YouTube'} guardada.{' '}
            <button onClick={handleClear} className="text-red-400 underline underline-offset-2">
              {t('admin.modules.media_clear')}
            </button>
          </p>
        )}

        {error && <p className="mt-3 text-[12px] text-red-400">{error}</p>}
      </div>
    </div>
  )
}
