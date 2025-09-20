export interface WalletInfo {
  address: string
  seed: string
  balance?: string
}

export interface Product {
  id: string
  name: string
  description: string
  price: string
  ipfsHash: string
  seller: string
  nftTokenId?: string
  credentialId?: string
  created: number
  ratings?: Rating[]
}

export interface Rating {
  buyer: string
  score: number
  mpTokenId?: string
  timestamp: number
}

export interface Purchase {
  productId: string
  buyer: string
  seller: string
  escrowSequence?: number
  status: 'pending' | 'completed' | 'cancelled'
  transactionHash?: string
  timestamp: number
}

export interface CredentialInfo {
  id: string
  issuer: string
  subject: string
  type: string
  expiration?: number
}