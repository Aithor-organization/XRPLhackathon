import React, { useState } from 'react'
import { Product } from '../types'

interface ProductModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (product: Omit<Product, 'id' | 'created' | 'seller'>) => void
  loading?: boolean
}

export const ProductModal: React.FC<ProductModalProps> = ({ isOpen, onClose, onSubmit, loading = false }) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    ipfsHash: '',
    price: ''
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name || !formData.description || !formData.ipfsHash || !formData.price) {
      alert('모든 필드를 입력해주세요')
      return
    }

    const price = parseFloat(formData.price)
    if (isNaN(price) || price <= 0) {
      alert('올바른 가격을 입력해주세요')
      return
    }

    onSubmit({
      name: formData.name,
      description: formData.description,
      ipfsHash: formData.ipfsHash,
      price: formData.price
    })

    // 폼 초기화
    setFormData({
      name: '',
      description: '',
      ipfsHash: '',
      price: ''
    })
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={loading ? undefined : onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>상품 등록</h2>
          <button className="close-btn" onClick={onClose} disabled={loading}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '20px', color: '#007bff' }}>
              <div>NFT와 DID Credential을 생성하는 중입니다...</div>
              <div style={{ marginTop: '10px' }}>잠시만 기다려주세요.</div>
            </div>
          )}
          <div className="form-group">
            <label htmlFor="name">상품명</label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="상품명을 입력하세요"
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">상품 설명</label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="상품에 대한 설명을 입력하세요"
              rows={4}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="ipfsHash">IPFS 해시값</label>
            <input
              id="ipfsHash"
              type="text"
              value={formData.ipfsHash}
              onChange={(e) => setFormData(prev => ({ ...prev, ipfsHash: e.target.value }))}
              placeholder="QmXxx... (IPFS 해시)"
              required
              disabled={loading}
            />
            <small>IPFS에 업로드된 파일의 해시값을 입력하세요</small>
          </div>

          <div className="form-group">
            <label htmlFor="price">가격 (XRP)</label>
            <input
              id="price"
              type="number"
              step="0.000001"
              min="0"
              value={formData.price}
              onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
              placeholder="10.0"
              required
              disabled={loading}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              취소
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? '등록 중...' : '상품 등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}