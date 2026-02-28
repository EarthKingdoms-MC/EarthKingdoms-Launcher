import { useState, useRef, useCallback, useEffect } from 'react'
import { useSkinHead, useSkinTexture, getSkinUrl, SkinHistoryItem } from '../hooks/useSkin'
import { ReactSkinview3d } from 'react-skinview3d'
import './SkinModal.css'

interface Props {
  username:        string
  skinRefreshKey?: number
  onSkinUploaded?: () => void
  onClose:         () => void
}

type UploadState = 'idle' | 'validating' | 'ready' | 'uploading' | 'success' | 'error'

async function validateSkin(file: File): Promise<string | null> {
  if (!file.name.toLowerCase().endsWith('.png') && file.type !== 'image/png') {
    return 'Le fichier doit être un PNG.'
  }
  if (file.size > 2 * 1024 * 1024) {
    return `Fichier trop lourd (${(file.size / 1024).toFixed(0)} Ko) — max 2 Mo.`
  }
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (img.width !== 64 || img.height !== 64) {
        resolve(`Dimensions invalides (${img.width}×${img.height}) — le skin doit être 64×64 px.`)
      } else {
        resolve(null)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve('Image illisible.') }
    img.src = url
  })
}

// Miniature d'un skin depuis une URL relative serveur
function SkinThumb({ skinUrl, isCurrent, restoring, onClick }: {
  skinUrl:   string
  isCurrent: boolean
  restoring: boolean
  onClick:   () => void
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    window.api.skinLoadUrl(skinUrl).then(url => { if (url) setDataUrl(url) })
  }, [skinUrl])

  return (
    <button
      className={`skinm__hist-item${isCurrent ? ' skinm__hist-item--current' : ''}${restoring ? ' skinm__hist-item--restoring' : ''}`}
      onClick={onClick}
      disabled={isCurrent || restoring}
      title={isCurrent ? 'Skin actuel' : 'Restaurer ce skin'}
    >
      {dataUrl
        ? <img src={dataUrl} className="skinm__hist-thumb" alt="" />
        : <div className="skinm__hist-thumb skinm__hist-thumb--loading" />
      }
      {isCurrent && <span className="skinm__hist-badge">Actuel</span>}
    </button>
  )
}

export default function SkinModal({ username, skinRefreshKey, onSkinUploaded, onClose }: Props) {
  const [tab,          setTab]          = useState<'apercu' | 'changer'>('apercu')
  const [uploadState,  setUploadState]  = useState<UploadState>('idle')
  const [dragOver,     setDragOver]     = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null)
  const [validError,   setValidError]   = useState<string | null>(null)
  const [serverError,  setServerError]  = useState<string | null>(null)
  const [history,      setHistory]      = useState<SkinHistoryItem[]>([])
  const [restoring,    setRestoring]    = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // refreshKey local : incrémenté après upload ou restore pour recharger aperçu + historique
  const [localRefreshKey, setLocalRefreshKey] = useState(skinRefreshKey ?? 0)

  const headUrl    = useSkinHead(username, localRefreshKey)
  const textureUrl = useSkinTexture(username, localRefreshKey)
  const skinUrl    = getSkinUrl(username)

  // Nettoyage object URL à la destruction
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

  // Chargement de l'historique à l'ouverture de l'onglet "changer"
  useEffect(() => {
    if (tab !== 'changer') return
    loadHistory()
  }, [tab])

  async function loadHistory() {
    const result = await window.api.skinHistoryList()
    if (result.ok && result.history) setHistory(result.history)
  }

  async function handleFile(file: File | null | undefined) {
    if (!file) return
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }
    setSelectedFile(file)
    setValidError(null)
    setServerError(null)
    setUploadState('validating')
    const newUrl = URL.createObjectURL(file)
    setPreviewUrl(newUrl)
    const err = await validateSkin(file)
    if (err) {
      setValidError(err)
      setUploadState('error')
    } else {
      setUploadState('ready')
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }, [])

  async function handleUpload() {
    if (!selectedFile || uploadState !== 'ready') return
    setUploadState('uploading')
    setServerError(null)
    try {
      const buf    = await selectedFile.arrayBuffer()
      const data   = Array.from(new Uint8Array(buf))
      const result = await window.api.skinUpload(data)
      if (result.ok) {
        setUploadState('success')
        const next = localRefreshKey + 1
        setLocalRefreshKey(next)
        onSkinUploaded?.()
        loadHistory()
      } else {
        setServerError(result.error ?? 'Erreur serveur inconnue.')
        setUploadState('error')
      }
    } catch {
      setServerError('Erreur réseau.')
      setUploadState('error')
    }
  }

  async function handleRestore(id: string | number) {
    if (restoring) return
    const sid = String(id)
    setRestoring(sid)
    const result = await window.api.skinHistoryRestore(sid)
    if (result.ok) {
      const next = localRefreshKey + 1
      setLocalRefreshKey(next)
      onSkinUploaded?.()
      await loadHistory()
    }
    setRestoring(null)
  }

  function handleReset() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }
    setSelectedFile(null)
    setValidError(null)
    setServerError(null)
    setUploadState('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="skinm__overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="skinm">

        {/* Header modal */}
        <div className="skinm__head">
          <div className="skinm__head-left">
            {headUrl
              ? <img src={headUrl} className="skinm__head-icon" alt="head" />
              : <div className="skinm__head-icon skinm__head-icon--fallback" />
            }
            <div>
              <div className="skinm__head-name">{username}</div>
              <div className="skinm__head-sub">Skin EarthKingdoms</div>
            </div>
          </div>
          <button className="skinm__close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="skinm__tabs">
          <button className={tab === 'apercu'  ? 'active' : ''} onClick={() => setTab('apercu')}>Aperçu</button>
          <button className={tab === 'changer' ? 'active' : ''} onClick={() => setTab('changer')}>Changer le skin</button>
        </div>

        {/* Onglet aperçu */}
        {tab === 'apercu' && (
          <div className="skinm__preview">
            <div className="skinm__skin-frame">
              {textureUrl
                ? <img src={textureUrl} alt="Skin texture" className="skinm__skin-texture" />
                : <div className="skinm__skin-texture skinm__skin-texture--loading" />
              }
              <span className="skinm__skin-label">Texture brute</span>
            </div>

            <div className="skinm__skin-info">
              <div className="skinm__info-row">
                <span className="skinm__info-key">Joueur</span>
                <span className="skinm__info-val">{username}</span>
              </div>
              <div className="skinm__info-row">
                <span className="skinm__info-key">Source</span>
                <span className="skinm__info-val skinm__info-url">{skinUrl}</span>
              </div>
              <div className="skinm__info-row">
                <span className="skinm__info-key">Modèle</span>
                <span className="skinm__info-val">Steve (classique)</span>
              </div>
              {textureUrl ? (
                <div className="skinm__3d-wrap">
                  <ReactSkinview3d
                    skinUrl={textureUrl}
                    width={135}
                    height={180}
                    onReady={({ viewer }) => {
                      viewer.autoRotate = true
                      viewer.autoRotateSpeed = 0.8
                    }}
                  />
                </div>
              ) : (
                <div className="skinm__3d-placeholder">
                  <div className="skinm__3d-icon">◈</div>
                  <span>Chargement du skin…</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Onglet changer */}
        {tab === 'changer' && (
          <div className="skinm__change">

            {/* Succès */}
            {uploadState === 'success' ? (
              <div className="skinm__upload-success">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <span className="skinm__upload-success-title">Skin appliqué !</span>
                <span className="skinm__upload-success-sub">Reconnecte-toi en jeu pour voir le changement.</span>
                <button className="btn-secondary" onClick={onClose}>Fermer</button>
              </div>
            ) : (
              <>
                {/* Input fichier caché */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,.png"
                  style={{ display: 'none' }}
                  onChange={e => handleFile(e.target.files?.[0])}
                />

                {/* Prévisualisation fichier sélectionné */}
                {selectedFile && previewUrl ? (
                  <div className="skinm__upload-preview">
                    <img
                      src={previewUrl}
                      alt="Prévisualisation"
                      className="skinm__skin-texture skinm__skin-texture--preview"
                    />
                    <div className="skinm__upload-preview-info">
                      <span className="skinm__upload-filename">{selectedFile.name}</span>
                      <span className="skinm__upload-filesize">{(selectedFile.size / 1024).toFixed(1)} Ko · PNG</span>
                      {(validError || serverError) && (
                        <span className="skinm__upload-error">
                          {validError ?? serverError}
                        </span>
                      )}
                      {uploadState === 'ready' && (
                        <span className="skinm__upload-ok">✓ Fichier valide — 64×64 px</span>
                      )}
                    </div>
                    <button className="skinm__upload-reset" onClick={handleReset} title="Changer de fichier">✕</button>
                  </div>
                ) : (
                  /* Zone de dépôt */
                  <div
                    className={`skinm__upload-zone skinm__upload-zone--active ${dragOver ? 'skinm__upload-zone--drag' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                  >
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <span>Glisser un fichier PNG ici</span>
                    <span className="skinm__upload-sub">ou cliquer pour parcourir · 64×64 px · max 2 Mo</span>
                  </div>
                )}

                <button
                  className="btn-play"
                  disabled={uploadState !== 'ready'}
                  onClick={handleUpload}
                  style={{ maxWidth: '100%', height: 48, fontSize: 16, letterSpacing: 3 }}
                >
                  {uploadState === 'uploading' ? 'Envoi en cours…' : 'Appliquer le skin'}
                </button>

                {/* Historique des skins */}
                {history.length > 0 && (
                  <div className="skinm__hist">
                    <span className="skinm__hist-title">Mes skins</span>
                    <div className="skinm__hist-grid">
                      {history.map(item => (
                        <SkinThumb
                          key={String(item.id)}
                          skinUrl={item.skin_url}
                          isCurrent={item.is_current}
                          restoring={restoring === String(item.id)}
                          onClick={() => { if (!item.is_current) handleRestore(item.id) }}
                        />
                      ))}
                    </div>
                    <span className="skinm__hist-hint">Clique sur un skin précédent pour le restaurer</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
