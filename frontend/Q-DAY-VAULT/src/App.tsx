import { motion } from 'framer-motion'
import { startTransition, useEffect, useRef, useState } from 'react'

import {
  approveProposal,
  createProposal,
  createVault,
  executeProposal,
  getProposals,
  signProposal,
  useApiRequest,
} from './api.js'
import { initialActivity, initialProposals, initialVaults, navItems } from './data'
import { LoadingSpinner } from './components/LoadingSpinner'
import { ProposalCard } from './components/ProposalCard'
import { ProposalModal } from './components/ProposalModal'
import { Sidebar } from './components/Sidebar'
import { ThemeToggle } from './components/ThemeToggle'
import { ToastViewport } from './components/ToastViewport'
import { VaultCard } from './components/VaultCard'
import { validateProposalTransaction } from './lib/ethereum'
import {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_NETWORK_NAME,
  clearWalletSession,
  formatWalletAddress,
  getEthereumProvider,
  getWalletErrorMessage,
  isSepoliaChainId,
  persistWalletSession,
  readWalletSession,
  resolveChainId,
  resolvePrimaryAccount,
} from './lib/wallet'
import { applyTheme, resolveInitialTheme } from './theme'

import type {
  ApiApproveProposalResponse,
  ApiExecuteProposalResponse,
  ApiCreateVaultResponse,
  ApiGeneratedAdminKey,
  ApiPayload,
  ApiProposalResponse,
} from './api.js'
import type { FormEvent } from 'react'
import type {
  ActivityItem,
  AdminCredential,
  NavItem,
  Proposal,
  ProposalStatus,
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

type WalletAction = 'connect' | 'switch' | null

type VaultFormState = {
  name: string
  adminCount: string
  threshold: string
}

type ProposalFormState = {
  vaultApiId: string
  title: string
  description: string
  recipientAddress: string
  amountEth: string
}

const DEFAULT_VAULT_FORM: VaultFormState = {
  name: '',
  adminCount: '3',
  threshold: '2',
}

const DEFAULT_PROPOSAL_FORM: ProposalFormState = {
  vaultApiId: '',
  title: '',
  description: '',
  recipientAddress: '',
  amountEth: '',
}

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

function mapGeneratedAdminKey(key: ApiGeneratedAdminKey, fallbackIndex: number): AdminCredential {
  return {
    name: key.name ?? `Admin ${fallbackIndex + 1}`,
    publicKey: key.public_key ?? '',
    privateKey: key.private_key ?? '',
    algorithm: key.algorithm ?? 'Dilithium2',
    keyFile: key.key_file,
  }
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
    return 3
  }

  if (status === 'approved') {
    return 2
  }

  if (hasVerifiedSignature) {
    return 1
  }

  return 0
}

function mapApiVault(response: ApiCreateVaultResponse): Vault | null {
  if (!response.vault?.id) {
    return null
  }

  return {
    id: `vault-${response.vault.id}`,
    apiId: response.vault.id,
    name: response.vault.name ?? `Vault ${response.vault.id}`,
    balance: '$0.00',
    adminCount: response.vault.admins?.length ?? response.generated_admin_keys?.length ?? 0,
    network: response.vault.network ?? 'Backend tracked',
    contractAddress: response.vault.contract_address,
    pendingApprovals: 0,
    threshold: response.vault.threshold,
    generatedAdminKeys: (response.generated_admin_keys ?? []).map(mapGeneratedAdminKey),
  }
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
        walletAddress: approval.wallet_address ?? null,
        createdAt: approval.created_at ?? null,
      }))
      .filter((approval) => Boolean(approval.publicKey)),
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
    executionTxHash: proposal.execution_tx_hash,
  }
}

export default function App() {
  const initialWalletSession = readWalletSession()
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme())
  const [activeSection, setActiveSection] = useState<NavItem>('Dashboard')
  const [vaults, setVaults] = useState<Vault[]>(initialVaults)
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals)
  const [activity, setActivity] = useState<ActivityItem[]>(initialActivity)
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(initialWalletSession.address)
  const [walletChainId, setWalletChainId] = useState<string | null>(initialWalletSession.chainId)
  const [walletActionLoading, setWalletActionLoading] = useState<WalletAction>(null)
  const [vaultForm, setVaultForm] = useState<VaultFormState>(DEFAULT_VAULT_FORM)
  const [proposalForm, setProposalForm] = useState<ProposalFormState>(DEFAULT_PROPOSAL_FORM)
  const [apiNotice, setApiNotice] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [proposalNotices, setProposalNotices] = useState<Record<string, ProposalNotice>>({})
  const [signingProposalId, setSigningProposalId] = useState<string | null>(null)
  const [approvingProposalId, setApprovingProposalId] = useState<string | null>(null)
  const [executingProposalId, setExecutingProposalId] = useState<string | null>(null)
  const toastTimeoutsRef = useRef<number[]>([])

  const {
    run: loadProposals,
    loading: proposalsLoading,
    error: proposalsError,
  } = useApiRequest(getProposals)
  const { run: runCreateVault, loading: createVaultLoading } = useApiRequest(createVault)
  const { run: runCreateProposal, loading: createProposalLoading } = useApiRequest(createProposal)
  const { run: runSignProposal, loading: signProposalLoading } = useApiRequest(signProposal)
  const { run: runApproveProposal, loading: approveProposalLoading } = useApiRequest(approveProposal)
  const { run: runExecuteProposal, loading: executeProposalLoading } = useApiRequest(executeProposal)
  const ethereumProvider = getEthereumProvider()
  const hasMetaMask = Boolean(ethereumProvider)
  const isWalletConnected = Boolean(walletAddress)
  const isOnSepolia = isSepoliaChainId(walletChainId)
  const walletIdentityLabel = formatWalletAddress(walletAddress)
  const networkLabel = !hasMetaMask
    ? 'MetaMask required'
    : !walletAddress
      ? 'Not connected'
      : isOnSepolia
        ? SEPOLIA_NETWORK_NAME
        : 'Wrong network'
  const canUseWalletActions = isWalletConnected && isOnSepolia

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const timeoutIds = toastTimeoutsRef.current

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
    }
  }, [])

  useEffect(() => {
    if (!ethereumProvider) {
      updateWalletSession(null, null)
      return
    }

    const provider = ethereumProvider

    let cancelled = false

    async function syncWalletFromProvider() {
      try {
        const [accountsResult, chainIdResult] = await Promise.all([
          provider.request({ method: 'eth_accounts' }),
          provider.request({ method: 'eth_chainId' }),
        ])

        if (cancelled) {
          return
        }

        updateWalletSession(resolvePrimaryAccount(accountsResult), resolveChainId(chainIdResult))
      } catch {
        if (!cancelled) {
          updateWalletSession(null, null)
        }
      }
    }

    function handleAccountsChanged() {
      void syncWalletFromProvider()
    }

    function handleChainChanged() {
      void syncWalletFromProvider()
    }

    void syncWalletFromProvider()
    provider.on?.('accountsChanged', handleAccountsChanged)
    provider.on?.('chainChanged', handleChainChanged)

    return () => {
      cancelled = true
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
      provider.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [ethereumProvider])

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

    async function hydrateProposals() {
      try {
        const response = await loadProposals()
        if (cancelled) {
          return
        }

        const mapped = response.proposals
          .map((proposal) => mapApiProposal(proposal))
          .filter((proposal): proposal is Proposal => proposal !== null)

        startTransition(() => {
          if (mapped.length > 0) {
            setProposals(mapped)
            setSelectedProposalId((currentId) =>
              currentId && mapped.some((proposal) => proposal.id === currentId) ? currentId : null,
            )
            setApiNotice('Live proposals loaded from FastAPI.')
          } else {
            setProposals([])
            setSelectedProposalId(null)
            setApiNotice('Backend is live, but there are no proposals yet.')
          }
        })
      } catch {
        if (!cancelled) {
          setApiNotice('Unable to reach the backend.')
        }
      }
    }

    void hydrateProposals()

    return () => {
      cancelled = true
    }
  }, [canUseWalletActions, loadProposals, walletAddress])

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

  function updateWalletSession(nextAddress: string | null, nextChainId: string | null) {
    setWalletAddress(nextAddress)
    setWalletChainId(nextChainId)

    if (nextAddress) {
      persistWalletSession({
        address: nextAddress,
        chainId: nextChainId,
      })
      return
    }

    clearWalletSession()
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

  function getNextSignerForProposal(proposal: Proposal) {
    const vault = vaults.find((candidate) => candidate.apiId === proposal.vaultApiId)
    const adminKeys = vault?.generatedAdminKeys ?? []
    const usedKeys = new Set(proposal.signaturePublicKeys ?? [])

    return adminKeys.find((admin) => !usedKeys.has(admin.publicKey))
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

  async function handleConnectWallet() {
    if (!ethereumProvider) {
      pushToast({
        title: 'MetaMask required',
        message: 'Install or enable MetaMask to connect a wallet.',
        tone: 'error',
      })
      return
    }

    const provider = ethereumProvider

    setWalletActionLoading('connect')

    try {
      const [accountsResult, chainIdResult] = await Promise.all([
        provider.request({ method: 'eth_requestAccounts' }),
        provider.request({ method: 'eth_chainId' }),
      ])
      const nextAddress = resolvePrimaryAccount(accountsResult)
      const nextChainId = resolveChainId(chainIdResult)

      if (!nextAddress) {
        throw new Error('MetaMask did not return an account.')
      }

      updateWalletSession(nextAddress, nextChainId)
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
    } finally {
      setWalletActionLoading(null)
    }
  }

  async function handleSwitchNetwork() {
    if (!ethereumProvider) {
      pushToast({
        title: 'MetaMask required',
        message: 'Install or enable MetaMask to switch networks.',
        tone: 'error',
      })
      return
    }

    const provider = ethereumProvider

    setWalletActionLoading('switch')

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      })
      const chainIdResult = await provider.request({ method: 'eth_chainId' })
      updateWalletSession(walletAddress, resolveChainId(chainIdResult))
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
    } finally {
      setWalletActionLoading(null)
    }
  }

  async function handleCreateVaultSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!ensureWalletReady('create a vault')) {
      return
    }

    const connectedWalletAddress = walletAddress
    if (!connectedWalletAddress) {
      return
    }

    const name = vaultForm.name.trim()
    const adminCount = Number(vaultForm.adminCount)
    const threshold = Number(vaultForm.threshold)

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

    const tempId = createTempId('vault')
    const optimisticVault: Vault = {
      id: tempId,
      name,
      balance: '$0.00',
      adminCount,
      network: 'Creating vault',
      pendingApprovals: 0,
      threshold,
      generatedAdminKeys: [],
      isPending: true,
    }

    setVaults((currentVaults) => [optimisticVault, ...currentVaults])

    try {
      const response = await runCreateVault({
        name,
        threshold,
        admins: Array.from({ length: adminCount }, (_, index) => ({
          name: `${connectedWalletAddress} PQC ${index + 1}`,
          generate_keypair: true,
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

      addActivity('Vault created', `${mappedVault.name} is ready for proposal submissions.`)
      pushToast({
        title: 'Vault created',
        message: `${walletIdentityLabel} created ${mappedVault.name} with ${mappedVault.adminCount} admins.`,
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

    const tempId = createTempId('proposal')
    const optimisticProposal: Proposal = {
      id: tempId,
      vaultApiId,
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
      signaturePublicKeys: [],
      approvalPublicKeys: [],
      approvalWalletAddresses: [],
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
        payload: {
          source: 'react-ui',
          created_from: 'dashboard',
          created_by_wallet: connectedWalletAddress,
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

    const signer = getNextSignerForProposal(proposal)
    if (!signer?.publicKey) {
      pushToast({
        title: 'No signer available',
        message: 'This vault does not have an unused generated admin key available for signing.',
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
        algorithm: signer.algorithm,
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
      setProposalNotice(mappedProposal.id, {
        tone: 'success',
        title: 'Signature verified',
        message: 'Approval is now enabled for this verified signature.',
      })

      addActivity('Signature verified', `${walletIdentityLabel} signed ${mappedProposal.title}.`)
      pushToast({
        title: 'Signature verified',
        message: `${walletIdentityLabel} verified the PQC signature for ${mappedProposal.title}.`,
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

  async function handleExecuteProposal(proposalId: string) {
    if (!ensureWalletReady('execute a proposal')) {
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
      const response: ApiExecuteProposalResponse = await runExecuteProposal(proposal.apiId)
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
  const selectedProposalHasSigner = selectedProposal
    ? Boolean(getNextSignerForProposal(selectedProposal)?.publicKey)
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
  const walletGateMode = !walletAddress ? 'connect' : !isOnSepolia ? 'switch' : null

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900 transition-colors duration-200 dark:bg-[#0B0F19] dark:text-gray-200">
      <Sidebar items={navItems} activeItem={activeSection} onSelect={setActiveSection} />

      <div className="flex min-w-0 flex-1 flex-col">
        <ToastViewport toasts={toasts} onDismiss={dismissToast} />

        <div className="border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-700 dark:bg-gray-900/90">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{activeSection}</p>
              <h1 className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">PQC Vault</h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Quantum-safe proposal approvals with onchain execution feedback.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2 lg:hidden">
                {navItems.map((item) => {
                  const isActive = item === activeSection

                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setActiveSection(item)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition duration-200 ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-cyan-400/10 dark:text-cyan-300'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-800 dark:hover:text-gray-100'
                      }`}
                    >
                      {item}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {walletAddress ? 'Connected wallet' : hasMetaMask ? 'Wallet disconnected' : 'MetaMask unavailable'}
                </p>
                <p className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400" title={walletAddress ?? undefined}>
                  {walletIdentityLabel}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{networkLabel}</p>
              </div>

              {!walletAddress ? (
                <button
                  type="button"
                  onClick={handleConnectWallet}
                  disabled={!hasMetaMask || walletActionLoading === 'connect'}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-cyan-400 dark:text-slate-950 dark:hover:bg-cyan-300"
                >
                  {walletActionLoading === 'connect' ? <LoadingSpinner className="h-4 w-4" /> : null}
                  Connect Wallet
                </button>
              ) : null}

              {walletAddress && !isOnSepolia ? (
                <button
                  type="button"
                  onClick={handleSwitchNetwork}
                  disabled={walletActionLoading === 'switch'}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 transition duration-200 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-950/40"
                >
                  {walletActionLoading === 'switch' ? <LoadingSpinner className="h-4 w-4" /> : null}
                  Switch Network
                </button>
              ) : null}

              <ThemeToggle
                theme={theme}
                onToggle={() => {
                  setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'))
                }}
              />
            </div>
          </div>
        </div>

        <ProposalModal
          proposal={selectedProposal}
          vaultName={selectedVault?.name ?? 'Unknown vault'}
          explorerUrl={selectedProposalExplorerUrl}
          onClose={() => setSelectedProposalId(null)}
          onSign={() => {
            if (selectedProposal) {
              void handleSignProposal(selectedProposal.id)
            }
          }}
          onApprove={() => {
            if (selectedProposal) {
              void handleApproveProposal(selectedProposal.id)
            }
          }}
          onExecute={() => {
            if (selectedProposal) {
              void handleExecuteProposal(selectedProposal.id)
            }
          }}
          signLoading={Boolean(selectedProposal && signingProposalId === selectedProposal.id && signProposalLoading)}
          approveLoading={Boolean(
            selectedProposal && approvingProposalId === selectedProposal.id && approveProposalLoading,
          )}
          executeLoading={Boolean(
            selectedProposal && executingProposalId === selectedProposal.id && executeProposalLoading,
          )}
          signDisabled={
            !selectedProposal ||
            !selectedProposalCanSign ||
            Boolean(
              signingProposalId === selectedProposal.id ||
                approvingProposalId === selectedProposal.id ||
                executingProposalId === selectedProposal.id,
            )
          }
          approveDisabled={
            !selectedProposal ||
            !selectedProposalCanApprove ||
            Boolean(
              signingProposalId === selectedProposal.id ||
                approvingProposalId === selectedProposal.id ||
                executingProposalId === selectedProposal.id,
            )
          }
          executeDisabled={
            !selectedProposal ||
            !selectedProposalCanExecute ||
            Boolean(
              signingProposalId === selectedProposal.id ||
                approvingProposalId === selectedProposal.id ||
                executingProposalId === selectedProposal.id,
            )
          }
          signLabel={signingProposalId === selectedProposal?.id ? 'Signing...' : selectedProposalSignLabel}
          approveLabel={approvingProposalId === selectedProposal?.id ? 'Approving...' : selectedProposalApproveLabel}
          executeLabel={executingProposalId === selectedProposal?.id ? 'Executing...' : selectedProposalExecuteLabel}
          currentWalletSignatureState={selectedProposalSignatureState}
          notice={selectedProposal ? proposalNotices[selectedProposal.id] ?? null : null}
        />

        <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6"
      >
        <div className="space-y-6">
          {walletGateMode ? (
            <section className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
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
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-300">
                  {apiNotice}
                </div>
              ) : null}

          {activeSection === 'Dashboard' ? (
            <>
              <section className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Create vault</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Configure a vault, admin count, and approval threshold.
                    </p>
                  </div>

                  <form onSubmit={handleCreateVaultSubmit} className="space-y-4">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Vault name</span>
                      <input
                        value={vaultForm.name}
                        onChange={(event) =>
                          setVaultForm((currentForm) => ({
                            ...currentForm,
                            name: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition duration-200 focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-cyan-400"
                        placeholder="Treasury Alpha"
                      />
                    </label>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Admin count</span>
                        <input
                          type="number"
                          min="1"
                          value={vaultForm.adminCount}
                          onChange={(event) =>
                            setVaultForm((currentForm) => ({
                              ...currentForm,
                              adminCount: event.target.value,
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition duration-200 focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-cyan-400"
                        />
                      </label>

                      <label>
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Threshold</span>
                        <input
                          type="number"
                          min="1"
                          value={vaultForm.threshold}
                          onChange={(event) =>
                            setVaultForm((currentForm) => ({
                              ...currentForm,
                              threshold: event.target.value,
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition duration-200 focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-cyan-400"
                        />
                      </label>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Vault admins are generated from the current wallet session.
                      </p>
                      <button
                        type="submit"
                        disabled={createVaultLoading}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-cyan-400 dark:text-slate-950 dark:hover:bg-cyan-300"
                      >
                        {createVaultLoading ? <LoadingSpinner className="h-4 w-4" /> : null}
                        Create vault
                      </button>
                    </div>
                  </form>
                </section>

                <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Create proposal</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Submit a transaction request for PQC approval.
                    </p>
                  </div>

                  <form onSubmit={handleCreateProposalSubmit} className="space-y-4">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Vault</span>
                      <select
                        value={proposalForm.vaultApiId}
                        onChange={(event) =>
                          setProposalForm((currentForm) => ({
                            ...currentForm,
                            vaultApiId: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition duration-200 focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-cyan-400"
                      >
                        <option value="">Select a live vault</option>
                        {liveVaultOptions.map((vault) => (
                          <option key={vault.id} value={vault.apiId}>
                            {vault.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Title</span>
                      <input
                        value={proposalForm.title}
                        onChange={(event) =>
                          setProposalForm((currentForm) => ({
                            ...currentForm,
                            title: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition duration-200 focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-cyan-400"
                        placeholder="Ops treasury payout"
                      />
                    </label>

                    <label className="block">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Description</span>
                      <textarea
                        value={proposalForm.description}
                        onChange={(event) =>
                          setProposalForm((currentForm) => ({
                            ...currentForm,
                            description: event.target.value,
                          }))
                        }
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition duration-200 focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-cyan-400"
                        placeholder="Describe the treasury action."
                      />
                    </label>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Recipient address</span>
                        <input
                          value={proposalForm.recipientAddress}
                          onChange={(event) =>
                            setProposalForm((currentForm) => ({
                              ...currentForm,
                              recipientAddress: event.target.value,
                            }))
                          }
                          className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-sm outline-none transition duration-200 focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-cyan-400"
                          placeholder="0x1111111111111111111111111111111111111111"
                        />
                      </label>

                      <label>
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Amount (ETH)</span>
                        <input
                          value={proposalForm.amountEth}
                          onChange={(event) =>
                            setProposalForm((currentForm) => ({
                              ...currentForm,
                              amountEth: event.target.value,
                            }))
                          }
                          inputMode="decimal"
                          className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition duration-200 focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-cyan-400"
                          placeholder="0.01"
                        />
                      </label>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {liveVaultOptions.length > 0
                          ? 'Choose a live vault so signing can use stored PQC keys.'
                          : 'Create a vault first to enable proposal submission.'}
                      </p>
                      <button
                        type="submit"
                        disabled={createProposalLoading}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-cyan-400 dark:text-slate-950 dark:hover:bg-cyan-300"
                      >
                        {createProposalLoading ? <LoadingSpinner className="h-4 w-4" /> : null}
                        Create proposal
                      </button>
                    </div>
                  </form>
                </section>
              </section>

              <section className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Live vaults</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{vaults.length}</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Ready to execute</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {proposals.filter((proposal) => proposal.status === 'approved').length}
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Pending approvals</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {vaults.reduce((sum, vault) => sum + vault.pendingApprovals, 0)}
                  </p>
                </div>
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent proposals</h2>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Click a proposal to open the details popup.
                      </p>
                    </div>
                    {proposalsLoading ? <LoadingSpinner /> : null}
                  </div>

                  {proposalsError ? (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
                      {proposalsError}
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-4">
                    {proposals.length > 0 ? (
                      proposals.slice(0, 4).map((proposal) => (
                        <ProposalCard
                          key={proposal.id}
                          proposal={proposal}
                          isActive={proposal.id === selectedProposalId}
                          onOpen={setSelectedProposalId}
                        />
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-600 dark:bg-slate-800/70 dark:text-gray-400">
                        No proposals yet.
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent activity</h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    A lightweight audit trail for vault, proposal, signing, and execution events.
                  </p>

                  <div className="mt-4 space-y-3">
                    {activity.length > 0 ? (
                      activity.slice(0, 5).map((item) => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-slate-800/70"
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
                </section>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Vaults</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Treasury configurations created in this session.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-3">
                  {vaults.length > 0 ? (
                    vaults.map((vault) => <VaultCard key={vault.id} vault={vault} />)
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-600 dark:bg-slate-800/70 dark:text-gray-400 xl:col-span-3">
                      No vaults yet.
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : null}

          {activeSection === 'Proposals' ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Proposals</h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Click any proposal card to review or act on it in the popup.
                  </p>
                </div>
                {proposalsLoading ? <LoadingSpinner /> : null}
              </div>

              {proposalsError ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
                  {proposalsError}
                </div>
              ) : null}

              <div className="mt-4 space-y-4">
                {proposals.length > 0 ? (
                  proposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      isActive={proposal.id === selectedProposalId}
                      onOpen={setSelectedProposalId}
                    />
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-600 dark:bg-slate-800/70 dark:text-gray-400">
                    No proposals available yet.
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {activeSection === 'Vaults' ? (
            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Vaults</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Treasury configurations created in this session.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  {vaults.length > 0 ? (
                    vaults.map((vault) => <VaultCard key={vault.id} vault={vault} />)
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-600 dark:bg-slate-800/70 dark:text-gray-400 xl:col-span-2">
                      No vaults yet.
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">System status</h2>
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
              </section>
            </section>
          ) : null}
            </>
          )}
        </div>
      </motion.main>
      </div>
    </div>
  )
}
