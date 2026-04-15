import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'

import { LoadingSpinner } from './LoadingSpinner'
import { ModalFrame } from './ModalFrame'

import type { FormEvent } from 'react'

type ProposalFormDraft = {
  vaultApiId: string
  title: string
  description: string
  recipientAddress: string
  amountEth: string
  onchainProposalId: string
}

type VaultOption = {
  id: string
  apiId?: number
  name: string
  network: string
  contractAddress?: string | null
  balance: string
}

type ProposalFlowModalProps = {
  isOpen: boolean
  onClose: () => void
  form: ProposalFormDraft
  vaultOptions: VaultOption[]
  onFieldChange: (field: keyof ProposalFormDraft, value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  loading: boolean
}

const FLOW_STEPS = [
  'Select vault',
  'Recipient',
  'Amount',
  'Review',
  'Submit',
] as const

function StepBadge({
  index,
  currentStep,
  label,
}: {
  index: number
  currentStep: number
  label: string
}) {
  const isComplete = index < currentStep
  const isActive = index === currentStep

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold transition duration-200 ${
          isComplete || isActive
            ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20 dark:bg-blue-500'
            : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-400'
        }`}
      >
        {index + 1}
      </div>
      <div className="min-w-0">
        <p className={`truncate text-sm font-semibold ${isActive ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
          {label}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {isComplete ? 'Done' : isActive ? 'Current step' : 'Pending'}
        </p>
      </div>
    </div>
  )
}

function FlowSummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-3 last:border-b-0 dark:border-slate-800">
      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  )
}

export function ProposalFlowModal({
  isOpen,
  onClose,
  form,
  vaultOptions,
  onFieldChange,
  onSubmit,
  loading,
}: ProposalFlowModalProps) {
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0)
    }
  }, [isOpen])

  const selectedVault = useMemo(
    () => vaultOptions.find((vault) => String(vault.apiId ?? '') === form.vaultApiId) ?? null,
    [form.vaultApiId, vaultOptions],
  )

  const generatedTitle =
    form.title.trim() || (form.recipientAddress.trim() && form.amountEth.trim()
      ? `Transfer ${form.amountEth.trim()} ETH`
      : 'Transfer request')

  const canMoveForward = (() => {
    if (currentStep === 0) {
      return Boolean(form.vaultApiId)
    }
    if (currentStep === 1) {
      return Boolean(form.recipientAddress.trim())
    }
    if (currentStep === 2) {
      return Boolean(form.amountEth.trim())
    }
    if (currentStep === 3) {
      return Boolean(form.title.trim())
    }
    return true
  })()

  return (
    <ModalFrame
      isOpen={isOpen}
      onClose={onClose}
      title="Send Funds"
      description="A step-by-step proposal flow for treasury transfers."
      panelClassName="max-w-4xl"
    >
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="rounded-[28px] bg-gradient-to-r from-blue-600 via-blue-600 to-blue-500 p-5 text-white shadow-md shadow-blue-600/20">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium text-blue-100">Proposal wizard</p>
              <h3 className="mt-1 text-2xl font-semibold">Create a transfer request with less noise</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">
                The backend request remains unchanged. This flow only restructures the UI into clear, banking-style steps.
              </p>
            </div>
            <div className="rounded-2xl bg-white/15 px-4 py-3 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.2em] text-blue-100">Current step</p>
              <p className="mt-1 text-lg font-semibold">{FLOW_STEPS[currentStep]}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <div className="space-y-3 rounded-[28px] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-slate-900/80">
            {FLOW_STEPS.map((label, index) => (
              <StepBadge key={label} index={index} currentStep={currentStep} label={label} />
            ))}
          </div>

          <div className="rounded-[28px] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-slate-900/80">
            {currentStep === 0 ? (
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Step 1: Select a vault</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Choose the treasury vault that should own this transfer request.
                </p>

                <div className="mt-5 grid gap-3">
                  {vaultOptions.length > 0 ? (
                    vaultOptions.map((vault) => {
                      const isSelected = String(vault.apiId ?? '') === form.vaultApiId

                      return (
                        <button
                          key={vault.id}
                          type="button"
                          onClick={() => onFieldChange('vaultApiId', String(vault.apiId ?? ''))}
                          className={`rounded-3xl border px-4 py-4 text-left transition duration-200 ${
                            isSelected
                              ? 'border-blue-200 bg-blue-50 shadow-sm dark:border-blue-500/40 dark:bg-blue-500/10'
                              : 'border-gray-200 bg-gray-50 hover:bg-white dark:border-gray-700 dark:bg-slate-950/50 dark:hover:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{vault.name}</p>
                              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{vault.network}</p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm dark:bg-slate-900 dark:text-gray-200">
                              {vault.balance}
                            </span>
                          </div>
                          <p className="mt-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                            {vault.contractAddress ?? 'Contract is being linked'}
                          </p>
                        </button>
                      )
                    })
                  ) : (
                    <div className="rounded-3xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500 dark:border-gray-700 dark:bg-slate-950/50 dark:text-gray-400">
                      No live vaults are available yet. Create a vault first, then come back to this flow.
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {currentStep === 1 ? (
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Step 2: Enter the recipient</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Paste the destination wallet or contract address for the outgoing transfer.
                </p>

                <label className="mt-5 block">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Recipient address</span>
                  <input
                    value={form.recipientAddress}
                    onChange={(event) => onFieldChange('recipientAddress', event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-sm outline-none transition duration-200 focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-slate-950 dark:focus:border-blue-400"
                    placeholder="0x1111111111111111111111111111111111111111"
                  />
                </label>
              </div>
            ) : null}

            {currentStep === 2 ? (
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Step 3: Enter the amount</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Keep the transfer details minimal. Optional chain metadata can still be added here.
                </p>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Amount (ETH)</span>
                    <input
                      value={form.amountEth}
                      onChange={(event) => onFieldChange('amountEth', event.target.value)}
                      inputMode="decimal"
                      className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition duration-200 focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-slate-950 dark:focus:border-blue-400"
                      placeholder="0.25"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Onchain proposal ID</span>
                    <input
                      value={form.onchainProposalId}
                      onChange={(event) => onFieldChange('onchainProposalId', event.target.value)}
                      inputMode="numeric"
                      className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition duration-200 focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-slate-950 dark:focus:border-blue-400"
                      placeholder="Optional"
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {currentStep === 3 ? (
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Step 4: Review the request</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Add the proposal title and optional notes, then review the destination details before submitting.
                </p>

                <div className="mt-5 rounded-3xl bg-gray-50 p-4 dark:bg-slate-950/70">
                  <FlowSummaryRow label="Vault" value={selectedVault?.name ?? 'Not selected'} />
                  <FlowSummaryRow label="Recipient" value={form.recipientAddress.trim() || 'Not entered'} />
                  <FlowSummaryRow label="Amount" value={form.amountEth.trim() ? `${form.amountEth.trim()} ETH` : 'Not entered'} />
                  <FlowSummaryRow label="Network" value={selectedVault?.network ?? 'Sepolia'} />
                </div>

                <div className="mt-5 grid gap-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Proposal title</span>
                    <input
                      value={form.title}
                      onChange={(event) => onFieldChange('title', event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition duration-200 focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-slate-950 dark:focus:border-blue-400"
                      placeholder={generatedTitle}
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Description</span>
                    <textarea
                      value={form.description}
                      onChange={(event) => onFieldChange('description', event.target.value)}
                      rows={4}
                      className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition duration-200 focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-slate-950 dark:focus:border-blue-400"
                      placeholder="Short context for approvers"
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {currentStep === 4 ? (
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Step 5: Submit</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  This final step sends the existing backend request. No API behavior is changed.
                </p>

                <div className="mt-5 rounded-[28px] border border-blue-100 bg-blue-50 p-5 dark:border-blue-900/60 dark:bg-blue-950/20">
                  <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">{form.title.trim() || generatedTitle}</p>
                  <p className="mt-2 text-sm leading-6 text-blue-800 dark:text-blue-200">
                    {form.description.trim() || 'No additional description was provided for this transfer.'}
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-900/60">
                      <p className="text-xs uppercase tracking-[0.18em] text-blue-500 dark:text-blue-300">Vault</p>
                      <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{selectedVault?.name ?? 'Unknown'}</p>
                    </div>
                    <div className="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-900/60">
                      <p className="text-xs uppercase tracking-[0.18em] text-blue-500 dark:text-blue-300">Recipient</p>
                      <p className="mt-2 truncate font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {form.recipientAddress.trim() || 'N/A'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-900/60">
                      <p className="text-xs uppercase tracking-[0.18em] text-blue-500 dark:text-blue-300">Amount</p>
                      <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {form.amountEth.trim() ? `${form.amountEth.trim()} ETH` : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
          <div className="flex items-center gap-3">
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={onClose}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition duration-200 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Cancel
            </motion.button>

            {currentStep > 0 ? (
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => setCurrentStep((step) => Math.max(step - 1, 0))}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition duration-200 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
              >
                Back
              </motion.button>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {currentStep < FLOW_STEPS.length - 1 ? (
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => setCurrentStep((step) => Math.min(step + 1, FLOW_STEPS.length - 1))}
                disabled={!canMoveForward}
                className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                Continue
              </motion.button>
            ) : (
              <motion.button
                type="submit"
                whileTap={{ scale: 0.98 }}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                {loading ? <LoadingSpinner className="h-4 w-4" /> : null}
                {loading ? 'Submitting proposal...' : 'Submit proposal'}
              </motion.button>
            )}
          </div>
        </div>
      </form>
    </ModalFrame>
  )
}
