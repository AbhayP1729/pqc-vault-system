import { ExecutionTimeline } from './ExecutionTimeline'
import { LoadingSpinner } from './LoadingSpinner'
import { ModalFrame } from './ModalFrame'
import { SignatureIndicator } from './SignatureIndicator'

import { formatWalletAddress } from '../lib/wallet'

import type { Proposal, SignatureState } from '../types'

type ProposalNotice = {
  tone: 'success' | 'error' | 'info'
  title: string
  message?: string
}

type ProposalModalProps = {
  proposal: Proposal | null
  vaultName: string
  explorerUrl: string | null
  onClose: () => void
  onSign: () => void
  onApprove: () => void
  onExecute: () => void
  signLoading: boolean
  approveLoading: boolean
  executeLoading: boolean
  signDisabled: boolean
  approveDisabled: boolean
  executeDisabled: boolean
  signLabel: string
  approveLabel: string
  executeLabel: string
  currentWalletSignatureState: SignatureState
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
  onClose,
  onSign,
  onApprove,
  onExecute,
  signLoading,
  approveLoading,
  executeLoading,
  signDisabled,
  approveDisabled,
  executeDisabled,
  signLabel,
  approveLabel,
  executeLabel,
  currentWalletSignatureState,
  notice,
}: ProposalModalProps) {
  if (!proposal) {
    return null
  }

  return (
    <ModalFrame
      isOpen={Boolean(proposal)}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Proposal pipeline</h3>
              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                Proposed to executed, with signing and approvals separated.
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 dark:bg-slate-800 dark:text-gray-300">
              {proposal.approvals} / {proposal.threshold} approvals
            </span>
          </div>

          <ExecutionTimeline currentStep={proposal.currentStep} />

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
