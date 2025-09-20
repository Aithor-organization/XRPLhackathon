# XRPL 마켓플레이스

XRPL(XRP Ledger)의 최신 기능들을 활용한 탈중앙화 디지털 상품 거래 플랫폼

## 주요 기능

### 🎯 핵심 XRPL 기술
- **NFToken**: 디지털 상품을 NFT로 발행하여 소유권 증명
- **DID Credential**: 판매자/구매자 신원 검증 시스템
- **Escrow**: 안전한 P2P 거래를 위한 에스크로 결제
- **MPToken**: 블록체인 기반 평점 시스템
- **Payment**: XRP 직접 결제

### 💡 주요 특징
- 판매자는 상품을 NFT로 등록하고 DID Credential 발급
- 구매자는 Credential 보유 여부에 따라 직접 결제 또는 에스크로 결제
- 구매 후 MPToken을 통한 온체인 평점 시스템
- IPFS 연동으로 탈중앙화 파일 저장

## 기술 스택

- **Frontend**: React + TypeScript
- **Blockchain**: XRPL (XRP Ledger)
- **Network**: XRPL Devnet
- **Storage**: IPFS (InterPlanetary File System)
- **Build Tool**: Vite

## 설치 및 실행

### 사전 요구사항
- Node.js 18.0 이상
- npm 또는 yarn
- XRPL Devnet 계정 (테스트용)

### 설치
```bash
# 저장소 클론
git clone [repository-url]
cd hackathon

# 프론트엔드 의존성 설치
cd frontend
npm install
```

### 환경 설정
```bash
# frontend 디렉토리에서
cp .env.example .env
```

### 실행
```bash
# frontend 디렉토리에서
npm run dev
```

브라우저에서 `http://localhost:5173` 접속

## XRPL 테스트 계정 생성

1. [XRPL Faucet](https://xrpl.org/xrp-testnet-faucet.html) 방문
2. Devnet 선택
3. Generate Credentials 클릭
4. 생성된 시드(seed)를 안전하게 보관

## 사용 방법

### 1. 지갑 연결
- XRPL 테스트넷 시드 입력
- 지갑 연결 버튼 클릭

### 2. 상품 등록 (판매자)
- 상품 등록 버튼 클릭
- 상품 정보 입력 (이름, 설명, 가격, IPFS 해시)
- NFT 및 DID Credential 자동 생성

### 3. 상품 구매 (구매자)
- 상품 목록에서 원하는 상품 선택
- 구매 확인 후 결제 진행
  - Credential 있음: 직접 결제
  - Credential 없음: 에스크로 결제
- 구매 완료 후 IPFS 파일 다운로드

### 4. 평점 등록
- 구매한 상품에 대해 1-5점 평점 부여
- MPToken으로 블록체인에 영구 기록

## 프로젝트 구조

```
hackathon/
├── frontend/
│   ├── src/
│   │   ├── components/      # React 컴포넌트
│   │   │   ├── ProductModal.tsx       # 상품 등록 모달
│   │   │   ├── ProductList.tsx        # 상품 목록
│   │   │   ├── PurchaseModal.tsx      # 구매 모달
│   │   │   ├── RatingModal.tsx        # 평점 모달
│   │   │   └── TransactionModal.tsx   # 트랜잭션 결과 모달
│   │   ├── utils/
│   │   │   └── xrpl.ts      # XRPL 통합 함수
│   │   ├── types/           # TypeScript 타입 정의
│   │   ├── App.tsx          # 메인 애플리케이션
│   │   └── App.css          # 스타일시트
│   └── package.json
├── backend/                  # 백엔드 (현재 미사용)
└── README.md

```

## XRPL 트랜잭션 타입

### NFTokenMint
- 상품을 NFT로 발행
- 메타데이터에 상품 정보 포함
- 전송 가능, XRP 전용 설정

### CredentialCreate
- DID Credential 발급
- 24시간 만료 설정
- 판매자/구매자 신원 검증용

### EscrowCreate/Finish
- 안전한 P2P 거래
- 5분 후 완료 가능
- 1시간 후 자동 취소

### MPTokenIssuanceCreate
- 평점을 토큰으로 기록
- 전송 불가능 설정
- 메타데이터에 평점 정보 저장

### Payment
- 표준 XRP 송금
- Credential 보유자용 직접 결제

## 트랜잭션 확인용 계좌
- rBJb6EFVbux69RoXGKkmGD4Dnm9Kipxuzi

## 주의사항

- **테스트넷 전용**: 실제 XRP가 아닌 테스트 토큰 사용
- **시드 보안**: 시드를 안전하게 보관하고 공유하지 마세요
- **IPFS 해시**: 실제 파일을 IPFS에 업로드한 후 해시값 사용
- **네트워크**: Devnet 외 다른 네트워크에서는 작동하지 않음

## 개발 환경

- XRPL Devnet: `wss://s.devnet.rippletest.net:51233`
- 로컬 개발 서버: `http://localhost:5173`
- IPFS Gateway: `https://ipfs.io/ipfs/`

## 라이선스

MIT License

## 기여

이슈 및 풀 리퀘스트 환영합니다.

## 문의

프로젝트 관련 문의는 이슈 탭을 이용해주세요.