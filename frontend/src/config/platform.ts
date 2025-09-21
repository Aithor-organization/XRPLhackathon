// 플랫폼 마스터 계정 설정
// 실제 환경에서는 환경변수나 안전한 서버에 보관해야 함

export const PLATFORM_CONFIG = {
  // 플랫폼 마스터 시드 (데모용 - 실제로는 서버에 보관)
  MASTER_SEED: 'sEdSJHS4oiAdz7w2X2ni1gFiqtbJHqE', // 테스트넷 시드

  // 플랫폼 수수료 (옵션)
  FEE_PERCENTAGE: 0.01, // 1% 수수료

  // 플랫폼 정보
  NAME: 'XRPL Marketplace',
  VERSION: '1.0.0',

  // Credential 유효 기간
  CREDENTIAL_VALIDITY: 86400, // 24시간

  // 에스크로 설정
  ESCROW_FINISH_AFTER: 60, // 1분 후 완료 가능
  ESCROW_CANCEL_AFTER: 3600 // 1시간 후 취소 가능
}

// 플랫폼 권한 타입
export enum CredentialType {
  PLATFORM_VERIFIED = 'PLATFORM_VERIFIED', // 플랫폼 검증
  PURCHASE_AUTHORIZED = 'PURCHASE_AUTHORIZED', // 구매 권한
  SELLER_VERIFIED = 'SELLER_VERIFIED', // 판매자 검증
  BUYER_VERIFIED = 'BUYER_VERIFIED' // 구매자 검증
}