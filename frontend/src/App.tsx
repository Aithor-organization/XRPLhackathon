import React, { useState, useEffect } from 'react'
import { Client, Wallet } from 'xrpl'
import { Product, WalletInfo, Purchase } from './types'
import { ProductModal } from './components/ProductModal'
import { ProductList } from './components/ProductList'
import { PurchaseModal } from './components/PurchaseModal'
import { RatingModal } from './components/RatingModal'
import { TransactionModal } from './components/TransactionModal'
import {
  createProductNFT,
  createPlatformCredential,
  checkPlatformCredential,
  createEscrowPayment,
  finishEscrow,
  createRatingToken,
  getPlatformAccountInfo
} from './utils/xrpl'
import { CredentialType } from './config/platform'
import './App.css'

function App() {
  const [seed, setSeed] = useState('')
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // 상품 관련 상태
  const [products, setProducts] = useState<Product[]>([])
  const [showProductModal, setShowProductModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showPurchaseModal, setShowPurchaseModal] = useState(false)
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [transactionResult, setTransactionResult] = useState<any>(null)

  // 트랜잭션 모달 상태
  const [showTransactionModal, setShowTransactionModal] = useState(false)
  const [transactionData, setTransactionData] = useState<any>(null)
  const [transactionTitle, setTransactionTitle] = useState('')
  const [transactionType, setTransactionType] = useState<'product' | 'rating' | 'payment' | 'escrow' | 'credential'>('payment')

  // 플랫폼 계정 정보 확인 (커포넌트 마운트 시)
  useEffect(() => {
    getPlatformAccountInfo().then(info => {
      console.log('플랫폼 계정:', info)
      if (!info.isActive) {
        console.warn('플랫폼 계정이 활성화되지 않음. 테스트넷에서 XRP를 받아야 함.')
      }
    }).catch(err => {
      console.error('플랫폼 계정 확인 오류:', err)
    })
  }, [])

  // localStorage에서 상품 목록 불러오기
  useEffect(() => {
    const storedProducts = localStorage.getItem('products')
    if (storedProducts) {
      setProducts(JSON.parse(storedProducts))
    }
  }, [])

  const clearMessages = () => {
    setError('')
    setSuccessMsg('')
  }

  const connectWallet = async () => {
    if (!seed.trim()) {
      setError('시드를 입력해주세요')
      return
    }

    setLoading(true)
    clearMessages()

    const client = new Client("wss://s.devnet.rippletest.net:51233")

    try {
      await client.connect()
      const walletFromSeed = Wallet.fromSeed(seed.trim())

      const accountInfo = await client.request({
        command: 'account_info',
        account: walletFromSeed.address
      })

      const balance = (Number(accountInfo.result.account_data.Balance) / 1000000).toString()

      setWallet({
        address: walletFromSeed.address,
        seed: walletFromSeed.seed!,
        balance: balance
      })

      setSuccessMsg('지갑이 성공적으로 연결되었습니다!')

    } catch (err: any) {
      console.error('지갑 연결 오류:', err)
      if (err.data?.error === 'actNotFound') {
        setError('계정을 찾을 수 없습니다. 올바른 시드인지 확인하고 계정이 활성화되어 있는지 확인해주세요.')
      } else {
        setError(`지갑 연결 실패: ${err.message || '알 수 없는 오류'}`)
      }
    } finally {
      await client.disconnect()
      setLoading(false)
    }
  }

  const disconnectWallet = () => {
    setWallet(null)
    setSeed('')
    clearMessages()
  }

  // 상품 등록
  const handleProductSubmit = async (productData: Omit<Product, 'id' | 'created' | 'seller'>) => {
    if (!wallet) return

    setLoading(true)
    clearMessages()

    try {
      const walletObj = Wallet.fromSeed(wallet.seed)

      // 1. NFT 생성
      const nftResult = await createProductNFT(walletObj, productData)

      // 상품 정보를 먼저 생성
      const newProduct: Product = {
        id: `product_${Date.now()}`,
        ...productData,
        seller: wallet.address,
        nftTokenId: nftResult.nftTokenId,
        created: Date.now(),
        ratings: []
      }

      // 2. 플랫폼에서 판매자 Credential 발급
      const credentialResult = await createPlatformCredential(
        wallet.address,
        CredentialType.SELLER_VERIFIED,
        { productId: newProduct.id }
      )

      // Credential ID 추가
      newProduct.credentialId = credentialResult.credentialId

      const updatedProducts = [...products, newProduct]
      setProducts(updatedProducts)
      localStorage.setItem('products', JSON.stringify(updatedProducts))

      setShowProductModal(false)

      // 트랜잭션 결과 모달 표시
      const combinedResult = {
        nft: nftResult.transactionResult,
        credential: credentialResult.transactionResult
      }

      setTransactionData(combinedResult)
      setTransactionTitle('상품 등록 완료')
      setTransactionType('product')
      setShowTransactionModal(true)

      setSuccessMsg('상품이 성공적으로 등록되었습니다!')

    } catch (err: any) {
      console.error('상품 등록 오류:', err)
      setError(`상품 등록 실패: ${err.message || '알 수 없는 오류'}`)
    } finally {
      setLoading(false)
    }
  }

  // 상품 클릭 처리
  const handleProductClick = (product: Product) => {
    if (!wallet) {
      setError('먼저 지갑을 연결해주세요')
      return
    }

    if (product.seller === wallet.address) {
      // 자신의 상품인 경우
      setSuccessMsg('자신이 등록한 상품입니다')
      return
    }

    // 이미 구매했는지 확인
    const purchases = JSON.parse(localStorage.getItem('purchases') || '[]')
    const hasPurchased = purchases.some((p: Purchase) =>
      p.productId === product.id &&
      p.buyer === wallet.address &&
      p.status === 'completed'
    )

    setSelectedProduct(product)
    setTransactionResult(null)

    if (hasPurchased) {
      // 이미 평점을 줬는지 확인
      const hasRated = product.ratings?.some(r => r.buyer === wallet.address)
      if (hasRated) {
        // 평점도 이미 준 경우 - 구매 모달을 다운로드 모드로 표시
        setShowPurchaseModal(true)
      } else {
        // 구매했지만 평점은 아직 안 준 경우
        setShowRatingModal(true)
      }
    } else {
      // 아직 구매하지 않은 경우
      setShowPurchaseModal(true)
    }
  }

  // 상품 구매 처리
  const handlePurchase = async (product: Product) => {
    if (!wallet) return

    setLoading(true)
    clearMessages()

    try {
      const walletObj = Wallet.fromSeed(wallet.seed)

      // 1. 플랫폼 Credential 확인
      const hasCredential = await checkPlatformCredential(wallet.address, CredentialType.BUYER_VERIFIED)

      let result: any

      if (!hasCredential) {
        // 플랫폼에서 구매자 Credential 발급
        await createPlatformCredential(
          wallet.address,
          CredentialType.BUYER_VERIFIED,
          { firstPurchase: true }
        )
      }

      // 에스크로 결제 생성
      const escrowResult = await createEscrowPayment(
        walletObj,
        product.seller,
        product.price
      )

      // 플랫폼에서 구매 권한 Credential 발급
      const purchaseCredential = await createPlatformCredential(
        wallet.address,
        CredentialType.PURCHASE_AUTHORIZED,
        {
          productId: product.id,
          escrowSequence: escrowResult.sequence,
          seller: product.seller,
          price: product.price
        }
      )

      // 에스크로 자동 완료 (시간 경과 후)
      setTimeout(async () => {
        try {
          const result = await finishEscrow(
            walletObj,
            wallet.address,
            escrowResult.sequence
          )
          console.log('에스크로 자동 완료:', result)
        } catch (err) {
          console.log('에스크로 아직 완료 불가 - 대기 필요')
        }
      }, 65000) // 65초 후 시도 (FinishAfter 5분 대기)

      result = escrowResult

      // 구매 내역 저장
      const purchase: Purchase = {
        productId: product.id,
        buyer: wallet.address,
        seller: product.seller,
        status: 'completed',
        transactionHash: result.transactionHash || result.hash,
        timestamp: Date.now()
      }

      const purchases = JSON.parse(localStorage.getItem('purchases') || '[]')
      purchases.push(purchase)
      localStorage.setItem('purchases', JSON.stringify(purchases))

      setTransactionResult(result)

      // 잔액 업데이트
      const client = new Client("wss://s.devnet.rippletest.net:51233")
      await client.connect()
      const accountInfo = await client.request({
        command: 'account_info',
        account: wallet.address
      })
      const newBalance = (Number(accountInfo.result.account_data.Balance) / 1000000).toString()
      setWallet(prev => prev ? { ...prev, balance: newBalance } : null)
      await client.disconnect()

    } catch (err: any) {
      console.error('구매 처리 오류:', err)
      setError(`구매 실패: ${err.message || '알 수 없는 오류'}`)
    } finally {
      setLoading(false)
    }
  }

  // 평점 제출
  const handleRatingSubmit = async (productId: string, score: number) => {
    if (!wallet) return

    // 이미 평점을 줬는지 확인
    const product = products.find(p => p.id === productId)
    if (product?.ratings?.some(r => r.buyer === wallet.address)) {
      setError('이미 이 상품에 평점을 주셨습니다.')
      return
    }

    setLoading(true)
    clearMessages()

    try {
      const walletObj = Wallet.fromSeed(wallet.seed)

      // MPToken으로 평점 기록
      const ratingResult = await createRatingToken(walletObj, productId, score)

      // 상품 평점 업데이트
      const updatedProducts = products.map(p => {
        if (p.id === productId) {
          const newRating = {
            buyer: wallet.address,
            score,
            mpTokenId: ratingResult.mpTokenId,
            timestamp: Date.now()
          }
          return {
            ...p,
            ratings: [...(p.ratings || []), newRating]
          }
        }
        return p
      })

      setProducts(updatedProducts)
      localStorage.setItem('products', JSON.stringify(updatedProducts))

      setShowRatingModal(false)

      // 트랜잭션 결과 모달 표시
      setTransactionData(ratingResult.transactionResult)
      setTransactionTitle(`평점 등록 완료 (${score}점)`)
      setTransactionType('rating')
      setShowTransactionModal(true)

      setSuccessMsg('평점이 성공적으로 등록되었습니다!')

    } catch (err: any) {
      console.error('평점 등록 오류:', err)
      setError(`평점 등록 실패: ${err.message || '알 수 없는 오류'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <h1>XRPL 마켓플레이스</h1>

      {error && <div className="error">{error}</div>}
      {successMsg && <div className="success-msg">{successMsg}</div>}

      {!wallet ? (
        <div className="card">
          <h2>지갑 연결</h2>
          <div className="form-group">
            <label htmlFor="seed">시드 입력:</label>
            <input
              id="seed"
              type="text"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="예: sEdT9YnkPYjR5y7jxjJ4U5Rc6VjJH5F"
              disabled={loading}
            />
          </div>
          <button onClick={connectWallet} disabled={loading || !seed.trim()}>
            {loading ? '연결 중...' : '지갑 연결'}
          </button>
        </div>
      ) : (
        <>
          <div className="card">
            <h2>지갑 정보</h2>
            <div className="wallet-info">
              <div><strong>주소:</strong> {wallet.address}</div>
              <div><strong>잔액:</strong> {wallet.balance} XRP</div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowProductModal(true)}>
                상품 등록
              </button>
              <button className="danger" onClick={disconnectWallet}>
                지갑 연결 해제
              </button>
            </div>
          </div>

          <div className="card">
            <h2>상품 목록</h2>
            <ProductList
              products={products}
              currentWallet={wallet.address}
              onProductClick={handleProductClick}
              onRateProduct={(product) => {
                setSelectedProduct(product)
                setShowRatingModal(true)
              }}
            />
          </div>
        </>
      )}

      <ProductModal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
        onSubmit={handleProductSubmit}
        loading={loading}
      />

      <PurchaseModal
        product={selectedProduct}
        isOpen={showPurchaseModal}
        onClose={() => {
          setShowPurchaseModal(false)
          setTransactionResult(null)
        }}
        onPurchase={handlePurchase}
        loading={loading}
        transactionResult={transactionResult}
        currentWallet={wallet?.address}
      />

      <RatingModal
        product={selectedProduct}
        isOpen={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        onSubmitRating={handleRatingSubmit}
        loading={loading}
      />

      <TransactionModal
        isOpen={showTransactionModal}
        onClose={() => setShowTransactionModal(false)}
        title={transactionTitle}
        transactionData={transactionData}
        type={transactionType}
      />
    </div>
  )
}

export default App