import React, { useState } from 'react'
import { Product } from '../types'

interface RatingModalProps {
  product: Product | null
  isOpen: boolean
  onClose: () => void
  onSubmitRating: (productId: string, score: number) => void
  loading?: boolean
}

export const RatingModal: React.FC<RatingModalProps> = ({
  product,
  isOpen,
  onClose,
  onSubmitRating,
  loading
}) => {
  const [selectedRating, setSelectedRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)

  if (!isOpen || !product) return null

  const handleSubmit = () => {
    if (selectedRating === 0) {
      alert('평점을 선택해주세요')
      return
    }
    onSubmitRating(product.id, selectedRating)
    setSelectedRating(0) // 초기화
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content rating-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>상품 평가</h2>
          <button className="close-btn" onClick={onClose} disabled={loading}>×</button>
        </div>

        <div className="rating-content">
          <h3>{product.name}</h3>
          <p className="rating-desc">구매하신 상품의 평점을 남겨주세요</p>

          <div className="star-rating">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                className={`star ${star <= (hoverRating || selectedRating) ? 'filled' : ''}`}
                onClick={() => setSelectedRating(star)}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                disabled={loading}
              >
                ★
              </button>
            ))}
          </div>

          <div className="rating-text">
            {selectedRating === 0 ? '평점을 선택하세요' :
              selectedRating === 1 ? '매우 불만족' :
              selectedRating === 2 ? '불만족' :
              selectedRating === 3 ? '보통' :
              selectedRating === 4 ? '만족' :
              '매우 만족'}
          </div>

          <div className="info-box">
            <p>📝 평점 시스템</p>
            <ul>
              <li>MPToken을 사용하여 평점이 기록됩니다</li>
              <li>선택한 점수만큼 MPToken이 발행됩니다 (1-5개)</li>
              <li>평점은 블록체인에 영구 기록됩니다</li>
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            취소
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={loading || selectedRating === 0}
          >
            {loading ? '처리 중...' : '평점 제출'}
          </button>
        </div>
      </div>
    </div>
  )
}