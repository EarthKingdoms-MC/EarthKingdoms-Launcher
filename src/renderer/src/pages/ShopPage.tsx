import './ShopPage.css'
import { ShoppingBag } from "lucide-react";

export default function ShopPage() {
    return (
        <div className="shop">
            <div className="shop__overlay">
                <div className="shop__icon">
                    <ShoppingBag size={60} strokeWidth={2} />
                </div>
                <div className="shop__badge">BIENTÔT</div>
                <h1 className="shop__title">BOUTIQUE</h1>
                <p className="shop__sub">Cette fonctionnalité est en cours de développement.</p>
                <p className="shop__hint">Cosmétiques, titres, badges et effets visuels arrivent prochainement.</p>
            </div>
        </div>
    )
}
