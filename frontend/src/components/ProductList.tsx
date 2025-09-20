import React from 'react'
import { Product } from '../types'

interface ProductListProps {
  products: Product[]
  currentWallet: string | null
  onProductClick: (product: Product) => void
  onRateProduct?: (product: Product) => void
}

export const ProductList: React.FC<ProductListProps> = ({
  products,
  currentWallet,
  onProductClick,
  onRateProduct
}) => {
  const getPurchaseStatus = (product: Product): 'owned' | 'purchased' | null => {
    if (!currentWallet) return null

    // 판매자인 경우
    if (product.seller === currentWallet) return 'owned'

    // 구매 내역 확인 (localStorage에서)
    const purchases = JSON.parse(localStorage.getItem('purchases') || '[]')
    const hasPurchased = purchases.some((p: any) =>
      p.productId === product.id &&
      p.buyer === currentWallet &&
      p.status === 'completed'
    )

    return hasPurchased ? 'purchased' : null
  }

  const hasAlreadyRated = (product: Product): boolean => {
    if (!currentWallet) return false
    return product.ratings?.some(r => r.buyer === currentWallet) || false
  }

  const calculateAverageRating = (ratings?: any[]) => {
    if (!ratings || ratings.length === 0) return null
    const sum = ratings.reduce((acc, r) => acc + r.score, 0)
    return (sum / ratings.length).toFixed(1)
  }

  if (products.length === 0) {
    return (
      <div className="empty-state">
        <p>등록된 상품이 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="product-grid">
      {products.map(product => {
        const status = getPurchaseStatus(product)
        const avgRating = calculateAverageRating(product.ratings)

        return (
          <div
            key={product.id}
            className={`product-card ${status === 'owned' ? 'owned' : ''}`}
            onClick={() => onProductClick(product)}
          >
            <div className="product-header">
              <h3>{product.name}</h3>
              {status === 'owned' && <span className="badge">내 상품</span>}
              {status === 'purchased' && <span className="badge purchased">구매완료</span>}
            </div>

            <p className="product-description">{product.description}</p>

            <div className="product-meta">
              <div className="product-price">{product.price} XRP</div>

              {avgRating && (
                <div className="product-rating">
                  ⭐ {avgRating} ({product.ratings?.length || 0})
                </div>
              )}
            </div>

            <div className="product-seller">
              판매자: {product.seller.slice(0, 6)}...{product.seller.slice(-4)}
            </div>

            {status === 'purchased' && onRateProduct && (
              hasAlreadyRated(product) ? (
                <div className="already-rated">
                  ⭐ 평점 등록 완료
                </div>
              ) : (
                <button
                  className="rate-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRateProduct(product)
                  }}
                >
                  평점 주기
                </button>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}