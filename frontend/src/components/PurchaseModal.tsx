import React, { useState } from 'react'
import { Product } from '../types'

interface PurchaseModalProps {
  product: Product | null
  isOpen: boolean
  onClose: () => void
  onPurchase: (product: Product) => void
  loading?: boolean
  transactionResult?: any
  currentWallet?: string | null
}

export const PurchaseModal: React.FC<PurchaseModalProps> = ({
  product,
  isOpen,
  onClose,
  onPurchase,
  loading,
  transactionResult,
  currentWallet
}) => {
  const [showConfirm, setShowConfirm] = useState(true)

  if (!isOpen || !product) return null

  // 이미 구매했는지 확인
  const purchases = JSON.parse(localStorage.getItem('purchases') || '[]')
  const hasPurchased = purchases.some((p: any) =>
    p.productId === product.id &&
    p.buyer === currentWallet &&
    p.status === 'completed'
  )

  // 평점을 이미 줬는지 확인
  const hasRated = product.ratings?.some(r => r.buyer === currentWallet)

  // 구매했고 평점도 준 경우 - 다운로드만 가능
  const isDownloadOnly = hasPurchased && hasRated

  const handlePurchase = () => {
    setShowConfirm(false)
    onPurchase(product)
  }

  const getIpfsGatewayUrl = (hash: string) => {
    return `https://ipfs.io/ipfs/${hash}`
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content purchase-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isDownloadOnly ? '상품 다운로드' : (showConfirm ? '상품 구매 확인' : '구매 처리중')}</h2>
          {!loading && <button className="close-btn" onClick={onClose}>×</button>}
        </div>

        {isDownloadOnly ? (
          // 이미 구매하고 평점도 준 경우 - 다운로드만 제공
          <div className="download-only-state">
            <div className="purchase-details">
              <h3>{product.name}</h3>
              <p className="description">{product.description}</p>

              <div className="info-box success-info">
                <p>✅ 구매 완료 상품</p>
                <p>⭐ 평점 등록 완료</p>
              </div>

              <div className="detail-row">
                <span>가격:</span>
                <span className="address">
                  {product.price} XRP
                </span>
              </div>

              <div className="detail-row">
                <span>판매자 주소:</span>
                <span className="address full-address">
                  {product.seller}
                </span>
              </div>

            </div>

            <div className="ipfs-section">
              <h4>📥 IPFS 파일 다운로드</h4>
              <a
                href={getIpfsGatewayUrl(product.ipfsHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="download-link"
              >
                파일 다운로드
              </a>
              <p className="download-info">
                이미 구매하신 상품입니다. 언제든지 다시 다운로드하실 수 있습니다.
              </p>
            </div>

            <div className="modal-footer">
              <button className="btn-primary" onClick={onClose}>
                확인
              </button>
            </div>
          </div>
        ) : showConfirm && !transactionResult ? (
          <>
            <div className="purchase-details">
              <h3>{product.name}</h3>
              <p className="description">{product.description}</p>

              <div className="detail-row">
                <span>가격:</span>
                <strong>{product.price} XRP</strong>
              </div>

              <div className="detail-row">
                <span>판매자 주소:</span>
                <span className="address full-address">
                  {product.seller}
                </span>
              </div>

              {product.nftTokenId && (
                <div className="detail-row">
                  <span>NFT Token ID:</span>
                  <span className="address full-address">
                    {product.nftTokenId}
                  </span>
                </div>
              )}

              {product.credentialId && (
                <div className="detail-row">
                  <span>Credential ID:</span>
                  <span className="address full-address">
                    {product.credentialId}
                  </span>
                </div>
              )}


              <div className="info-box">
                <p>⚠️ 구매 프로세스</p>
                <ol>
                  <li>Credential 확인 후 결제 진행</li>
                  <li>Credential이 없으면 에스크로 결제로 진행</li>
                  <li>결제 완료 후 IPFS 파일 다운로드 가능</li>
                </ol>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={onClose}>
                취소
              </button>
              <button
                className="btn-primary"
                onClick={handlePurchase}
                disabled={loading}
              >
                구매하기
              </button>
            </div>
          </>
        ) : loading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>결제 처리 중입니다...</p>
            <p className="sub-text">Credential 확인 및 에스크로 설정 중</p>
          </div>
        ) : transactionResult ? (
          <div className="success-state">
            <div className="success-icon">✅</div>
            <h3>구매 완료!</h3>

            <div className="transaction-info">
              <div className="info-row">
                <span>트랜잭션 해시:</span>
                <span className="hash full-hash">
                  {transactionResult.hash}
                </span>
              </div>

              <div className="info-row">
                <span>결과:</span>
                <span className="success-text">
                  {transactionResult.result?.meta?.TransactionResult || transactionResult.meta?.TransactionResult || 'SUCCESS'}
                </span>
              </div>

              {transactionResult.result?.Account && (
                <div className="info-row">
                  <span>구매자 주소:</span>
                  <span className="hash full-hash">
                    {transactionResult.result.Account}
                  </span>
                </div>
              )}

              {transactionResult.result?.Destination && (
                <div className="info-row">
                  <span>판매자 주소:</span>
                  <span className="hash full-hash">
                    {transactionResult.result.Destination}
                  </span>
                </div>
              )}

              {transactionResult.result?.Amount && (
                <div className="info-row">
                  <span>결제 금액:</span>
                  <span className="hash">
                    {typeof transactionResult.result.Amount === 'string'
                      ? (parseInt(transactionResult.result.Amount) / 1000000) + ' XRP'
                      : transactionResult.result.Amount.value + ' ' + transactionResult.result.Amount.currency}
                  </span>
                </div>
              )}

              {transactionResult.result?.Fee && (
                <div className="info-row">
                  <span>수수료:</span>
                  <span className="hash">
                    {parseInt(transactionResult.result.Fee) / 1000000} XRP
                  </span>
                </div>
              )}

              {transactionResult.result?.Sequence && (
                <div className="info-row">
                  <span>시퀀스:</span>
                  <span className="hash">
                    {transactionResult.result.Sequence}
                  </span>
                </div>
              )}
            </div>

            <div className="ipfs-section">
              <h4>IPFS 파일 다운로드</h4>
              <a
                href={getIpfsGatewayUrl(product.ipfsHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="download-link"
              >
                📥 파일 다운로드 (IPFS)
              </a>
              <p className="ipfs-hash full-hash">IPFS Hash: {product.ipfsHash}</p>
            </div>

            <div className="modal-footer">
              <button className="btn-primary" onClick={onClose}>
                확인
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}