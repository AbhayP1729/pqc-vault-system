import { ExecutionTimeline } from './ExecutionTimeline'
import { LoadingSpinner } from './LoadingSpinner'
import { ModalFrame } from './ModalFrame'
import { SignatureIndicator } from './SignatureIndicator'

import { formatWalletAddress } from '../lib/wallet'

import type { BackendDebugEntry, Proposal, PqcAlgorithmOption, SignatureState } from '../types'

type ProposalNotice = {
  tone: 'success' | 'error' | 'info'
  title: string
  message?: string
}

type ProposalModalProps = {
  proposal: Proposal
  vaultName: string
  explorerUrl: string | null
  currentWalletAddress: string | null
  selectedAlgorithmLabel: string
  isSelectedAlgorithmAvailable: boolean
  onClose: () => void
  onSign: () => void
  onApprove: () => void
  onRegisterAllAlgorithms: () => void
  onExecute: () => void
  signLoading: boolean
  approveLoading: boolean
  registerAllLoading: boolean
  executeLoading: boolean
  signDisabled: boolean
  approveDisabled: boolean
  registerAllDisabled: boolean
  executeDisabled: boolean
  signLabel: string
  approveLabel: string
  executeLabel: string
  currentWalletSignatureState: SignatureState
  pqcAlgorithms: PqcAlgorithmOption[]
  availablePqcAlgorithms: PqcAlgorithmOption[]
  selectedPqcAlgorithm: string
  onSelectPqcAlgorithm: (algorithm: string) => void
  debugEntries: BackendDebugEntry[]
  isDebugVisible: boolean
  onToggleDebug: () => void
  notice: ProposalNotice | null
}

function InfoCard({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-slate-800/80">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-sm text-gray-900 dark:text-gray-100 ${mono ? 'font-mono' : 'font-medium'}`}>
        {value}
      </p>
    </div>
  )
}

function getStatusLabel(status: Proposal['status']) {
  if (status === 'approved') {
    return 'Approved'
  }
  if (status === 'executed') {
    return 'Executed'
  }
  return 'Pending'
}

function getNoticeClasses(tone: ProposalNotice['tone']) {
  if (tone === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
  }
  if (tone === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300'
  }
  return 'border-blue-200 bg-blue-50 text-blue-800 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-300'
}

function formatApprover(value: string | null | undefined, fallback: string) {
  if (value && value.startsWith('0x')) {
    return formatWalletAddress(value)
  }

  return fallback
}

function shortenValue(value: string | null | undefined, lead = 14, tail = 12) {
  if (!value) {
    return 'Unavailable'
  }

  if (value.length <= lead + tail + 3) {
    return value
  }

  return `${value.slice(0, lead)}...${value.slice(-tail)}`
}

function formatAuditTime(value: string | null | undefined) {
  if (!value) {
    return 'Pending'
  }

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    return value
  }

  return timestamp.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getWalletSignatureLabel(state: SignatureState) {
  if (state === 'verified') {
    return 'Signature Verified'
  }

  if (state === 'failed') {
    return 'Signature Failed'
  }

  return 'Signature Pending'
}

export function ProposalModal({
  proposal,
  vaultName,
  explorerUrl,
  currentWalletAddress,
  selectedAlgorithmLabel,
  isSelectedAlgorithmAvailable,
  onClose,
  onSign,
  onApprove,
  onRegisterAllAlgorithms,
  onExecute,
  signLoading,
  approveLoading,
  registerAllLoading,
  executeLoading,
  signDisabled,
  approveDisabled,
  registerAllDisabled,
  executeDisabled,
  signLabel,
  approveLabel,
  executeLabel,
  currentWalletSignatureState,
  pqcAlgorithms,
  availablePqcAlgorithms,
  selectedPqcAlgorithm,
  onSelectPqcAlgorithm,
  debugEntries,
  isDebugVisible,
  onToggleDebug,
  notice,
}: ProposalModalProps) {
  const algorithmOptions = pqcAlgorithms.length > 0 ? pqcAlgorithms : availablePqcAlgorithms
  const normalizedCurrentWalletAddress = currentWalletAddress?.toLowerCase() ?? null
  const currentWalletAudit = normalizedCurrentWalletAddress
    ? proposal.signatureAuditLog.find(
        (audit) => audit.walletAddress?.toLowerCase() === normalizedCurrentWalletAddress,
      ) ?? null
    : null
  const currentWalletSignature = normalizedCurrentWalletAddress
    ? proposal.signatures.find(
        (signature) => signature.walletAddress?.toLowerCase() === normalizedCurrentWalletAddress,
      ) ?? null
    : null
  const displayedAlgorithm =
    currentWalletSignature?.algorithm ?? currentWalletAudit?.algorithm ?? selectedAlgorithmLabel
  const latestSignature = currentWalletSignature?.signature ?? currentWalletAudit?.signature ?? null
  const verificationResult = currentWalletSignature
    ? currentWalletSignature.isVerified
      ? 'Valid'
      : 'Invalid'
    : currentWalletAudit?.verificationResult ?? (currentWalletSignatureState === 'verified' ? 'Valid' : 'Pending')
  const verificationTimestamp = currentWalletAudit?.createdAt ?? currentWalletSignature?.createdAt ?? null
  const keyStatus = currentWalletSignature || currentWalletAudit
    ? (currentWalletSignature?.keyGenerated ?? currentWalletAudit?.keyGenerated)
      ? 'New key generated'
      : 'Existing key used'
    : 'Waiting to sign'
  const executionStep = executeLoading ? Math.max(proposal.currentStep, 3) : proposal.currentStep

  return (
    <ModalFrame
      isOpen
      onClose={onClose}
      title={proposal.title}
      description={proposal.description || undefined}
      panelClassName="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoCard label="Destination" value={proposal.destination} mono />
          <InfoCard label="Amount" value={`${proposal.amountEth} ETH`} />
          <InfoCard label="Vault" value={vaultName} />
          <InfoCard
            label="Connected wallet"
            value={currentWalletAddress ? formatWalletAddress(currentWalletAddress) : 'Not connected'}
            mono
          />
          {proposal.contractAddress ? (
            <InfoCard label="Vault contract" value={proposal.contractAddress} mono />
          ) : null}
          {proposal.onchainProposalId !== null && proposal.onchainProposalId !== undefined ? (
            <InfoCard label="Onchain proposal" value={String(proposal.onchainProposalId)} />
          ) : null}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-slate-800/80">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Proposal status</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {getStatusLabel(proposal.status)}
                </p>
              </div>
              <SignatureIndicator state={currentWalletSignatureState} />
            </div>
          </div>
        </div>

        {notice ? (
          <div className={`rounded-xl border px-4 py-3 text-sm ${getNoticeClasses(notice.tone)}`}>
            <p className="font-medium">{notice.title}</p>
            {notice.message ? <p className="mt-1">{notice.message}</p> : null}
          </div>
        ) : null}

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">PQC verification</h3>
              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {verificationResult === 'Valid' ? 'Valid signature bound to this proposal.' : 'Awaiting a verified signature.'}
              </p>
            </div>
            <label className="min-w-56">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Signing algorithm</span>
              <select
                value={selectedPqcAlgorithm}
                onChange={(event) => onSelectPqcAlgorithm(event.target.value)}
                disabled={signLoading || signDisabled || proposal.status !== 'pending'}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition duration-200 focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-cyan-400 dark:disabled:bg-slate-800"
              >
                {algorithmOptions.map((algorithm) => (
                  <option key={algorithm.name} value={algorithm.name}>
                    {algorithm.label}
                  </option>
                ))}
              </select>
              {availablePqcAlgorithms.length === 0 && proposal.status === 'pending' ? (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                  Register this wallet as a vault admin to sign.
                </p>
              ) : !isSelectedAlgorithmAvailable && proposal.status === 'pending' ? (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                  This wallet is not registered as a vault admin.
                </p>
              ) : null}
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <InfoCard label="Algorithm" value={displayedAlgorithm} />
            <InfoCard label="Key status" value={keyStatus} />
            <InfoCard label="Verification result" value={verificationResult} />
            <InfoCard label="Signature" value={shortenValue(latestSignature)} mono />
            <InfoCard label="Timestamp" value={formatAuditTime(verificationTimestamp)} />
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onRegisterAllAlgorithms}
              disabled={registerAllDisabled}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition duration-200 ${
                registerAllDisabled && !registerAllLoading
                  ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-700 dark:bg-slate-800 dark:text-gray-500'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-slate-800'
              }`}
            >
              {registerAllLoading ? <LoadingSpinner className="h-4 w-4" /> : null}
              Register all PQC algorithms
            </button>
          </div>

          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-slate-800/80">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Message being signed</p>
            <p className="mt-2 max-h-32 overflow-auto break-all font-mono text-xs leading-5 text-gray-800 dark:text-gray-200">
              {currentWalletAudit?.message ?? proposal.messageToSign ?? 'Message unavailable'}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Proposal pipeline</h3>
              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                PQC verification, threshold approval, vault contract execution, blockchain confirmation.
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 dark:bg-slate-800 dark:text-gray-300">
              {proposal.approvals} / {proposal.threshold} approvals
            </span>
          </div>

          <ExecutionTimeline currentStep={executionStep} />

          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-slate-800/80">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Your signature</p>
            <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
              {getWalletSignatureLabel(currentWalletSignatureState)}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Approve is enabled only after the PQC signature is verified.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Approving admins</h3>
              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {proposal.approvals} / {proposal.threshold} approvals
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {proposal.approvalRecords.length > 0 ? (
              proposal.approvalRecords.map((approval) => (
                <span
                  key={`${approval.publicKey}-${approval.createdAt ?? ''}`}
                  className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-slate-800 dark:text-gray-300"
                  title={approval.walletAddress ?? approval.publicKey}
                >
                  {formatApprover(approval.walletAddress, 'PQC admin')}
                </span>
              ))
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No approvals recorded yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Signature audit log</h3>
              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {proposal.signatureAuditLog.length} verification event{proposal.signatureAuditLog.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {proposal.signatureAuditLog.length > 0 ? (
              proposal.signatureAuditLog.slice(0, 4).map((audit) => (
                <div
                  key={audit.id}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-slate-800/80"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-xs text-gray-900 dark:text-gray-100" title={audit.walletAddress ?? undefined}>
                      {formatApprover(audit.walletAddress, 'PQC admin')}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-1 text-xs font-medium ${
                        audit.isVerified
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
                          : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300'
                      }`}
                    >
                      {audit.verificationResult}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-3">
                    <span>{audit.algorithm}</span>
                    <span className="font-mono" title={audit.signature}>
                      {shortenValue(audit.signature, 10, 8)}
                    </span>
                    <span>{formatAuditTime(audit.createdAt)}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No PQC verification events yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Classical vs Quantum-Safe Execution
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
              <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">Without PQC</p>
              <p className="mt-1 text-sm text-rose-700 dark:text-rose-200">
                One classical wallet signature can authorize execution.
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">With PQC</p>
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-200">
                PQC verification and distinct admin wallets gate the Sepolia transaction.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <button
            type="button"
            onClick={onToggleDebug}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition duration-200 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-slate-800"
          >
            {isDebugVisible ? 'Hide backend debug' : 'Show backend debug'}
          </button>
          {isDebugVisible ? (
            <div className="mt-3 space-y-3">
              {debugEntries.length > 0 ? (
                debugEntries.map((entry) => (
                  <div key={`${entry.label}-${entry.createdAt}`} className="rounded-xl bg-gray-950 p-3 text-xs text-gray-100">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-medium">{entry.label}</span>
                      <span className="text-gray-400">{entry.createdAt}</span>
                    </div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(entry.payload, null, 2)}
                    </pre>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Sign, approve, or execute this proposal to capture the backend response.
                </p>
              )}
            </div>
          ) : null}
        </div>

        {proposal.executionTxHash ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Transaction Successful</p>
            <p className="mt-1 break-all font-mono text-xs text-emerald-900 dark:text-emerald-200">
              {proposal.executionTxHash}
            </p>
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center text-sm font-medium text-emerald-700 transition duration-200 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
              >
                View on Etherscan
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 dark:border-gray-700 sm:flex-row">
          <button
            type="button"
            onClick={onSign}
            disabled={signDisabled}
            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition duration-200 ${
              signDisabled && !signLoading
                ? 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
                : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-cyan-400 dark:text-slate-950 dark:hover:bg-cyan-300'
            }`}
          >
            {signLoading ? <LoadingSpinner className="h-4 w-4" /> : null}
            {signLabel}
          </button>

          <button
            type="button"
            onClick={onApprove}
            disabled={approveDisabled}
            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition duration-200 ${
              approveDisabled && !approveLoading
                ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-700 dark:bg-slate-800 dark:text-gray-500'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-slate-800'
            }`}
          >
            {approveLoading ? <LoadingSpinner className="h-4 w-4" /> : null}
            {approveLabel}
          </button>

          <button
            type="button"
            onClick={onExecute}
            disabled={executeDisabled}
            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition duration-200 ${
              executeDisabled && !executeLoading
                ? 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
                : 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400'
            }`}
          >
            {executeLoading ? <LoadingSpinner className="h-4 w-4" /> : null}
            {executeLabel}
          </button>
        </div>
      </div>
    </ModalFrame>
  )
}
