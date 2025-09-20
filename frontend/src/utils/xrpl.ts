import { Client, Wallet, Payment, Transaction, NFTokenMint } from 'xrpl'
import { Product, CredentialInfo } from '../types'

const XRPL_SERVER = "wss://s.devnet.rippletest.net:51233"

// 브라우저 환경에서 동작하는 hex 변환 함수
const toHex = (s: string) => {
  let hex = ''
  for (let i = 0; i < s.length; i++) {
    const hexChar = s.charCodeAt(i).toString(16)
    hex += hexChar.length === 1 ? '0' + hexChar : hexChar
  }
  return hex.toUpperCase()
}

const fromHex = (h: string) => {
  let str = ''
  for (let i = 0; i < h.length; i += 2) {
    str += String.fromCharCode(parseInt(h.substr(i, 2), 16))
  }
  return str
}

const now = () => Math.floor(Date.now() / 1000) - 946_684_800 // XRPL epoch

// NFT 생성 (상품 등록 시)
export async function createProductNFT(
  wallet: Wallet,
  product: Omit<Product, 'id' | 'created' | 'seller'>
): Promise<{ nftTokenId: string; transactionResult: any }> {
  const client = new Client(XRPL_SERVER)
  await client.connect()

  try {
    const metadata = {
      name: product.name,
      description: product.description,
      ipfsHash: product.ipfsHash,
      price: product.price
    }

    const tx: NFTokenMint = {
      TransactionType: 'NFTokenMint',
      Account: wallet.address,
      URI: toHex(JSON.stringify(metadata)),
      NFTokenTaxon: 0,
      Flags: {
        tfTransferable: true,
        tfOnlyXRP: true
      }
    }

    const prepared = await client.autofill(tx)
    const signed = wallet.sign(prepared)
    const result = await client.submitAndWait(signed.tx_blob)

    // NFT ID 추출
    const meta = result.result.meta as any
    const nftokenId = meta?.nftoken_id || ''

    return {
      nftTokenId: nftokenId,
      transactionResult: result
    }
  } finally {
    await client.disconnect()
  }
}

// DID Credential 생성
export async function createCredential(
  issuerWallet: Wallet,
  subjectAddress: string,
  credentialType: string
): Promise<{ credentialId: string; transactionResult: any }> {
  const client = new Client(XRPL_SERVER)
  await client.connect()

  try {
    const tx: any = {
      TransactionType: "CredentialCreate",
      Account: issuerWallet.address,
      Subject: subjectAddress,
      CredentialType: toHex(credentialType),
      Expiration: now() + 86400, // 24시간 후 만료
      URI: toHex(`https://example.com/credentials/${credentialType}`)
    }

    const prepared = await client.autofill(tx)
    const signed = issuerWallet.sign(prepared)
    const result = await client.submitAndWait(signed.tx_blob)

    // Credential ID 추출
    const meta = result.result.meta as any
    const credentialId = meta?.credential_id || prepared.Sequence?.toString() || ''

    return {
      credentialId: credentialId,
      transactionResult: result
    }
  } finally {
    await client.disconnect()
  }
}

// Credential 확인
export async function checkCredential(
  address: string,
  credentialType: string
): Promise<boolean> {
  const client = new Client(XRPL_SERVER)
  await client.connect()

  try {
    // 계정의 Credential 조회
    const response = await client.request({
      command: 'account_objects',
      account: address,
      type: 'credential'
    } as any)

    const credentials = response.result.account_objects || []

    // 특정 타입의 유효한 Credential이 있는지 확인
    const hasValidCredential = credentials.some((cred: any) => {
      if (cred.CredentialType === toHex(credentialType)) {
        // 만료 시간 확인
        if (cred.Expiration) {
          return cred.Expiration > now()
        }
        return true
      }
      return false
    })

    return hasValidCredential
  } catch (error) {
    console.error('Credential 확인 오류:', error)
    return false
  } finally {
    await client.disconnect()
  }
}

// 에스크로 결제 생성
export async function createEscrowPayment(
  buyerWallet: Wallet,
  sellerAddress: string,
  amount: string
): Promise<{ sequence: number; transactionHash: string }> {
  const client = new Client(XRPL_SERVER)
  await client.connect()

  try {
    const tx: any = {
      TransactionType: "EscrowCreate",
      Account: buyerWallet.address,
      Destination: sellerAddress,
      Amount: (parseFloat(amount) * 1000000).toString(), // XRP to drops
      FinishAfter: now() + 300, // 5분 후 완료 가능
      CancelAfter: now() + 3600  // 1시간 후 취소 가능
    }

    const prepared = await client.autofill(tx)
    const signed = buyerWallet.sign(prepared)
    const result = await client.submitAndWait(signed.tx_blob)

    return {
      sequence: prepared.Sequence || 0,
      transactionHash: result.result.hash || ''
    }
  } finally {
    await client.disconnect()
  }
}

// 에스크로 완료
export async function finishEscrow(
  wallet: Wallet,
  escrowOwner: string,
  escrowSequence: number
): Promise<any> {
  const client = new Client(XRPL_SERVER)
  await client.connect()

  try {
    const tx: any = {
      TransactionType: "EscrowFinish",
      Account: wallet.address,
      Owner: escrowOwner,
      OfferSequence: escrowSequence
    }

    const prepared = await client.autofill(tx)
    const signed = wallet.sign(prepared)
    const result = await client.submitAndWait(signed.tx_blob)

    return result.result
  } finally {
    await client.disconnect()
  }
}

// MPToken 발행 (평점용)
export async function createRatingToken(
  wallet: Wallet,
  productId: string,
  rating: number
): Promise<{ mpTokenId: string; transactionResult: any }> {
  const client = new Client(XRPL_SERVER)
  await client.connect()

  try {
    // MPToken Issuance 생성
    const issuanceTx: any = {
      TransactionType: "MPTokenIssuanceCreate",
      Account: wallet.address,
      AssetScale: 0,
      MaximumAmount: rating.toString(), // 평점만큼 토큰 발행
      Flags: {
        tfMPTCanTransfer: false, // 전송 불가
        tfMPTCanEscrow: false,
        tfMPTRequireAuth: false
      },
      MPTokenMetadata: toHex(JSON.stringify({
        productId,
        rating,
        timestamp: Date.now()
      }))
    }

    const prepared = await client.autofill(issuanceTx)
    const signed = wallet.sign(prepared)
    const result = await client.submitAndWait(signed.tx_blob)

    // MPToken ID 추출
    const meta = result.result.meta as any
    const mpTokenId = meta?.mpt_issuance_id || ''

    return {
      mpTokenId: mpTokenId,
      transactionResult: result
    }
  } finally {
    await client.disconnect()
  }
}

// 직접 결제 (Credential이 있을 때)
export async function directPayment(
  buyerWallet: Wallet,
  sellerAddress: string,
  amount: string
): Promise<any> {
  const client = new Client(XRPL_SERVER)
  await client.connect()

  try {
    const tx: Payment = {
      TransactionType: "Payment",
      Account: buyerWallet.address,
      Destination: sellerAddress,
      Amount: (parseFloat(amount) * 1000000).toString() // XRP to drops
    }

    const prepared = await client.autofill(tx)
    const signed = buyerWallet.sign(prepared)
    const result = await client.submitAndWait(signed.tx_blob)

    return result.result
  } finally {
    await client.disconnect()
  }
}