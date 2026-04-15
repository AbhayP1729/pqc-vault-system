export type Theme = 'light' | 'dark'

export type NavItem = 'Dashboard' | 'Vaults' | 'Proposals'

export type SignatureState = 'pending' | 'verified' | 'failed'

export type AdminCredential = {
  name: string
  publicKey: string
  privateKey?: string
  algorithm: string
  walletAddress?: string | null
  keyFile?: string
}

export type PqcAlgorithmOption = {
  name: string
  label: string
  family: string
}

export type Vault = {
  id: string
  apiId?: number
  name: string
  balance: string
  isActive: boolean
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
  algorithm?: string
  signature?: string
  keyGenerated?: boolean
  walletAddress?: string | null
  isVerified: boolean
  isApproved: boolean
  createdAt?: string | null
  approvedAt?: string | null
}

export type ProposalApproval = {
  publicKey: string
  algorithm?: string
  signature?: string
  walletAddress?: string | null
  createdAt?: string | null
}

export type SignatureAuditLog = {
  id: string
  publicKey?: string | null
  walletAddress?: string | null
  algorithm: string
  keyGenerated?: boolean
  signature: string
  message: string
  isVerified: boolean
  verificationResult: string
  createdAt?: string | null
}

export type Proposal = {
  id: string
  apiId?: number
  vaultApiId?: number
  network?: string
  contractAddress?: string | null
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
  signatureAuditLog: SignatureAuditLog[]
  signaturePublicKeys?: string[]
  approvalPublicKeys?: string[]
  approvalWalletAddresses?: string[]
  messageToSign?: string
  onchainProposalId?: number | null
  executionTxHash?: string | null
  isPending?: boolean
}

export type ActivityItem = {
  id: string
  title: string
  description: string
  time: string
}

export type BackendDebugEntry = {
  label: string
  payload: unknown
  createdAt: string
}
