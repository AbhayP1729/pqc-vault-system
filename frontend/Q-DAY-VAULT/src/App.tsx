import { motion } from 'framer-motion'
import { startTransition, useEffect, useRef, useState } from 'react'

import {
  approveProposal,
  createProposal,
  createVault,
  executeProposal,
  getPqcAlgorithms,
  getProposals,
  getVaults,
  registerWalletPqcAlgorithms,
  signProposal,
  useApiRequest,
} from './api.js'
import { initialActivity, initialProposals, initialVaults, navItems } from './data'
import { CreateVaultModal } from './components/CreateVaultModal'
import { LoadingSpinner } from './components/LoadingSpinner'
import { ProposalCard } from './components/ProposalCard'
import { ProposalFlowModal } from './components/ProposalFlowModal'
import { ProposalModal } from './components/ProposalModal'
import { ThemeToggle } from './components/ThemeToggle'
import { ToastViewport } from './components/ToastViewport'
import { VaultCard } from './components/VaultCard'
import { useWallet } from './context/WalletContext'
import {
  getEthBalance,
  normalizeEthereumAddress,
  normalizeEthereumAddressList,
  validateProposalTransaction,
} from './lib/ethereum'
import {
  SEPOLIA_NETWORK_NAME,
  formatWalletAddress,
  getWalletErrorMessage,
} from './lib/wallet'
import { applyTheme, resolveInitialTheme } from './theme'

import type {
  ApiApproveProposalResponse,
  ApiCreateVaultResponse,
  ApiExecuteProposalResponse,
  ApiGeneratedAdminKey,
  ApiPayload,
  ApiProposalResponse,
  ApiRegisterWalletPqcResponse,
  ApiVaultAdmin,
  ApiVaultResponse,
} from './api.js'
import type { Eip1193Provider } from 'ethers'
import type { FormEvent, ReactNode } from 'react'
import type {
  ActivityItem,
  AdminCredential,
  BackendDebugEntry,
  NavItem,
  Proposal,
  ProposalStatus,
  PqcAlgorithmOption,
  SignatureState,
  Theme,
  Vault,
} from './types'

type Toast = {
  id: string
  title: string
  message: string
  tone: 'success' | 'error'
}

type ProposalNotice = {
  tone: 'success' | 'error' | 'info'
  title: string
  message?: string
}

type VaultFormState = {
  name: string
  adminCount: string
  threshold: string
  adminWallets: string
  contractAddress: string
}

type ProposalFormState = {
  vaultApiId: string
  title: string
  description: string
  recipientAddress: string
  amountEth: string
  onchainProposalId: string
}

const DEFAULT_VAULT_FORM: VaultFormState = {
  name: '',
  adminCount: '3',
  threshold: '2',
  adminWallets: '',
  contractAddress: '',
}

const DEFAULT_PROPOSAL_FORM: ProposalFormState = {
  vaultApiId: '',
  title: '',
  description: '',
  recipientAddress: '',
  amountEth: '',
  onchainProposalId: '',
}

const DEFAULT_PQC_ALGORITHMS: PqcAlgorithmOption[] = [
  {
    family: 'Dilithium',
    name: 'Dilithium2',
    label: 'Dilithium',
  },
  {
    family: 'Falcon',
    name: 'Falcon-512',
    label: 'Falcon',
  },
  {
    family: 'SPHINCS+',
    name: 'SPHINCS+-SHA2-128f-simple',
    label: 'SPHINCS+',
  },
]

const PQC_ALGORITHM_LOOKUP = new Map(
  DEFAULT_PQC_ALGORITHMS.flatMap((algorithm) => [
    [algorithm.name.toLowerCase(), algorithm],
    [algorithm.label.toLowerCase(), algorithm],
    [algorithm.family.toLowerCase(), algorithm],
  ]),
)

function createTempId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function truncateHash(value: string, lead = 8, tail = 6) {
  if (value.length <= lead + tail + 3) {
    return value
  }

  return `${value.slice(0, lead)}...${value.slice(-tail)}`
}

function getExplorerUrl(network: string | undefined, transactionHash: string | null | undefined) {
  if (!transactionHash) {
    return null
  }

  const normalizedNetwork = (network ?? '').trim().toLowerCase()
  if (normalizedNetwork.includes('sepolia')) {
    return `https://sepolia.etherscan.io/tx/${transactionHash}`
  }
  if (normalizedNetwork === 'mainnet' || normalizedNetwork === 'ethereum') {
    return `https://etherscan.io/tx/${transactionHash}`
  }

  return null
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return 'Just now'
  }

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    return 'Just now'
  }

  return timestamp.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function parseBalanceValue(value: string | undefined) {
  if (!value) {
    return null
  }

  const normalized = value.replace(/eth/i, '').trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatAggregateBalance(vaults: Vault[]) {
  const balances = vaults
    .map((vault) => parseBalanceValue(vault.balance))
    .filter((value): value is number => value !== null)

  if (balances.length === 0) {
    return vaults.length > 0 ? 'Unavailable' : '0.0000 ETH'
  }

  return `${balances.reduce((sum, value) => sum + value, 0).toFixed(4)} ETH`
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) {
    return 'Good morning'
  }
  if (hour < 17) {
    return 'Good afternoon'
  }
  return 'Good evening'
}

function formatCompactWallet(value: string | null | undefined) {
  if (!value) {
    return 'Wallet disconnected'
  }

  return formatWalletAddress(value)
}

function AppMark() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-600/20 dark:bg-blue-500">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 8.5 12 4l7 4.5v7L12 20l-7-4.5v-7Z" />
        <path d="M12 4v16M5 8.5l7 4.5 7-4.5" />
      </svg>
    </div>
  )
}

function VaultIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7.5 12 4l8 3.5-8 3.5-8-3.5Z" />
      <path d="M4 12l8 3.5 8-3.5" />
      <path d="M4 16.5 12 20l8-3.5" />
    </svg>
  )
}

function ProposalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 4.75h8l3 3v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5.75a1 1 0 0 1 1-1Z" />
      <path d="M10 10h4M9 14h6M9 18h4" />
      <path d="M15 4.75v3h3" />
    </svg>
  )
}

function SignIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 18.5 18.5 5a2.12 2.12 0 0 1 3 3L8 21.5H5v-3Z" />
      <path d="m14 6 4 4" />
    </svg>
  )
}

function ApproveIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 12.5 9.25 17 19 7.25" />
      <path d="M4 4.75h16v14.5H4z" opacity=".45" />
    </svg>
  )
}

function ExecuteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 12h11" />
      <path d="m12 5 7 7-7 7" />
      <path d="M5 5.75v12.5" opacity=".45" />
    </svg>
  )
}

function DashboardTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition duration-200 ${
        active
          ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20 dark:bg-blue-500'
          : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:bg-slate-900 dark:text-gray-300 dark:hover:bg-slate-800 dark:hover:text-gray-100'
      }`}
    >
      {label}
    </motion.button>
  )
}

function QuickActionCard({
  icon,
  title,
  description,
  meta,
  onClick,
  disabled = false,
}: {
  icon: ReactNode
  title: string
  description: string
  meta: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <motion.button
      type="button"
      whileHover={disabled ? undefined : { y: -4, scale: 1.01 }}
      whileTap={disabled ? undefined : { scale: 0.99 }}
      onClick={onClick}
      disabled={disabled}
      className={`group rounded-2xl border p-6 text-left shadow-md transition duration-200 ${
        disabled
          ? 'cursor-not-allowed border-gray-200 bg-white/70 text-gray-400 dark:border-gray-800 dark:bg-slate-900/60 dark:text-gray-500'
          : 'border-gray-200 bg-white text-gray-900 hover:border-blue-200 hover:shadow-lg dark:border-gray-700 dark:bg-slate-900/85 dark:text-gray-100 dark:hover:border-blue-500/40'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${disabled ? 'bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-gray-500' : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'}`}>
          {icon}
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${disabled ? 'bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-gray-500' : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-300'}`}>
          {meta}
        </span>
      </div>
      <h3 className="mt-5 text-lg font-semibold">{title}</h3>
      <p className={`mt-2 text-sm leading-6 ${disabled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'}`}>
        {description}
      </p>
      <div className={`mt-5 inline-flex items-center gap-2 text-sm font-semibold ${disabled ? 'text-gray-400 dark:text-gray-500' : 'text-blue-600 dark:text-blue-300'}`}>
        Open flow
        <svg viewBox="0 0 24 24" className="h-4 w-4 transition duration-200 group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5 12h13" />
          <path d="m13 5 7 7-7 7" />
        </svg>
      </div>
    </motion.button>
  )
}

function WidgetShell({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string
  subtitle: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-6 shadow-md dark:border-gray-700 dark:bg-slate-900/85 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function mapGeneratedAdminKey(key: ApiGeneratedAdminKey, fallbackIndex: number): AdminCredential {
  return {
    name: key.name ?? `Admin ${fallbackIndex + 1}`,
    publicKey: key.public_key ?? '',
    privateKey: key.private_key,
    algorithm: key.algorithm ?? 'Dilithium2',
    walletAddress: key.wallet_address ?? null,
    keyFile: key.key_file,
  }
}

function mapVaultAdmin(admin: ApiVaultAdmin, fallbackIndex: number): AdminCredential {
  return {
    name: admin.name ?? `Admin ${fallbackIndex + 1}`,
    publicKey: admin.public_key ?? '',
    algorithm: admin.algorithm ?? 'Dilithium2',
    walletAddress: admin.wallet_address ?? null,
    keyFile: admin.key_file ?? undefined,
  }
}

function mapPqcAlgorithm(option: { family?: string; name?: string; label?: string }): PqcAlgorithmOption | null {
  if (!option.name) {
    return null
  }

  return {
    family: option.family ?? option.label ?? option.name,
    name: option.name,
    label: option.label ?? option.family ?? option.name,
  }
}

function mapPqcAlgorithmValue(option: string | { family?: string; name?: string; label?: string }) {
  if (typeof option === 'string') {
    return PQC_ALGORITHM_LOOKUP.get(option.trim().toLowerCase()) ?? null
  }

  return mapPqcAlgorithm(option)
}

function getAlgorithmSelectionKey(proposalId: string, walletAddress: string | null) {
  return `${proposalId}:${walletAddress?.toLowerCase() ?? 'disconnected'}`
}

function deriveSignatureState(proposal: ApiProposalResponse): SignatureState {
  const signatures = proposal.signatures ?? []

  if (signatures.length === 0) {
    return 'pending'
  }

  if (signatures.some((signature) => signature.is_verified === false)) {
    return 'failed'
  }

  return signatures.some((signature) => signature.is_verified !== false) ? 'verified' : 'pending'
}

function deriveProposalStatus(proposal: ApiProposalResponse): ProposalStatus {
  if (
    proposal.status === 'pending' ||
    proposal.status === 'approved' ||
    proposal.status === 'executed'
  ) {
    return proposal.status
  }

  return 'pending'
}

function deriveCurrentStep(proposal: ApiProposalResponse) {
  const status = deriveProposalStatus(proposal)
  const hasVerifiedSignature = (proposal.signatures ?? []).some(
    (signature) => signature.is_verified !== false,
  )

  if (status === 'executed') {
    return 4
  }

  if (status === 'approved') {
    return 2
  }

  if (hasVerifiedSignature) {
    return 1
  }

  return 0
}

function mapApiVaultRecord(
  vault: ApiVaultResponse | null | undefined,
  generatedAdminKeys: ApiGeneratedAdminKey[] = [],
): Vault | null {
  if (!vault?.id) {
    return null
  }

  const admins = (vault.admins ?? [])
    .map((admin, index) => mapVaultAdmin(admin, index))
    .filter((admin) => Boolean(admin.publicKey))
  const generatedKeys = generatedAdminKeys
    .map(mapGeneratedAdminKey)
    .filter((admin) => Boolean(admin.publicKey))
  const mergedAdmins = [
    ...admins,
    ...generatedKeys.filter(
      (generatedKey) => !admins.some((admin) => admin.publicKey === generatedKey.publicKey),
    ),
  ]

  return {
    id: `vault-${vault.id}`,
    apiId: vault.id,
    name: vault.name ?? `Vault ${vault.id}`,
    balance: vault.contract_address ? 'Loading' : 'Deployment pending',
    isActive: Boolean(vault.contract_address),
    adminCount: vault.admins?.length ?? mergedAdmins.length,
    network: vault.network ?? 'Backend tracked',
    contractAddress: vault.contract_address,
    pendingApprovals: 0,
    threshold: vault.threshold,
    generatedAdminKeys: mergedAdmins,
  }
}

function mapApiVault(response: ApiCreateVaultResponse): Vault | null {
  return mapApiVaultRecord(response.vault, response.generated_admin_keys ?? [])
}

function extractWalletIdentity(payload: ApiPayload | null | undefined) {
  if (!payload || Array.isArray(payload)) {
    return null
  }

  const candidateKeys = [
    'created_by_wallet',
    'creator_wallet_address',
    'submitted_by_wallet',
    'signer_wallet_address',
    'wallet_address',
  ] as const

  for (const key of candidateKeys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function mapApiProposal(proposal: ApiProposalResponse | null): Proposal | null {
  if (!proposal || proposal.id === undefined || proposal.id === null) {
    return null
  }

  const status = deriveProposalStatus(proposal)
  const approvalCount = proposal.approval_count ?? 0
  const submittedBy = extractWalletIdentity(proposal.payload) ?? 'Creator unavailable'

  return {
    id: `PX-${proposal.id}`,
    apiId: Number(proposal.id),
    vaultApiId: proposal.vault_id,
    network: proposal.network,
    contractAddress: proposal.contract_address ?? null,
    title: proposal.title ?? 'Untitled proposal',
    description: proposal.description ?? 'No description provided.',
    destination: proposal.destination ?? 'Unavailable',
    amountEth: proposal.amount_eth ?? '0',
    amountWei: proposal.amount_wei ?? null,
    approvals: approvalCount,
    threshold: proposal.threshold ?? 1,
    status,
    submittedBy,
    updatedAt: formatTimestamp(proposal.executed_at ?? proposal.created_at ?? null),
    signatureState: deriveSignatureState(proposal),
    currentStep: deriveCurrentStep(proposal),
    signatures: (proposal.signatures ?? [])
      .map((signature) => ({
        publicKey: signature.public_key ?? '',
        algorithm: signature.algorithm,
        signature: signature.signature,
        keyGenerated: Boolean(signature.key_generated),
        walletAddress: signature.wallet_address ?? null,
        isVerified: signature.is_verified !== false,
        isApproved: Boolean(signature.is_approved),
        createdAt: signature.created_at ?? null,
        approvedAt: signature.approved_at ?? null,
      }))
      .filter((signature) => Boolean(signature.publicKey)),
    approvalRecords: (proposal.approvals ?? [])
      .map((approval) => ({
        publicKey: approval.public_key ?? '',
        algorithm: approval.algorithm,
        signature: approval.signature,
        walletAddress: approval.wallet_address ?? null,
        createdAt: approval.created_at ?? null,
      }))
      .filter((approval) => Boolean(approval.publicKey)),
    signatureAuditLog: (proposal.signature_audit_log ?? [])
      .map((audit) => ({
        id: String(audit.id ?? `${audit.public_key ?? 'audit'}-${audit.created_at ?? ''}`),
        publicKey: audit.public_key ?? null,
        walletAddress: audit.wallet_address ?? null,
        algorithm: audit.algorithm ?? 'Dilithium2',
        keyGenerated: Boolean(audit.key_generated),
        signature: audit.signature ?? '',
        message: audit.message ?? proposal.message_to_sign ?? '',
        isVerified: audit.is_verified !== false,
        verificationResult: audit.verification_result ?? (audit.is_verified === false ? 'Invalid' : 'Valid'),
        createdAt: audit.created_at ?? null,
      }))
      .filter((audit) => Boolean(audit.signature || audit.message)),
    signaturePublicKeys: (proposal.signatures ?? [])
      .map((signature) => signature.public_key)
      .filter((value): value is string => Boolean(value)),
    approvalPublicKeys: (proposal.approvals ?? [])
      .map((approval) => approval.public_key)
      .filter((value): value is string => Boolean(value)),
    approvalWalletAddresses: (proposal.approvals ?? [])
      .map((approval) => approval.wallet_address)
      .filter((value): value is string => Boolean(value)),
    messageToSign: proposal.message_to_sign,
    onchainProposalId: proposal.onchain_proposal_id ?? null,
    executionTxHash: proposal.execution_tx_hash,
  }
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme())
  const [activeSection, setActiveSection] = useState<NavItem>('Dashboard')
  const [vaults, setVaults] = useState<Vault[]>(initialVaults)
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals)
  const [activity, setActivity] = useState<ActivityItem[]>(initialActivity)
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)
  const [pqcAlgorithms, setPqcAlgorithms] = useState<PqcAlgorithmOption[]>(DEFAULT_PQC_ALGORITHMS)
  const [selectedPqcAlgorithms, setSelectedPqcAlgorithms] = useState<Record<string, string>>({})
  const [backendDebugEntries, setBackendDebugEntries] = useState<Record<string, BackendDebugEntry[]>>({})
  const [isBackendDebugVisible, setIsBackendDebugVisible] = useState(false)
  const [isCreateVaultOpen, setIsCreateVaultOpen] = useState(false)
  const [isProposalFlowOpen, setIsProposalFlowOpen] = useState(false)
  const [vaultForm, setVaultForm] = useState<VaultFormState>(DEFAULT_VAULT_FORM)
  const [proposalForm, setProposalForm] = useState<ProposalFormState>(DEFAULT_PROPOSAL_FORM)
  const [apiNotice, setApiNotice] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [proposalNotices, setProposalNotices] = useState<Record<string, ProposalNotice>>({})
  const [signingProposalId, setSigningProposalId] = useState<string | null>(null)
  const [approvingProposalId, setApprovingProposalId] = useState<string | null>(null)
  const [executingProposalId, setExecutingProposalId] = useState<string | null>(null)
  const toastTimeoutsRef = useRef<number[]>([])
  const previousWalletStateRef = useRef<string | null>(null)

  const {
    ethereumProvider,
    hasMetaMask,
    walletAddress,
    walletChainId,
    walletEthBalance,
    walletActionLoading,
    isWalletConnected,
    isOnSepolia,
    walletIdentityLabel,
    networkLabel,
    connectWallet,
    switchNetwork,
  } = useWallet()

  const {
    run: loadProposals,
    loading: proposalsLoading,
    error: proposalsError,
  } = useApiRequest(getProposals)
  const { run: loadVaults, loading: vaultsLoading } = useApiRequest(getVaults)
  const { run: loadPqcAlgorithms } = useApiRequest(getPqcAlgorithms)
  const { run: runCreateVault, loading: createVaultLoading } = useApiRequest(createVault)
  const { run: runCreateProposal, loading: createProposalLoading } = useApiRequest(createProposal)
  const { run: runSignProposal, loading: signProposalLoading } = useApiRequest(signProposal)
  const { run: runApproveProposal, loading: approveProposalLoading } = useApiRequest(approveProposal)
  const { run: runRegisterWalletPqcAlgorithms, loading: registerWalletPqcAlgorithmsLoading } =
    useApiRequest(registerWalletPqcAlgorithms)
  const { run: runExecuteProposal, loading: executeProposalLoading } = useApiRequest(executeProposal)
  const canUseWalletActions = isWalletConnected && isOnSepolia

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false

    async function hydratePqcAlgorithms() {
      try {
        const response = await loadPqcAlgorithms()
        if (cancelled) {
          return
        }

        const algorithmPayload =
          response.algorithm_options && response.algorithm_options.length > 0
            ? response.algorithm_options
            : (response.algorithms ?? [])
        const mappedAlgorithms = algorithmPayload
          .map(mapPqcAlgorithmValue)
          .filter((algorithm): algorithm is PqcAlgorithmOption => algorithm !== null)

        if (mappedAlgorithms.length > 0) {
          setPqcAlgorithms(mappedAlgorithms)
        }
      } catch {
        if (!cancelled) {
          setPqcAlgorithms(DEFAULT_PQC_ALGORITHMS)
        }
      }
    }

    void hydratePqcAlgorithms()

    return () => {
      cancelled = true
    }
  }, [loadPqcAlgorithms])

  useEffect(() => {
    const timeoutIds = toastTimeoutsRef.current

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
    }
  }, [])

  useEffect(() => {
    console.log('[Wallet Debug] Current wallet address:', walletAddress ?? 'Not connected')
  }, [walletAddress])

  useEffect(() => {
    const currentWalletState = `${walletAddress ?? 'disconnected'}:${walletChainId ?? 'no-chain'}`

    if (previousWalletStateRef.current === null) {
      previousWalletStateRef.current = currentWalletState
      return
    }

    if (previousWalletStateRef.current === currentWalletState) {
      return
    }

    previousWalletStateRef.current = currentWalletState
    setSigningProposalId(null)
    setApprovingProposalId(null)
    setExecutingProposalId(null)
    setProposalNotices({})

    console.log('[Wallet Debug] Wallet context updated', {
      walletAddress: walletAddress ?? 'Not connected',
      chainId: walletChainId ?? 'Unavailable',
    })
  }, [walletAddress, walletChainId])

  const vaultBalanceDependency = vaults
    .map((vault) => `${vault.id}:${vault.contractAddress ?? ''}`)
    .join('|')

  useEffect(() => {
    let cancelled = false

    if (!ethereumProvider || !isOnSepolia) {
      return
    }

    const vaultsWithContracts = vaults.filter((vault) => vault.contractAddress)
    if (vaultsWithContracts.length === 0) {
      return
    }

    async function hydrateVaultBalances() {
      const balances = await Promise.all(
        vaultsWithContracts.map(async (vault) => {
          try {
            const balance = await getEthBalance(
              ethereumProvider as Eip1193Provider,
              vault.contractAddress ?? '',
            )
            return [vault.id, `${Number(balance).toFixed(4)} ETH`] as const
          } catch {
            return [vault.id, 'Unavailable'] as const
          }
        }),
      )

      if (cancelled) {
        return
      }

      const balanceMap = new Map(balances)
      setVaults((currentVaults) =>
        currentVaults.map((vault) => {
          const balance = balanceMap.get(vault.id)
          return balance ? { ...vault, balance } : vault
        }),
      )
    }

    void hydrateVaultBalances()

    return () => {
      cancelled = true
    }
  }, [ethereumProvider, isOnSepolia, vaultBalanceDependency])

  useEffect(() => {
    let cancelled = false

    if (!canUseWalletActions) {
      setApiNotice(
        !walletAddress
          ? 'Connect MetaMask to load vaults and proposals.'
          : `Switch MetaMask to ${SEPOLIA_NETWORK_NAME} to continue.`,
      )
      return
    }

    async function hydrateLiveData() {
      try {
        const [vaultResponse, proposalResponse] = await Promise.all([loadVaults(), loadProposals()])
        if (cancelled) {
          return
        }

        const mappedProposals = proposalResponse.proposals
          .map((proposal) => mapApiProposal(proposal))
          .filter((proposal): proposal is Proposal => proposal !== null)
        const pendingCounts = new Map<number, number>()
        mappedProposals.forEach((proposal) => {
          if (proposal.vaultApiId && proposal.status !== 'executed') {
            pendingCounts.set(
              proposal.vaultApiId,
              (pendingCounts.get(proposal.vaultApiId) ?? 0) + (proposal.status === 'approved' ? 0 : 1),
            )
          }
        })
        const mappedVaults = (vaultResponse.vaults ?? [])
          .map((vault) => mapApiVaultRecord(vault))
          .filter((vault): vault is Vault => vault !== null)
          .map((vault) => ({
            ...vault,
            pendingApprovals: vault.apiId ? pendingCounts.get(vault.apiId) ?? 0 : 0,
          }))

        startTransition(() => {
          setVaults(mappedVaults)

          if (mappedProposals.length > 0) {
            setProposals(mappedProposals)
            setSelectedProposalId((currentId) =>
              currentId && mappedProposals.some((proposal) => proposal.id === currentId) ? currentId : null,
            )
            setApiNotice('Live vaults and proposals loaded from FastAPI.')
          } else {
            setProposals([])
            setSelectedProposalId(null)
            setApiNotice(
              mappedVaults.length > 0
                ? 'Vaults loaded from FastAPI. Create a proposal to start approvals.'
                : 'Backend is live, but there are no vaults or proposals yet.',
            )
          }
        })
      } catch {
        if (!cancelled) {
          setApiNotice('Unable to reach the backend.')
        }
      }
    }

    void hydrateLiveData()

    return () => {
      cancelled = true
    }
  }, [canUseWalletActions, loadProposals, loadVaults, walletAddress])

  function dismissToast(id: string) {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id))
  }

  function pushToast({ title, message, tone }: Omit<Toast, 'id'>) {
    const id = createTempId('toast')

    setToasts((currentToasts) => [
      ...currentToasts,
      {
        id,
        title,
        message,
        tone,
      },
    ])

    const timeoutId = window.setTimeout(() => {
      dismissToast(id)
    }, 4200)

    toastTimeoutsRef.current.push(timeoutId)
  }

  function setProposalNotice(proposalId: string, notice: ProposalNotice | null) {
    setProposalNotices((currentNotices) => {
      if (!notice) {
        const nextNotices = { ...currentNotices }
        delete nextNotices[proposalId]
        return nextNotices
      }

      return {
        ...currentNotices,
        [proposalId]: notice,
      }
    })
  }

  function recordBackendDebugEntry(proposalId: string, label: string, payload: unknown) {
    setBackendDebugEntries((currentEntries) => ({
      ...currentEntries,
      [proposalId]: [
        {
          label,
          payload,
          createdAt: new Date().toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
          }),
        },
        ...(currentEntries[proposalId] ?? []),
      ].slice(0, 6),
    }))
  }

  function updateVaultFormField(field: keyof VaultFormState, value: string) {
    setVaultForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
  }

  function updateProposalFormField(field: keyof ProposalFormState, value: string) {
    setProposalForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
  }

  function ensureWalletReady(actionLabel: string) {
    if (!hasMetaMask) {
      pushToast({
        title: 'MetaMask required',
        message: `Install or enable MetaMask before you ${actionLabel}.`,
        tone: 'error',
      })
      return false
    }

    if (!walletAddress) {
      pushToast({
        title: 'Connect wallet',
        message: `Connect your wallet before you ${actionLabel}.`,
        tone: 'error',
      })
      return false
    }

    if (!isOnSepolia) {
      pushToast({
        title: 'Switch network',
        message: `Switch MetaMask to ${SEPOLIA_NETWORK_NAME} before you ${actionLabel}.`,
        tone: 'error',
      })
      return false
    }

    return true
  }

  function addActivity(title: string, description: string) {
    setActivity((currentActivity) => [
      {
        id: createTempId('activity'),
        title,
        description,
        time: 'Just now',
      },
      ...currentActivity,
    ].slice(0, 8))
  }

  function adjustVaultPendingApprovals(vaultApiId: number, delta: number) {
    setVaults((currentVaults) =>
      currentVaults.map((vault) => {
        if (vault.apiId !== vaultApiId) {
          return vault
        }

        return {
          ...vault,
          pendingApprovals: Math.max(vault.pendingApprovals + delta, 0),
        }
      }),
    )
  }

  function getAvailableAlgorithmsForProposal(
    proposal: Proposal,
    candidateWalletAddress: string | null,
  ) {
    const vault = vaults.find((candidate) => candidate.apiId === proposal.vaultApiId)
    const adminKeys = vault?.generatedAdminKeys ?? []
    const normalizedWalletAddress = candidateWalletAddress?.toLowerCase()

    if (!normalizedWalletAddress) {
      return []
    }

    const hasMatchingAdmin = adminKeys.some(
      (admin) => admin.walletAddress?.toLowerCase() === normalizedWalletAddress,
    )

    return hasMatchingAdmin ? pqcAlgorithms : []
  }

  function getSelectedAlgorithmForProposal(
    proposal: Proposal,
    candidateWalletAddress: string | null,
  ) {
    const walletSelectionKey = getAlgorithmSelectionKey(proposal.id, candidateWalletAddress)
    const storedAlgorithm = selectedPqcAlgorithms[walletSelectionKey]
    const availableAlgorithms = getAvailableAlgorithmsForProposal(proposal, candidateWalletAddress)

    if (storedAlgorithm && pqcAlgorithms.some((algorithm) => algorithm.name === storedAlgorithm)) {
      return storedAlgorithm
    }

    return availableAlgorithms[0]?.name ?? pqcAlgorithms[0]?.name ?? DEFAULT_PQC_ALGORITHMS[0].name
  }

  function getNextSignerForProposal(
    proposal: Proposal,
    candidateWalletAddress: string | null,
  ) {
    const vault = vaults.find((candidate) => candidate.apiId === proposal.vaultApiId)
    const adminKeys = vault?.generatedAdminKeys ?? []
    const normalizedWalletAddress = candidateWalletAddress?.toLowerCase()

    if (!normalizedWalletAddress) {
      return undefined
    }

    return adminKeys.find((admin) => {
      if (!admin.publicKey) {
        return false
      }
      if (!admin.walletAddress) {
        return false
      }
      return admin.walletAddress.toLowerCase() === normalizedWalletAddress
    })
  }

  function getSignatureForWallet(
    proposal: Proposal,
    candidateWalletAddress: string | null,
  ) {
    if (!candidateWalletAddress) {
      return null
    }

    const normalizedWalletAddress = candidateWalletAddress.toLowerCase()

    return (
      proposal.signatures.find(
        (signature) => signature.walletAddress?.toLowerCase() === normalizedWalletAddress,
      ) ?? null
    )
  }

  function getPendingVerifiedSignatureForWallet(
    proposal: Proposal,
    candidateWalletAddress: string | null,
  ) {
    const signature = getSignatureForWallet(proposal, candidateWalletAddress)

    if (!signature || !signature.isVerified || signature.isApproved) {
      return null
    }

    return signature
  }

  function hasWalletApprovedProposal(proposal: Proposal, candidateWalletAddress: string | null) {
    if (!candidateWalletAddress) {
      return false
    }

    const normalizedWalletAddress = candidateWalletAddress.toLowerCase()

    return proposal.approvalRecords.some(
      (approval) => approval.walletAddress?.toLowerCase() === normalizedWalletAddress,
    )
  }

  function handleOpenProposal(proposal: Proposal) {
    console.log('[Proposal Debug] Proposal clicked', {
      id: proposal.id,
      apiId: proposal.apiId,
      walletAddress: walletAddress ?? 'Not connected',
    })
    setSelectedProposalId(proposal.id)
  }

  async function handleConnectWallet() {
    try {
      const { address: nextAddress } = await connectWallet()

      pushToast({
        title: 'Wallet connected',
        message: `${formatWalletAddress(nextAddress)} is now connected.`,
        tone: 'success',
      })
    } catch (error) {
      pushToast({
        title: 'Wallet connection failed',
        message: getWalletErrorMessage(error, 'Unable to connect MetaMask.'),
        tone: 'error',
      })
    }
  }

  async function handleSwitchNetwork() {
    try {
      await switchNetwork()
      pushToast({
        title: 'Network switched',
        message: `MetaMask is now connected to ${SEPOLIA_NETWORK_NAME}.`,
        tone: 'success',
      })
    } catch (error) {
      pushToast({
        title: 'Network switch failed',
        message: getWalletErrorMessage(error, `Unable to switch MetaMask to ${SEPOLIA_NETWORK_NAME}.`),
        tone: 'error',
      })
    }
  }

  async function handleCreateVaultSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!ensureWalletReady('create a vault')) {
      return
    }

    const name = vaultForm.name.trim()
    const adminCount = Number(vaultForm.adminCount)
    const threshold = Number(vaultForm.threshold)
    const contractAddressInput = vaultForm.contractAddress.trim()

    if (!name) {
      pushToast({
        title: 'Vault name required',
        message: 'Add a vault name before creating it.',
        tone: 'error',
      })
      return
    }

    if (!Number.isInteger(adminCount) || adminCount <= 0) {
      pushToast({
        title: 'Invalid admin count',
        message: 'Admin count must be a positive number.',
        tone: 'error',
      })
      return
    }

    if (!Number.isInteger(threshold) || threshold <= 0 || threshold > adminCount) {
      pushToast({
        title: 'Invalid threshold',
        message: 'Threshold must be at least 1 and no larger than the admin count.',
        tone: 'error',
      })
      return
    }

    let adminWallets: string[]
    try {
      adminWallets = normalizeEthereumAddressList(vaultForm.adminWallets)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Enter valid admin wallet addresses.'
      pushToast({
        title: 'Invalid admin wallet',
        message,
        tone: 'error',
      })
      return
    }

    if (adminWallets.length !== adminCount) {
      pushToast({
        title: 'Admin wallets required',
        message: `Add exactly ${adminCount} unique admin wallet address${adminCount === 1 ? '' : 'es'}.`,
        tone: 'error',
      })
      return
    }

    if (new Set(adminWallets.map((address) => address.toLowerCase())).size !== adminWallets.length) {
      pushToast({
        title: 'Duplicate admin wallet',
        message: 'Each admin wallet can appear only once in a vault.',
        tone: 'error',
      })
      return
    }

    let contractAddress: string | undefined
    try {
      contractAddress = contractAddressInput ? normalizeEthereumAddress(contractAddressInput) : undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Enter a valid vault contract address.'
      pushToast({
        title: 'Invalid contract address',
        message,
        tone: 'error',
      })
      return
    }

    const algorithmCycle = pqcAlgorithms.length > 0 ? pqcAlgorithms : DEFAULT_PQC_ALGORITHMS
    const adminDrafts = adminWallets.map((adminWallet, index) => {
      const algorithm = algorithmCycle[index % algorithmCycle.length]
      return {
        walletAddress: adminWallet,
        algorithm,
      }
    })

    const tempId = createTempId('vault')
    const optimisticVault: Vault = {
      id: tempId,
      name,
      balance: contractAddress ? 'Loading' : 'Deploying contract...',
      isActive: Boolean(contractAddress),
      adminCount,
      network: 'sepolia',
      contractAddress,
      pendingApprovals: 0,
      threshold,
      generatedAdminKeys: adminDrafts.map((admin) => ({
        name: `${formatWalletAddress(admin.walletAddress)} ${admin.algorithm.label}`,
        publicKey: '',
        algorithm: admin.algorithm.name,
        walletAddress: admin.walletAddress,
      })),
      isPending: true,
    }

    setVaults((currentVaults) => [optimisticVault, ...currentVaults])

    try {
      const response = await runCreateVault({
        name,
        threshold,
        contract_address: contractAddress,
        network: 'sepolia',
        admins: adminDrafts.map((admin) => ({
          name: `${formatWalletAddress(admin.walletAddress)} ${admin.algorithm.label} admin`,
          wallet_address: admin.walletAddress,
          generate_keypair: true,
          algorithm: admin.algorithm.name,
        })),
      })

      const mappedVault = mapApiVault(response)
      if (!mappedVault) {
        throw new Error('Vault was created, but the response was incomplete.')
      }

      startTransition(() => {
        setVaults((currentVaults) =>
          currentVaults.map((vault) => (vault.id === tempId ? mappedVault : vault)),
        )
        setProposalForm((currentForm) => ({
          ...currentForm,
          vaultApiId: currentForm.vaultApiId || String(mappedVault.apiId ?? ''),
        }))
        setVaultForm(DEFAULT_VAULT_FORM)
        setApiNotice('Live vault and proposal actions are connected to FastAPI.')
      })
      setIsCreateVaultOpen(false)

      addActivity('Vault created', `${mappedVault.name} is ready for proposal submissions.`)
      pushToast({
        title: 'Vault created',
        message: mappedVault.contractAddress
          ? `${walletIdentityLabel} created ${mappedVault.name} and linked ${truncateHash(mappedVault.contractAddress, 10, 8)}.`
          : `${walletIdentityLabel} created ${mappedVault.name} with ${mappedVault.adminCount} admins.`,
        tone: 'success',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create vault.'

      setVaults((currentVaults) => currentVaults.filter((vault) => vault.id !== tempId))
      pushToast({
        title: 'Vault creation failed',
        message,
        tone: 'error',
      })
    }
  }

  async function handleCreateProposalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!ensureWalletReady('create a proposal')) {
      return
    }

    const connectedWalletAddress = walletAddress
    if (!connectedWalletAddress) {
      return
    }

    const vaultApiId = Number(proposalForm.vaultApiId)
    const title = proposalForm.title.trim()
    const description = proposalForm.description.trim()
    const destination = proposalForm.recipientAddress.trim()
    const amountEth = proposalForm.amountEth.trim()
    const onchainProposalIdValue = proposalForm.onchainProposalId.trim()

    if (!vaultApiId) {
      pushToast({
        title: 'Vault required',
        message: 'Create a vault first, then select it before submitting a proposal.',
        tone: 'error',
      })
      return
    }

    if (!title || !destination || !amountEth) {
      pushToast({
        title: 'Missing proposal details',
        message: 'Title, recipient address, and amount are required.',
        tone: 'error',
      })
      return
    }

    const selectedVault = vaults.find((vault) => vault.apiId === vaultApiId)
    if (!selectedVault) {
      pushToast({
        title: 'Vault unavailable',
        message: 'The selected vault is not ready yet. Try again once creation finishes.',
        tone: 'error',
      })
      return
    }

    let normalizedTransaction: ReturnType<typeof validateProposalTransaction>
    try {
      normalizedTransaction = validateProposalTransaction(destination, amountEth)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to validate proposal transaction.'
      pushToast({
        title: 'Proposal validation failed',
        message,
        tone: 'error',
      })
      return
    }

    let onchainProposalId: number | undefined
    if (onchainProposalIdValue) {
      const parsedOnchainProposalId = Number(onchainProposalIdValue)
      if (!Number.isInteger(parsedOnchainProposalId) || parsedOnchainProposalId < 0) {
        pushToast({
          title: 'Invalid onchain proposal',
          message: 'Onchain proposal ID must be a zero-based integer.',
          tone: 'error',
        })
        return
      }
      onchainProposalId = parsedOnchainProposalId
    }

    const useVaultContract = Boolean(selectedVault.contractAddress)
    const tempId = createTempId('proposal')
    const optimisticProposal: Proposal = {
      id: tempId,
      vaultApiId,
      contractAddress: selectedVault.contractAddress ?? null,
      title,
      description: description || 'No description provided.',
      destination: normalizedTransaction.destination,
      amountEth: normalizedTransaction.amountEth,
      amountWei: normalizedTransaction.amountWei,
      approvals: 0,
      threshold: selectedVault.threshold ?? 1,
      status: 'pending',
      submittedBy: connectedWalletAddress,
      updatedAt: 'Just now',
      signatureState: 'pending',
      currentStep: 0,
      signatures: [],
      approvalRecords: [],
      signatureAuditLog: [],
      signaturePublicKeys: [],
      approvalPublicKeys: [],
      approvalWalletAddresses: [],
      onchainProposalId: onchainProposalId ?? null,
      isPending: true,
    }

    startTransition(() => {
      setProposals((currentProposals) => [optimisticProposal, ...currentProposals])
      setSelectedProposalId(tempId)
      adjustVaultPendingApprovals(vaultApiId, 1)
    })

    try {
      const response = await runCreateProposal({
        vault_id: vaultApiId,
        title,
        description: description || undefined,
        destination: normalizedTransaction.destination,
        amount_eth: normalizedTransaction.amountEth,
        proposer_wallet_address: connectedWalletAddress,
        onchain_proposal_id: onchainProposalId,
        payload: {
          source: 'react-ui',
          created_from: 'dashboard',
          created_by_wallet: connectedWalletAddress,
          execution_mode: useVaultContract ? 'vault_contract' : 'direct_transfer',
        },
      })

      const mappedProposal = mapApiProposal(response.proposal ?? null)
      if (!mappedProposal) {
        throw new Error('Proposal was created, but the response was incomplete.')
      }

      startTransition(() => {
        setProposals((currentProposals) =>
          currentProposals.map((proposal) => (proposal.id === tempId ? mappedProposal : proposal)),
        )
        setSelectedProposalId(mappedProposal.id)
        setProposalForm((currentForm) => ({
          ...DEFAULT_PROPOSAL_FORM,
          vaultApiId: currentForm.vaultApiId,
        }))
        setApiNotice('Live proposals are now syncing from the backend.')
      })
      setIsProposalFlowOpen(false)

      addActivity('Proposal created', `${mappedProposal.title} was submitted to ${selectedVault.name}.`)
      pushToast({
        title: 'Proposal submitted',
        message: `${walletIdentityLabel} submitted ${mappedProposal.title} for PQC approvals.`,
        tone: 'success',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create proposal.'

      startTransition(() => {
        setProposals((currentProposals) =>
          currentProposals.filter((proposal) => proposal.id !== tempId),
        )
        adjustVaultPendingApprovals(vaultApiId, -1)
      })

      pushToast({
        title: 'Proposal creation failed',
        message,
        tone: 'error',
      })
    }
  }

  async function handleSignProposal(proposalId: string) {
    if (!ensureWalletReady('sign a proposal')) {
      return
    }

    if (signingProposalId === proposalId) {
      return
    }

    const connectedWalletAddress = walletAddress
    if (!connectedWalletAddress) {
      return
    }

    const proposal = proposals.find((candidate) => candidate.id === proposalId)

    if (!proposal?.apiId || !proposal.vaultApiId) {
      pushToast({
        title: 'Live proposal required',
        message: 'Create a vault and proposal through the backend before signing with PQC.',
        tone: 'error',
      })
      return
    }

    if (proposal.status === 'executed') {
      pushToast({
        title: 'Proposal already executed',
        message: 'Executed proposals cannot be signed again.',
        tone: 'error',
      })
      return
    }

    if (proposal.status === 'approved') {
      pushToast({
        title: 'Threshold already met',
        message: 'This proposal is already approved and ready to execute.',
        tone: 'error',
      })
      return
    }

    if (
      getSignatureForWallet(proposal, connectedWalletAddress) ||
      hasWalletApprovedProposal(proposal, connectedWalletAddress)
    ) {
      pushToast({
        title: 'Signature already recorded',
        message: 'This wallet has already signed or approved the proposal.',
        tone: 'error',
      })
      return
    }

    const selectedAlgorithm = getSelectedAlgorithmForProposal(proposal, connectedWalletAddress)
    const signer = getNextSignerForProposal(proposal, connectedWalletAddress)
    if (!signer?.publicKey) {
      pushToast({
        title: 'No signer available',
        message: 'This wallet is not registered as a vault admin for this proposal.',
        tone: 'error',
      })
      return
    }

    setSigningProposalId(proposalId)
    setProposalNotice(proposalId, {
      tone: 'info',
      title: 'Signing with PQC',
      message: 'Generating and verifying the proposal signature.',
    })

    try {
      const response = await runSignProposal({
        proposal_id: proposal.apiId,
        admin_public_key: signer.publicKey,
        algorithm: selectedAlgorithm,
        signer_wallet_address: connectedWalletAddress,
      })

      const mappedProposal = mapApiProposal(response.proposal ?? null)
      if (!mappedProposal) {
        throw new Error('Signature was recorded, but the response was incomplete.')
      }

      setProposals((currentProposals) =>
        currentProposals.map((candidate) =>
          candidate.id === proposalId ? mappedProposal : candidate,
        ),
      )
      setSelectedProposalId(mappedProposal.id)
      recordBackendDebugEntry(mappedProposal.id, 'sign', response)
      if (response.verification) {
        recordBackendDebugEntry(mappedProposal.id, 'verify', response.verification)
      }
      setProposalNotice(mappedProposal.id, {
        tone: 'success',
        title: 'Signature verified',
        message: response.key_status
          ? `${response.key_status}. Approval is now enabled for this verified signature.`
          : 'Approval is now enabled for this verified signature.',
      })

      addActivity('Signature verified', `${walletIdentityLabel} signed ${mappedProposal.title}.`)
      pushToast({
        title: 'Signature verified',
        message: response.key_status
          ? `${walletIdentityLabel} used ${selectedAlgorithm} and ${response.key_status.toLowerCase()} for ${mappedProposal.title}.`
          : `${walletIdentityLabel} verified the PQC signature for ${mappedProposal.title}.`,
        tone: 'success',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign proposal.'
      setProposalNotice(proposalId, {
        tone: 'error',
        title: 'Signature failed',
        message,
      })

      pushToast({
        title: 'Signature failed',
        message,
        tone: 'error',
      })
    } finally {
      setSigningProposalId(null)
    }
  }

  async function handleApproveProposal(proposalId: string) {
    if (!ensureWalletReady('approve a proposal')) {
      return
    }

    if (approvingProposalId === proposalId) {
      return
    }

    const connectedWalletAddress = walletAddress
    if (!connectedWalletAddress) {
      return
    }

    const proposal = proposals.find((candidate) => candidate.id === proposalId)

    if (!proposal?.apiId) {
      pushToast({
        title: 'Live proposal required',
        message: 'Only backend-backed proposals can be approved.',
        tone: 'error',
      })
      return
    }

    if (proposal.status === 'executed') {
      pushToast({
        title: 'Proposal already executed',
        message: 'Executed proposals cannot receive more approvals.',
        tone: 'error',
      })
      return
    }

    if (proposal.status === 'approved') {
      pushToast({
        title: 'Threshold already met',
        message: 'This proposal is already approved and ready to execute.',
        tone: 'error',
      })
      return
    }

    const pendingSignature = getPendingVerifiedSignatureForWallet(proposal, connectedWalletAddress)
    if (!pendingSignature?.publicKey) {
      const message = hasWalletApprovedProposal(proposal, connectedWalletAddress)
        ? 'This wallet has already approved the current verified signature.'
        : 'Verify a PQC signature before approving the proposal.'

      pushToast({
        title: 'Approval locked',
        message,
        tone: 'error',
      })
      return
    }

    const crossedThreshold = proposal.approvals + 1 >= proposal.threshold && proposal.approvals < proposal.threshold

    setApprovingProposalId(proposalId)
    setProposalNotice(proposalId, {
      tone: 'info',
      title: 'Recording approval',
      message: 'Submitting the verified approval to the backend.',
    })

    try {
      const response: ApiApproveProposalResponse = await runApproveProposal({
        proposal_id: proposal.apiId,
        admin_public_key: pendingSignature.publicKey,
        approver_wallet_address: connectedWalletAddress,
      })

      const mappedProposal = mapApiProposal(response.proposal ?? null)
      if (!mappedProposal) {
        throw new Error('Approval was recorded, but the updated proposal payload was missing.')
      }

      setProposals((currentProposals) =>
        currentProposals.map((candidate) =>
          candidate.id === proposalId ? mappedProposal : candidate,
        ),
      )
      setSelectedProposalId(mappedProposal.id)
      recordBackendDebugEntry(mappedProposal.id, 'approve', response)

      if (crossedThreshold && proposal.vaultApiId) {
        adjustVaultPendingApprovals(proposal.vaultApiId, -1)
      }

      setProposalNotice(mappedProposal.id, {
        tone: 'success',
        title: 'Approval recorded',
        message:
          mappedProposal.status === 'approved'
            ? `Threshold reached. ${mappedProposal.title} is ready to execute.`
            : `${mappedProposal.approvals} / ${mappedProposal.threshold} approvals recorded.`,
      })

      addActivity('Approval recorded', `${walletIdentityLabel} approved ${mappedProposal.title}.`)
      pushToast({
        title: 'Approval recorded',
        message:
          mappedProposal.status === 'approved'
            ? `${mappedProposal.title} reached the approval threshold.`
            : `${walletIdentityLabel} approved ${mappedProposal.title}.`,
        tone: 'success',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to approve proposal.'
      setProposalNotice(proposalId, {
        tone: 'error',
        title: 'Approval failed',
        message,
      })

      pushToast({
        title: 'Approval failed',
        message,
        tone: 'error',
      })
    } finally {
      setApprovingProposalId(null)
    }
  }

  async function handleRegisterAllPqcAlgorithms(proposalId: string) {
    if (!ensureWalletReady('register PQC algorithms')) {
      return
    }

    const connectedWalletAddress = walletAddress
    if (!connectedWalletAddress) {
      return
    }

    const proposal = proposals.find((candidate) => candidate.id === proposalId)
    if (!proposal?.vaultApiId) {
      pushToast({
        title: 'Vault required',
        message: 'Select a live proposal before registering PQC algorithms.',
        tone: 'error',
      })
      return
    }

    if (!getNextSignerForProposal(proposal, connectedWalletAddress)?.publicKey) {
      pushToast({
        title: 'Wallet not registered',
        message: 'This wallet must be registered as a vault admin before PQC keys can be generated.',
        tone: 'error',
      })
      return
    }

    setProposalNotice(proposalId, {
      tone: 'info',
      title: 'Registering PQC algorithms',
      message: 'Generating any missing Dilithium, Falcon, and SPHINCS+ keys for this wallet.',
    })

    try {
      const response: ApiRegisterWalletPqcResponse = await runRegisterWalletPqcAlgorithms({
        vault_id: proposal.vaultApiId,
        wallet_address: connectedWalletAddress,
      })

      recordBackendDebugEntry(proposalId, 'register-pqc-wallet', response)
      const generatedCount = (response.registrations ?? []).filter((entry) => entry.key_generated).length
      setProposalNotice(proposalId, {
        tone: 'success',
        title: 'PQC algorithms ready',
        message:
          generatedCount > 0
            ? `${generatedCount} new key${generatedCount === 1 ? '' : 's'} generated for this wallet.`
            : 'All wallet algorithms were already registered.',
      })
      pushToast({
        title: 'PQC algorithms ready',
        message:
          generatedCount > 0
            ? `Generated ${generatedCount} missing PQC key${generatedCount === 1 ? '' : 's'} for ${walletIdentityLabel}.`
            : `All PQC algorithms are already registered for ${walletIdentityLabel}.`,
        tone: 'success',
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to register PQC algorithms for this wallet.'
      setProposalNotice(proposalId, {
        tone: 'error',
        title: 'Registration failed',
        message,
      })
      pushToast({
        title: 'Registration failed',
        message,
        tone: 'error',
      })
    }
  }

  async function handleExecuteProposal(proposalId: string) {
    if (!ensureWalletReady('execute a proposal')) {
      return
    }

    const connectedWalletAddress = walletAddress
    if (!connectedWalletAddress) {
      return
    }

    if (executingProposalId === proposalId) {
      return
    }

    const proposal = proposals.find((candidate) => candidate.id === proposalId)

    if (!proposal?.apiId) {
      pushToast({
        title: 'Live proposal required',
        message: 'Only backend-backed proposals can be executed onchain.',
        tone: 'error',
      })
      return
    }

    if (proposal.status === 'executed') {
      pushToast({
        title: 'Proposal already executed',
        message: 'This proposal has already been executed onchain.',
        tone: 'error',
      })
      setProposalNotice(proposalId, {
        tone: 'info',
        title: 'Already executed',
        message: 'The backend reports that this proposal has already been executed.',
      })
      return
    }

    if (proposal.status !== 'approved') {
      pushToast({
        title: 'Proposal not ready',
        message: 'This proposal needs to reach the approval threshold before execution.',
        tone: 'error',
      })
      return
    }

    setExecutingProposalId(proposalId)
    setProposalNotice(proposalId, {
      tone: 'info',
      title: 'Executing...',
      message: 'Submitting the blockchain transaction and waiting for confirmation.',
    })

    try {
      const response: ApiExecuteProposalResponse = await runExecuteProposal(
        proposal.apiId,
        connectedWalletAddress,
      )
      const mappedProposal = mapApiProposal(response.proposal ?? null)
      if (!mappedProposal) {
        throw new Error('Execution completed, but the updated proposal payload was missing.')
      }

      setProposals((currentProposals) =>
        currentProposals.map((candidate) =>
          candidate.id === proposalId ? mappedProposal : candidate,
        ),
      )
      setSelectedProposalId(mappedProposal.id)
      recordBackendDebugEntry(mappedProposal.id, 'execute', response)

      const transactionHash = response.transaction_hash ?? mappedProposal.executionTxHash ?? ''
      setProposalNotice(mappedProposal.id, {
        tone: 'success',
        title: 'Transaction successful',
        message: transactionHash
          ? `Confirmed on ${mappedProposal.network ?? 'the network'} with ${truncateHash(transactionHash, 10, 8)}.`
          : 'The transaction completed successfully.',
      })
      addActivity(
        'Proposal executed',
        transactionHash
          ? `${mappedProposal.title} was executed onchain in ${truncateHash(transactionHash, 10, 8)}.`
          : `${mappedProposal.title} was executed onchain.`,
      )
      pushToast({
        title: 'Execution confirmed',
        message: transactionHash
          ? `Transaction ${truncateHash(transactionHash, 10, 8)} was submitted to ${mappedProposal.network ?? 'the network'}.`
          : `${mappedProposal.title} is now marked as Executed.`,
        tone: 'success',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to execute proposal.'
      setProposalNotice(proposalId, {
        tone: 'error',
        title: 'Execution failed',
        message,
      })

      if (message.toLowerCase().includes('already been executed')) {
        try {
          const response = await loadProposals()
          const mapped = response.proposals
            .map((candidate) => mapApiProposal(candidate))
            .filter((candidate): candidate is Proposal => candidate !== null)

          setProposals(mapped)
          setSelectedProposalId((currentId) =>
            currentId && mapped.some((candidate) => candidate.id === currentId) ? currentId : null,
          )
        } catch {
          // Keep the current UI state if the sync request fails.
        }
      }

      pushToast({
        title: 'Execution failed',
        message,
        tone: 'error',
      })
    } finally {
      setExecutingProposalId(null)
    }
  }

  const liveVaultOptions = vaults.filter((vault) => vault.apiId)
  const selectedProposal = selectedProposalId
    ? proposals.find((proposal) => proposal.id === selectedProposalId) ?? null
    : null
  const selectedVault = selectedProposal
    ? vaults.find((vault) => vault.apiId === selectedProposal.vaultApiId) ?? null
    : null
  const summaryVault = selectedVault ?? liveVaultOptions[0] ?? vaults[0] ?? null
  const selectedProposalExplorerUrl = getExplorerUrl(
    selectedProposal?.network ?? selectedVault?.network,
    selectedProposal?.executionTxHash,
  )
  const selectedProposalWalletSignature = selectedProposal
    ? getSignatureForWallet(selectedProposal, walletAddress)
    : null
  const selectedProposalPendingSignature = selectedProposal
    ? getPendingVerifiedSignatureForWallet(selectedProposal, walletAddress)
    : null
  const selectedProposalHasApproved = selectedProposal
    ? hasWalletApprovedProposal(selectedProposal, walletAddress)
    : false
  const selectedProposalAvailableAlgorithms = selectedProposal
    ? getAvailableAlgorithmsForProposal(selectedProposal, walletAddress)
    : pqcAlgorithms
  const selectedProposalAlgorithm = selectedProposal
    ? getSelectedAlgorithmForProposal(selectedProposal, walletAddress)
    : pqcAlgorithms[0]?.name ?? DEFAULT_PQC_ALGORITHMS[0].name
  const selectedProposalHasSigner = selectedProposal
    ? Boolean(getNextSignerForProposal(selectedProposal, walletAddress)?.publicKey)
    : false
  const selectedProposalSignatureState: SignatureState = selectedProposalPendingSignature || selectedProposalHasApproved
    ? 'verified'
    : selectedProposalWalletSignature && !selectedProposalWalletSignature.isVerified
      ? 'failed'
      : 'pending'
  const selectedProposalCanSign = Boolean(
    selectedProposal &&
      selectedProposal.status === 'pending' &&
      !selectedProposalWalletSignature &&
      !selectedProposalHasApproved &&
      !selectedProposalPendingSignature &&
      selectedProposalHasSigner,
  )
  const selectedProposalCanApprove = Boolean(
    selectedProposal &&
      selectedProposal.status === 'pending' &&
      selectedProposalPendingSignature,
  )
  const selectedProposalCanRegisterAlgorithms = Boolean(
    selectedProposal &&
      selectedProposal.status === 'pending' &&
      getNextSignerForProposal(selectedProposal, walletAddress)?.publicKey,
  )
  const selectedProposalCanExecute = Boolean(
    selectedProposal &&
      selectedProposal.status === 'approved' &&
      selectedProposal.apiId,
  )
  const selectedProposalSignLabel =
    selectedProposal?.status === 'executed'
      ? 'Executed'
      : selectedProposal?.status === 'approved'
        ? 'Signing Closed'
      : selectedProposalSignatureState === 'verified'
      ? 'Signature Verified'
      : selectedProposalSignatureState === 'failed'
        ? 'Signature Failed'
      : selectedProposalHasSigner
        ? 'Sign with PQC'
        : 'No signer available'
  const selectedProposalApproveLabel =
    selectedProposalHasApproved || selectedProposal?.status === 'executed'
      ? 'Approved'
      : selectedProposal?.status === 'approved'
        ? 'Threshold Met'
      : 'Approve'
  const selectedProposalExecuteLabel =
    selectedProposal?.status === 'executed' ? 'Executed' : 'Execute'
  const selectedProposalAlgorithmOption =
    pqcAlgorithms.find((algorithm) => algorithm.name === selectedProposalAlgorithm) ??
    DEFAULT_PQC_ALGORITHMS.find((algorithm) => algorithm.name === selectedProposalAlgorithm) ??
    null
  const selectedProposalAlgorithmLabel =
    selectedProposalAlgorithmOption?.label ?? selectedProposalAlgorithm
  const selectedProposalCanUseSelectedAlgorithm =
    selectedProposalAvailableAlgorithms.some((algorithm) => algorithm.name === selectedProposalAlgorithm)
  const walletGateMode = !walletAddress ? 'connect' : !isOnSepolia ? 'switch' : null
  const greeting = getGreeting()
  const aggregateVaultBalance = formatAggregateBalance(vaults)
  const readyToExecuteCount = proposals.filter((proposal) => proposal.status === 'approved').length
  const pendingApprovalsCount = vaults.reduce((sum, vault) => sum + vault.pendingApprovals, 0)
  const signableProposals = proposals.filter(
    (proposal) =>
      Boolean(
        proposal.apiId &&
          proposal.vaultApiId &&
          proposal.status === 'pending' &&
          !getSignatureForWallet(proposal, walletAddress) &&
          !hasWalletApprovedProposal(proposal, walletAddress) &&
          !getPendingVerifiedSignatureForWallet(proposal, walletAddress) &&
          getNextSignerForProposal(proposal, walletAddress)?.publicKey,
      ),
  )
  const approvableProposals = proposals.filter(
    (proposal) =>
      Boolean(
        proposal.apiId &&
          proposal.status === 'pending' &&
          getPendingVerifiedSignatureForWallet(proposal, walletAddress),
      ),
  )
  const executableProposals = proposals.filter(
    (proposal) => Boolean(proposal.apiId && proposal.status === 'approved'),
  )
  const signableProposal = signableProposals[0] ?? null
  const approvableProposal = approvableProposals[0] ?? null
  const executableProposal = executableProposals[0] ?? null
  const recentProposalList = proposals.slice(0, 4)

  function openCreateVaultModal() {
    if (!ensureWalletReady('create a vault')) {
      return
    }

    setIsCreateVaultOpen(true)
  }

  function openProposalFlowModal() {
    if (!ensureWalletReady('create a proposal')) {
      return
    }

    if (liveVaultOptions.length === 0) {
      pushToast({
        title: 'Vault required',
        message: 'Create a vault first so the transfer flow has a live destination.',
        tone: 'error',
      })
      return
    }

    setProposalForm((currentForm) => ({
      ...currentForm,
      vaultApiId: currentForm.vaultApiId || String(liveVaultOptions[0]?.apiId ?? ''),
    }))
    setIsProposalFlowOpen(true)
  }

  function focusProposalForAction(
    proposal: Proposal | null,
    emptyStateTitle: string,
    emptyStateMessage: string,
    requiredAction: string,
  ) {
    if (!ensureWalletReady(requiredAction)) {
      return
    }

    if (!proposal) {
      pushToast({
        title: emptyStateTitle,
        message: emptyStateMessage,
        tone: 'error',
      })
      return
    }

    setSelectedProposalId(proposal.id)
    setActiveSection('Dashboard')
  }

  useEffect(() => {
    if (!selectedProposal) {
      return
    }

    console.log('[PQC Debug] Selected algorithm', {
      proposalId: selectedProposal.id,
      algorithm: selectedProposalAlgorithmLabel,
      walletAddress: walletAddress ?? 'Not connected',
    })
  }, [selectedProposal?.id, selectedProposalAlgorithmLabel, walletAddress])

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 transition-colors duration-200 dark:bg-slate-950 dark:text-gray-200">
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />

      <CreateVaultModal
        isOpen={isCreateVaultOpen}
        onClose={() => setIsCreateVaultOpen(false)}
        form={vaultForm}
        onFieldChange={updateVaultFormField}
        onSubmit={handleCreateVaultSubmit}
        loading={createVaultLoading}
      />

      <ProposalFlowModal
        isOpen={isProposalFlowOpen}
        onClose={() => setIsProposalFlowOpen(false)}
        form={proposalForm}
        vaultOptions={liveVaultOptions}
        onFieldChange={updateProposalFormField}
        onSubmit={handleCreateProposalSubmit}
        loading={createProposalLoading}
      />

      <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/90 backdrop-blur-xl dark:border-gray-800 dark:bg-slate-950/85">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <AppMark />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-600 dark:text-blue-300">
                  Quantum-safe treasury
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                  PQC Vault
                </h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 shadow-md dark:border-gray-700 dark:bg-slate-900">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                  Wallet
                </p>
                <p
                  className="mt-1 font-mono text-sm font-semibold text-gray-900 dark:text-gray-100"
                  title={walletAddress ?? undefined}
                >
                  {formatCompactWallet(walletAddress)}
                </p>
              </div>

              <ThemeToggle
                theme={theme}
                onToggle={() => {
                  setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'))
                }}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {navItems.map((item) => (
              <DashboardTab
                key={item}
                label={item}
                active={activeSection === item}
                onClick={() => setActiveSection(item)}
              />
            ))}
          </div>
        </div>
      </header>

        {selectedProposal ? (
          <ProposalModal
            proposal={selectedProposal}
            vaultName={selectedVault?.name ?? 'Unknown vault'}
            explorerUrl={selectedProposalExplorerUrl}
            currentWalletAddress={walletAddress}
            selectedAlgorithmLabel={selectedProposalAlgorithmLabel}
            isSelectedAlgorithmAvailable={selectedProposalCanUseSelectedAlgorithm}
            onClose={() => setSelectedProposalId(null)}
            onSign={() => {
              void handleSignProposal(selectedProposal.id)
            }}
            onApprove={() => {
              void handleApproveProposal(selectedProposal.id)
            }}
            onRegisterAllAlgorithms={() => {
              void handleRegisterAllPqcAlgorithms(selectedProposal.id)
            }}
            onExecute={() => {
              void handleExecuteProposal(selectedProposal.id)
            }}
            signLoading={Boolean(signingProposalId === selectedProposal.id && signProposalLoading)}
            approveLoading={Boolean(
              approvingProposalId === selectedProposal.id && approveProposalLoading,
            )}
            registerAllLoading={Boolean(registerWalletPqcAlgorithmsLoading)}
            executeLoading={Boolean(
              executingProposalId === selectedProposal.id && executeProposalLoading,
            )}
            signDisabled={
              !selectedProposalCanSign ||
              Boolean(
                signingProposalId === selectedProposal.id ||
                  approvingProposalId === selectedProposal.id ||
                  executingProposalId === selectedProposal.id,
              )
            }
            approveDisabled={
              !selectedProposalCanApprove ||
              Boolean(
                signingProposalId === selectedProposal.id ||
                  approvingProposalId === selectedProposal.id ||
                  executingProposalId === selectedProposal.id,
              )
            }
            registerAllDisabled={
              !selectedProposalCanRegisterAlgorithms ||
              Boolean(
                signingProposalId === selectedProposal.id ||
                  approvingProposalId === selectedProposal.id ||
                  executingProposalId === selectedProposal.id ||
                  registerWalletPqcAlgorithmsLoading,
              )
            }
            executeDisabled={
              !selectedProposalCanExecute ||
              Boolean(
                signingProposalId === selectedProposal.id ||
                  approvingProposalId === selectedProposal.id ||
                  executingProposalId === selectedProposal.id,
              )
            }
            signLabel={signingProposalId === selectedProposal.id ? 'Signing...' : selectedProposalSignLabel}
            approveLabel={approvingProposalId === selectedProposal.id ? 'Approving...' : selectedProposalApproveLabel}
            executeLabel={executingProposalId === selectedProposal.id ? 'Executing...' : selectedProposalExecuteLabel}
            currentWalletSignatureState={selectedProposalSignatureState}
            pqcAlgorithms={pqcAlgorithms}
            availablePqcAlgorithms={selectedProposalAvailableAlgorithms}
            selectedPqcAlgorithm={selectedProposalAlgorithm}
            onSelectPqcAlgorithm={(algorithm) => {
              console.log('[PQC Debug] Algorithm changed', {
                proposalId: selectedProposal.id,
                walletAddress: walletAddress ?? 'Not connected',
                algorithm,
              })
              setSelectedPqcAlgorithms((currentAlgorithms) => ({
                ...currentAlgorithms,
                [getAlgorithmSelectionKey(selectedProposal.id, walletAddress)]: algorithm,
              }))
            }}
            debugEntries={backendDebugEntries[selectedProposal.id] ?? []}
            isDebugVisible={isBackendDebugVisible}
            onToggleDebug={() => setIsBackendDebugVisible((isVisible) => !isVisible)}
            notice={proposalNotices[selectedProposal.id] ?? null}
          />
        ) : null}

        <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6"
      >
        <div className="space-y-6">
          {walletGateMode ? (
            <section className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-md dark:border-gray-700 dark:bg-slate-900">
              <p className="text-sm font-medium text-blue-600 dark:text-cyan-400">Wallet access</p>
              <h1 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {walletGateMode === 'connect'
                  ? 'Connect MetaMask to unlock the dashboard'
                  : `Switch MetaMask to ${SEPOLIA_NETWORK_NAME}`}
              </h1>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                {walletGateMode === 'connect'
                  ? 'The app stays inactive until a wallet is connected. Once connected, your wallet becomes the admin identity for proposal creation and approval actions.'
                  : `All treasury actions are restricted to ${SEPOLIA_NETWORK_NAME}. Switch your connected wallet before creating, signing, or executing proposals.`}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={walletGateMode === 'connect' ? handleConnectWallet : handleSwitchNetwork}
                  disabled={
                    !hasMetaMask ||
                    (walletGateMode === 'connect'
                      ? walletActionLoading === 'connect'
                      : walletActionLoading === 'switch')
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-cyan-400 dark:text-slate-950 dark:hover:bg-cyan-300"
                >
                  {(walletActionLoading === 'connect' && walletGateMode === 'connect') ||
                  (walletActionLoading === 'switch' && walletGateMode === 'switch') ? (
                    <LoadingSpinner className="h-4 w-4" />
                  ) : null}
                  {walletGateMode === 'connect' ? 'Connect Wallet' : 'Switch Network'}
                </button>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-slate-800/80">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Current wallet</p>
                  <p className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{walletIdentityLabel}</p>
                  {walletAddress ? (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {walletEthBalance ? `Balance ${walletEthBalance}` : 'Balance loading'}
                    </p>
                  ) : null}
                </div>
              </div>

              {!hasMetaMask ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                  MetaMask was not detected in this browser. Install it, refresh the page, and connect your wallet.
                </div>
              ) : null}
            </section>
          ) : (
            <>
              {apiNotice ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 shadow-md dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-300">
                  {apiNotice}
                </div>
              ) : null}

          {activeSection === 'Dashboard' ? (
            <>
              <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-md dark:border-gray-700 dark:bg-slate-900">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-300">
                      {greeting}
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                      Welcome back
                    </h2>
                    <p className="mt-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                      Connected wallet
                    </p>
                    <p className="mt-1 break-all font-mono text-sm text-gray-900 dark:text-gray-100">
                      {walletAddress ?? walletIdentityLabel}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-gray-50 p-4 dark:bg-slate-800/80 lg:min-w-[280px]">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Vault balance</p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                      {aggregateVaultBalance}
                    </p>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      {summaryVault
                        ? `${summaryVault.name} on ${summaryVault.network}`
                        : 'Create a vault to start tracking treasury balances.'}
                    </p>
                  </div>
                </div>
              </section>

              <WidgetShell
                title="Quick actions"
                subtitle="Launch the existing vault, proposal, signing, approval, and execution flows from one place."
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <QuickActionCard
                    icon={<VaultIcon />}
                    title="Create Vault"
                    description="Open the current vault creation flow and configure admins, thresholds, and contract deployment."
                    meta={`${vaults.length} live`}
                    onClick={openCreateVaultModal}
                  />
                  <QuickActionCard
                    icon={<ProposalIcon />}
                    title="Create Proposal"
                    description="Start a transaction proposal using the existing proposal modal and live vault list."
                    meta={liveVaultOptions.length > 0 ? `${liveVaultOptions.length} vaults` : 'Vault required'}
                    onClick={openProposalFlowModal}
                  />
                  <QuickActionCard
                    icon={<SignIcon />}
                    title="Sign"
                    description="Jump into the next proposal that is waiting for your PQC signature."
                    meta={signableProposals.length > 0 ? `${signableProposals.length} ready` : 'No queue'}
                    onClick={() =>
                      focusProposalForAction(
                        signableProposal,
                        'No signable proposal',
                        'There are no proposals awaiting your PQC signature right now.',
                        'sign a proposal',
                      )
                    }
                  />
                  <QuickActionCard
                    icon={<ApproveIcon />}
                    title="Approve"
                    description="Open the next verified proposal so you can record the existing approval step."
                    meta={approvableProposals.length > 0 ? `${approvableProposals.length} ready` : `${pendingApprovalsCount} pending`}
                    onClick={() =>
                      focusProposalForAction(
                        approvableProposal,
                        'No approvable proposal',
                        'There are no proposals with a verified signature ready for approval.',
                        'approve a proposal',
                      )
                    }
                  />
                  <QuickActionCard
                    icon={<ExecuteIcon />}
                    title="Execute"
                    description="Go straight to the next threshold-approved proposal and run the existing execute flow."
                    meta={executableProposals.length > 0 ? `${readyToExecuteCount} ready` : 'Threshold pending'}
                    onClick={() =>
                      focusProposalForAction(
                        executableProposal,
                        'Nothing to execute',
                        'There are no approved proposals ready for on-chain execution.',
                        'execute a proposal',
                      )
                    }
                  />
                </div>
              </WidgetShell>

              <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <WidgetShell
                  title="Recent proposals"
                  subtitle="Review the latest transaction requests and open any card to continue the existing proposal flow."
                  action={proposalsLoading ? <LoadingSpinner /> : null}
                >
                  {proposalsError ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
                      {proposalsError}
                    </div>
                  ) : null}

                  <div className="space-y-4">
                    {recentProposalList.length > 0 ? (
                      recentProposalList.map((proposal) => (
                        <ProposalCard
                          key={proposal.id}
                          proposal={proposal}
                          isActive={proposal.id === selectedProposalId}
                          onOpen={handleOpenProposal}
                        />
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-600 dark:bg-slate-800/70 dark:text-gray-400">
                        No proposals yet.
                      </div>
                    )}
                  </div>
                </WidgetShell>

                <WidgetShell
                  title="Vault overview"
                  subtitle="Track the vaults already linked to the current dashboard session."
                  action={vaultsLoading ? <LoadingSpinner /> : null}
                >
                  <div className="grid gap-4">
                    {vaults.length > 0 ? (
                      vaults.map((vault) => <VaultCard key={vault.id} vault={vault} />)
                    ) : (
                      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-600 dark:bg-slate-800/70 dark:text-gray-400">
                        No vaults yet.
                      </div>
                    )}
                  </div>
                </WidgetShell>
              </section>

              <WidgetShell
                title="Recent activity"
                subtitle="A lightweight audit trail for vault creation, proposal signing, approvals, and execution."
              >
                <div className="space-y-3">
                  {activity.length > 0 ? (
                    activity.slice(0, 5).map((item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-slate-800/70"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.title}</p>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                              {item.description}
                            </p>
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{item.time}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-600 dark:bg-slate-800/70 dark:text-gray-400">
                      Activity will appear here after you start using the dashboard.
                    </div>
                  )}
                </div>
              </WidgetShell>
            </>
          ) : null}

          {activeSection === 'Proposals' ? (
            <WidgetShell
              title="Proposals"
              subtitle="Click any proposal card to review it, sign it, approve it, or execute it in the existing popup flow."
              action={proposalsLoading ? <LoadingSpinner /> : null}
            >
              {proposalsError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
                  {proposalsError}
                </div>
              ) : null}

              <div className="space-y-4">
                {proposals.length > 0 ? (
                  proposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      isActive={proposal.id === selectedProposalId}
                      onOpen={handleOpenProposal}
                    />
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-600 dark:bg-slate-800/70 dark:text-gray-400">
                    No proposals available yet.
                  </div>
                )}
              </div>
            </WidgetShell>
          ) : null}

          {activeSection === 'Vaults' ? (
            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <WidgetShell
                title="Vaults"
                subtitle="Treasury configurations created in this session."
                action={vaultsLoading ? <LoadingSpinner /> : null}
              >
                <div className="grid gap-4 xl:grid-cols-2">
                  {vaults.length > 0 ? (
                    vaults.map((vault) => <VaultCard key={vault.id} vault={vault} />)
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-600 dark:bg-slate-800/70 dark:text-gray-400 xl:col-span-2">
                      No vaults yet.
                    </div>
                  )}
                </div>
              </WidgetShell>

              <WidgetShell
                title="System status"
                subtitle="Current wallet, network, backend state, and selected vault context."
              >
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl bg-gray-50 p-4 dark:bg-slate-800/80">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Wallet identity</p>
                    <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                      {walletAddress ?? 'Not connected'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4 dark:bg-slate-800/80">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Network</p>
                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{networkLabel}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4 dark:bg-slate-800/80">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Backend sync</p>
                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                      {apiNotice ?? 'Waiting for a live backend update.'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4 dark:bg-slate-800/80">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Current vault</p>
                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                      {summaryVault?.name ?? 'No vault selected'}
                    </p>
                  </div>
                </div>
              </WidgetShell>
            </section>
          ) : null}
            </>
          )}
        </div>
      </motion.main>
    </div>
  )
}
