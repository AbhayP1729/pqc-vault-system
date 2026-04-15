import { motion } from 'framer-motion'

import { formatWalletAddress } from '../lib/wallet'

import type { KeyboardEvent } from 'react'
import type { Proposal } from '../types'

type ProposalCardProps = {
  proposal: Proposal
  isActive: boolean
  onOpen: (proposal: Proposal) => void
}

function getProgressWidth(approvals: number, threshold: number) {
  return `${Math.min((approvals / threshold) * 100, 100)}%`
}

function getStatusClasses(status: Proposal['status']) {
  if (status === 'executed') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
  }
  if (status === 'approved') {
    return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-300'
  }
  return 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-slate-800 dark:text-gray-300'
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

function truncateAddress(value: string, lead = 8, tail = 6) {
  if (value.length <= lead + tail + 3) {
    return value
  }

  return `${value.slice(0, lead)}...${value.slice(-tail)}`
}

function formatProposalSubmitter(value: string) {
  return value.startsWith('0x') ? formatWalletAddress(value) : value
}

export function ProposalCard({
  proposal,
  isActive,
  onOpen,
}: ProposalCardProps) {
  const verifiedSignatureCount = proposal.signatures.filter((signature) => signature.isVerified).length
  const approvalSummary = `${proposal.approvals} / ${proposal.threshold} approvals`

  function handleOpen() {
    onOpen(proposal)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleOpen()
    }
  }

  return (
    <motion.article
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.18 }}
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      className={`cursor-pointer rounded-2xl border bg-white p-4 text-left shadow-md transition duration-200 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:bg-slate-900 dark:focus-visible:ring-cyan-400 ${
        isActive
          ? 'border-blue-200 bg-blue-50/50 dark:border-cyan-700 dark:bg-cyan-400/5'
          : proposal.status === 'executed'
            ? 'border-emerald-200/70 dark:border-emerald-900/40'
            : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600 dark:bg-slate-800 dark:text-gray-300">
              {proposal.id}
            </span>
            <span className={`rounded-full border px-3 py-1 text-sm font-medium ${getStatusClasses(proposal.status)}`}>
              {getStatusLabel(proposal.status)}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {proposal.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
            {proposal.description}
          </p>
        </div>

        <div className="space-y-1 rounded-xl bg-gray-50 p-3 dark:bg-slate-800/80 md:min-w-44 md:text-right">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Amount</p>
          <p
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            title={proposal.amountWei ? `${proposal.amountWei} wei` : undefined}
          >
            {proposal.amountEth} ETH
          </p>
          <p
            className="text-xs font-mono text-gray-500 dark:text-gray-400"
            title={proposal.destination}
          >
            {truncateAddress(proposal.destination)}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>{approvalSummary}</span>
          <span className="text-xs">
            {verifiedSignatureCount > 0 ? `${verifiedSignatureCount} signed` : 'Awaiting signature'}
          </span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 dark:bg-slate-800">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: getProgressWidth(proposal.approvals, proposal.threshold) }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="h-2 rounded-full bg-blue-600 dark:bg-cyan-400"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-gray-200 pt-3 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between">
        <p
          className="text-sm text-gray-500 dark:text-gray-400"
          title={proposal.submittedBy.startsWith('0x') ? proposal.submittedBy : undefined}
        >
          Submitted by {formatProposalSubmitter(proposal.submittedBy)} / {proposal.updatedAt}
        </p>
        <span className="text-sm font-medium text-blue-600 dark:text-cyan-400">View details</span>
      </div>
    </motion.article>
  )
}
