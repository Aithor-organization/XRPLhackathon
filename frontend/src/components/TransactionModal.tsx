import React from 'react'

interface TransactionModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  transactionData: any
  type?: 'product' | 'rating' | 'payment' | 'escrow' | 'credential'
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  title,
  transactionData,
  type
}) => {
  if (!isOpen || !transactionData) return null

  const renderTransactionDetails = () => {
    // 상품 등록의 경우 NFT와 Credential 두 개의 트랜잭션이 있음
    if (type === 'product' && transactionData.nft && transactionData.credential) {
      return (
        <>
          <h3>NFT 트랜잭션</h3>
          {renderSingleTransaction(transactionData.nft, 'nft')}

          <h3 style={{ marginTop: '20px' }}>Credential 트랜잭션</h3>
          {renderSingleTransaction(transactionData.credential, 'credential')}
        </>
      )
    }

    // 단일 트랜잭션
    return renderSingleTransaction(transactionData, type)
  }

  const renderSingleTransaction = (data: any, txType?: string) => {
    const { result, hash } = data

    // 기본 트랜잭션 정보
    const baseInfo = (
      <>
        <div className="info-row">
          <span>트랜잭션 해시:</span>
          <span className="hash full-hash">
            {hash || result?.hash || 'N/A'}
          </span>
        </div>

        <div className="info-row">
          <span>트랜잭션 타입:</span>
          <span className="hash">
            {result?.TransactionType || 'N/A'}
          </span>
        </div>

        <div className="info-row">
          <span>결과:</span>
          <span className="success-text">
            {result?.meta?.TransactionResult || result?.result?.meta?.TransactionResult || 'SUCCESS'}
          </span>
        </div>

        {result?.Account && (
          <div className="info-row">
            <span>계정 주소:</span>
            <span className="hash full-hash">
              {result.Account}
            </span>
          </div>
        )}

        {result?.Sequence && (
          <div className="info-row">
            <span>시퀀스:</span>
            <span className="hash">
              {result.Sequence}
            </span>
          </div>
        )}

        {result?.Fee && (
          <div className="info-row">
            <span>수수료:</span>
            <span className="hash">
              {parseInt(result.Fee) / 1000000} XRP
            </span>
          </div>
        )}

        {result?.ledger_index && (
          <div className="info-row">
            <span>레저 인덱스:</span>
            <span className="hash">
              {result.ledger_index}
            </span>
          </div>
        )}

        {result?.date && (
          <div className="info-row">
            <span>타임스탬프:</span>
            <span className="hash">
              {new Date((result.date + 946684800) * 1000).toLocaleString()}
            </span>
          </div>
        )}
      </>
    )

    // 타입별 추가 정보
    const actualType = txType || type
    switch (actualType) {
      case 'nft':
      case 'product':
        return (
          <>
            {baseInfo}
            {result?.NFTokenID && (
              <div className="info-row">
                <span>NFT Token ID:</span>
                <span className="hash full-hash">
                  {result.NFTokenID}
                </span>
              </div>
            )}
            {result?.URI && (
              <div className="info-row">
                <span>메타데이터 URI (Hex):</span>
                <span className="hash full-hash">
                  {result.URI}
                </span>
              </div>
            )}
            {result?.meta?.nftoken_id && (
              <div className="info-row">
                <span>생성된 NFT ID:</span>
                <span className="hash full-hash">
                  {result.meta.nftoken_id}
                </span>
              </div>
            )}
          </>
        )

      case 'credential':
        return (
          <>
            {baseInfo}
            {result?.Subject && (
              <div className="info-row">
                <span>Subject 주소:</span>
                <span className="hash full-hash">
                  {result.Subject}
                </span>
              </div>
            )}
            {result?.CredentialType && (
              <div className="info-row">
                <span>Credential 타입 (Hex):</span>
                <span className="hash full-hash">
                  {result.CredentialType}
                </span>
              </div>
            )}
            {result?.Expiration && (
              <div className="info-row">
                <span>만료 시간:</span>
                <span className="hash">
                  {new Date((result.Expiration + 946684800) * 1000).toLocaleString()}
                </span>
              </div>
            )}
            {result?.meta?.credential_id && (
              <div className="info-row">
                <span>Credential ID:</span>
                <span className="hash full-hash">
                  {result.meta.credential_id}
                </span>
              </div>
            )}
          </>
        )

      case 'rating':
        return (
          <>
            {baseInfo}
            {result?.MPTokenIssuanceID && (
              <div className="info-row">
                <span>MPToken Issuance ID:</span>
                <span className="hash full-hash">
                  {result.MPTokenIssuanceID}
                </span>
              </div>
            )}
            {result?.MaximumAmount && (
              <div className="info-row">
                <span>평점 (MPToken 수량):</span>
                <span className="hash">
                  {result.MaximumAmount} / 5
                </span>
              </div>
            )}
            {result?.MPTokenMetadata && (
              <div className="info-row">
                <span>메타데이터 (Hex):</span>
                <span className="hash full-hash">
                  {result.MPTokenMetadata}
                </span>
              </div>
            )}
            {result?.meta?.mpt_issuance_id && (
              <div className="info-row">
                <span>생성된 MPToken ID:</span>
                <span className="hash full-hash">
                  {result.meta.mpt_issuance_id}
                </span>
              </div>
            )}
          </>
        )

      case 'payment':
        return (
          <>
            {baseInfo}
            {result?.Destination && (
              <div className="info-row">
                <span>수신자 주소:</span>
                <span className="hash full-hash">
                  {result.Destination}
                </span>
              </div>
            )}
            {result?.Amount && (
              <div className="info-row">
                <span>전송 금액:</span>
                <span className="hash">
                  {typeof result.Amount === 'string'
                    ? (parseInt(result.Amount) / 1000000) + ' XRP'
                    : result.Amount.value + ' ' + result.Amount.currency}
                </span>
              </div>
            )}
            {result?.DestinationTag && (
              <div className="info-row">
                <span>Destination Tag:</span>
                <span className="hash">
                  {result.DestinationTag}
                </span>
              </div>
            )}
          </>
        )

      case 'escrow':
        return (
          <>
            {baseInfo}
            {result?.Destination && (
              <div className="info-row">
                <span>에스크로 수신자:</span>
                <span className="hash full-hash">
                  {result.Destination}
                </span>
              </div>
            )}
            {result?.Amount && (
              <div className="info-row">
                <span>에스크로 금액:</span>
                <span className="hash">
                  {typeof result.Amount === 'string'
                    ? (parseInt(result.Amount) / 1000000) + ' XRP'
                    : result.Amount.value + ' ' + result.Amount.currency}
                </span>
              </div>
            )}
            {result?.FinishAfter && (
              <div className="info-row">
                <span>완료 가능 시간:</span>
                <span className="hash">
                  {new Date((result.FinishAfter + 946684800) * 1000).toLocaleString()}
                </span>
              </div>
            )}
            {result?.CancelAfter && (
              <div className="info-row">
                <span>취소 가능 시간:</span>
                <span className="hash">
                  {new Date((result.CancelAfter + 946684800) * 1000).toLocaleString()}
                </span>
              </div>
            )}
            {result?.meta?.escrow_sequence && (
              <div className="info-row">
                <span>에스크로 시퀀스:</span>
                <span className="hash">
                  {result.meta.escrow_sequence}
                </span>
              </div>
            )}
          </>
        )

      default:
        return baseInfo
    }
  }

  const getIconByType = () => {
    switch (type) {
      case 'product': return '🛍️'
      case 'rating': return '⭐'
      case 'payment': return '💸'
      case 'escrow': return '🔐'
      case 'credential': return '🆔'
      default: return '📄'
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content transaction-result-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{getIconByType()} {title}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="transaction-details">
          <div className="transaction-info">
            {renderTransactionDetails()}
          </div>

          {/* 원본 JSON 데이터 (개발자용) */}
          <details className="json-details">
            <summary>🔍 전체 트랜잭션 데이터 (JSON)</summary>
            <pre className="json-content">
              {JSON.stringify(transactionData, null, 2)}
            </pre>
          </details>
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  )
}