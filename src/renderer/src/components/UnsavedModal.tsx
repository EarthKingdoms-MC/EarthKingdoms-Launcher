import './UnsavedModal.css'

// Confirmation avant de perdre des réglages non sauvegardés.
//
// Trois issues explicites plutôt que deux : « Annuler » ramène simplement le
// joueur à ce qu'il faisait, ce qui est le choix le plus sûr quand la fenêtre
// apparaît par surprise. C'est aussi celui déclenché par Échap.

interface Props {
  /** Ce que le joueur allait faire, formulé pour la question. */
  action:   string
  saving:   boolean
  onSave:   () => void
  onDiscard: () => void
  onCancel: () => void
}

export default function UnsavedModal({ action, saving, onSave, onDiscard, onCancel }: Props) {
  return (
    <div
      className="unsaved__overlay"
      onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
      tabIndex={-1}
      ref={el => el?.focus()}
    >
      <div className="unsaved">
        <div className="unsaved__head">
          <span className="unsaved__label">Modifications non sauvegardées</span>
          <h2 className="unsaved__title">Sauvegarder avant de continuer&nbsp;?</h2>
        </div>

        <p className="unsaved__body">
          Tu as modifié des réglages sans les sauvegarder. {action}
        </p>

        <div className="unsaved__actions">
          <button className="btn-secondary" onClick={onCancel} disabled={saving} data-sound="close">
            Annuler
          </button>
          <button className="btn-secondary unsaved__discard" onClick={onDiscard} disabled={saving}>
            Ne pas sauvegarder
          </button>
          <button className="btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  )
}
