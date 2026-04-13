export type Theme = 'light' | 'dark'

export type NavItem = 'Dashboard' | 'Vaults' | 'Proposals'

export type SignatureState = 'pending' | 'verified' | 'failed'

export type AdminCredential = {
  name: string
  publicKey: string
  privateKey: string
  algorithm: string
  keyFile?: string
}

export type Vault = {
  id: string
  apiId?: number
  name: string
  balance: string
  adminCount: number
  network: string
  contractAddress?: string | null
  pendingApprovals: number
  threshold?: number
  generatedAdminKeys?: AdminCredential[]
  isPending?: boolean
}

export type ProposalStatus = 'pending' | 'approved' | 'executed'

export type ProposalSignature = {
  publicKey: string
  walletAddress?: string | null
  isVerified: boolean
  isApproved: boolean
  createdAt?: string | null
  approvedAt?: string | null
}

export type ProposalApproval = {
  publicKey: string
  walletAddress?: string | null
  createdAt?: string | null
}

export type Proposal = {
  id: string
  apiId?: number
  vaultApiId?: number
  network?: string
  title: string
  description: string
  destination: string
  amountEth: string
  amountWei?: string | null
  approvals: number
  threshold: number
  status: ProposalStatus
  submittedBy: string
  updatedAt: string
  signatureState: SignatureState
  currentStep: number
  signatures: ProposalSignature[]
  approvalRecords: ProposalApproval[]
  signaturePublicKeys?: string[]
  approvalPublicKeys?: string[]
  approvalWalletAddresses?: string[]
  messageToSign?: string
  executionTxHash?: string | null
  isPending?: boolean
}

export type ActivityItem = {
  id: string
  title: string
  description: string
  time: string
}
