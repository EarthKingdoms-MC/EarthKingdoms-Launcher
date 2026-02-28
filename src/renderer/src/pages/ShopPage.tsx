import './ShopPage.css'

export default function ShopPage() {
  return (
    <div className="shop">
      <div className="shop__overlay">
        <div className="shop__icon">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <path d="M16 10a4 4 0 0 1-8 0"/>
          </svg>
        </div>
        <div className="shop__badge">BIENTÔT</div>
        <h1 className="shop__title">BOUTIQUE</h1>
        <p className="shop__sub">Cette fonctionnalité est en cours de développement.</p>
        <p className="shop__hint">Cosmétiques, titres, badges et effets visuels arrivent prochainement.</p>
      </div>
    </div>
  )
}
