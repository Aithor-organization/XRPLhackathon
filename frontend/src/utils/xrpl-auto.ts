import { Client, Wallet, Payment, Transaction } from 'xrpl'
import { Product } from '../types'

const XRPL_SERVER = "wss://s.devnet.rippletest.net:51233"

const now = () => Math.floor(Date.now() / 1000) - 946_684_800

// 자동 완료 가능한 에스크로 생성
export async function createAutoEscrowPayment(
  buyerWallet: Wallet,
  sellerAddress: string,
  amount: string,
  productId: string
): Promise<{ sequence: number; transactionHash: string; fulfillmentCode: string }> {
  const client = new Client(XRPL_SERVER)
  await client.connect()

  try {
    // 구매 조건 생성 (productId를 해시화)
    const crypto = window.crypto
    const encoder = new TextEncoder()
    const data = encoder.encode(productId + Date.now())
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const fulfillmentCode = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    const tx: any = {
      TransactionType: "EscrowCreate",
      Account: buyerWallet.address,
      Destination: sellerAddress,
      Amount: (parseFloat(amount) * 1000000).toString(),
      FinishAfter: now() + 60,      // 1분 후 자동 완료 가능
      CancelAfter: now() + 3600,    // 1시간 후 취소 가능
      // Condition을 사용하면 더 안전하지만 구현 복잡도 증가
      Memos: [{
        Memo: {
          MemoType: Buffer.from('product_id').toString('hex').toUpperCase(),
          MemoData: Buffer.from(productId).toString('hex').toUpperCase()
        }
      }]
    }

    const prepared = await client.autofill(tx)
    const signed = buyerWallet.sign(prepared)
    const result = await client.submitAndWait(signed.tx_blob)

    return {
      sequence: prepared.Sequence || 0,
      transactionHash: result.result.hash || '',
      fulfillmentCode: fulfillmentCode
    }
  } finally {
    await client.disconnect()
  }
}

// 자동 에스크로 완료 (FinishAfter 시간 경과 후)
export async function autoFinishEscrow(
  wallet: Wallet,  // 누구나 완료 가능 (구매자 또는 판매자)
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

// 에스크로 상태 확인
export async function checkEscrowStatus(
  escrowOwner: string,
  escrowSequence: number
): Promise<{ canFinish: boolean; timeRemaining: number }> {
  const client = new Client(XRPL_SERVER)
  await client.connect()

  try {
    const response = await client.request({
      command: 'account_objects',
      account: escrowOwner,
      type: 'escrow'
    } as any)

    const escrows = response.result.account_objects || []
    const targetEscrow = escrows.find((e: any) =>
      e.PreviousTxnLgrSeq === escrowSequence
    )

    if (!targetEscrow) {
      return { canFinish: false, timeRemaining: 0 }
    }

    const currentTime = now()
    const finishAfter = targetEscrow.FinishAfter || 0
    const canFinish = currentTime >= finishAfter
    const timeRemaining = Math.max(0, finishAfter - currentTime)

    return { canFinish, timeRemaining }
  } finally {
    await client.disconnect()
  }
}

// 스마트 컨트랙트 방식 (XRPL Hooks 사용 시 - 현재는 테스트넷에서만 가능)
export async function deployAutoTradeHook(
  sellerWallet: Wallet,
  productPrice: string
): Promise<{ hookHash: string }> {
  // XRPL Hooks가 메인넷에 배포되면 사용 가능
  // Hook은 에스크로 생성을 감지하고 자동으로 처리

  const hookCode = `
    // Pseudo-code for XRPL Hook
    if (transaction.type === 'EscrowCreate' &&
        transaction.amount === productPrice) {
      // 자동으로 에스크로 완료 승인
      return ACCEPT
    }
  `

  // 실제 구현은 XRPL Hooks API 사용
  return { hookHash: 'placeholder_hash' }
}