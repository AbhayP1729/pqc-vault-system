import { motion } from 'framer-motion'

import { LoadingSpinner } from './LoadingSpinner'
import { ModalFrame } from './ModalFrame'

import type { FormEvent } from 'react'

type VaultFormDraft = {
  name: string
  adminCount: string
  threshold: string
  adminWallets: string
  contractAddress: string
}

type CreateVaultModalProps = {
  isOpen: boolean
  onClose: () => void
  form: VaultFormDraft
  onFieldChange: (field: keyof VaultFormDraft, value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  loading: boolean
}

function VaultGlyph() {
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-600/20 dark:bg-blue-500">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 8.5 12 4l7 4.5v7L12 20l-7-4.5v-7Z" />
        <path d="M12 4v16M5 8.5l7 4.5 7-4.5" />
      </svg>
    </div>
  )
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white/80 px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-slate-900/70">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  )
}

export function CreateVaultModal({
  isOpen,
  onClose,
  form,
  onFieldChange,
  onSubmit,
  loading,
}: CreateVaultModalProps) {
  return (
    <ModalFrame
      isOpen={isOpen}
      onClose={onClose}
      title="Create Vault"
      description="Set up a treasury vault with multi-admin controls and instant PQC key generation."
      panelClassName="max-w-3xl"
    >
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="rounded-[28px] bg-gradient-to-r from-blue-600 to-blue-500 p-5 text-white shadow-md shadow-blue-600/20">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-4">
              <VaultGlyph />
              <div>
                <p className="text-sm font-medium text-blue-100">Task-first setup</p>
                <h3 className="mt-1 text-2xl font-semibold">Configure the vault in one pass</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-blue-100">
                  Define the treasury name, approval threshold, and admin wallets. The backend will keep the
                  existing signing logic and generate the PQC material automatically.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:min-w-[260px]">
              <MetricChip label="Admins" value={form.adminCount || '0'} />
              <MetricChip label="Threshold" value={form.threshold || '0'} />
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5 rounded-[28px] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-slate-900/80">
            <label className="block">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Vault name</span>
              <input
                value={form.name}
                onChange={(event) => onFieldChange('name', event.target.value)}
                className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition duration-200 focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-slate-950 dark:focus:border-blue-400"
                placeholder="Operations Treasury"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Admin count</span>
                <input
                  value={form.adminCount}
                  onChange={(event) => onFieldChange('adminCount', event.target.value)}
                  inputMode="numeric"
                  className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition duration-200 focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-slate-950 dark:focus:border-blue-400"
                  placeholder="3"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Approval threshold</span>
                <input
                  value={form.threshold}
                  onChange={(event) => onFieldChange('threshold', event.target.value)}
                  inputMode="numeric"
                  className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition duration-200 focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-slate-950 dark:focus:border-blue-400"
                  placeholder="2"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Admin wallet addresses</span>
              <textarea
                value={form.adminWallets}
                onChange={(event) => onFieldChange('adminWallets', event.target.value)}
                rows={5}
                className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-sm outline-none transition duration-200 focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-slate-950 dark:focus:border-blue-400"
                placeholder="0xabc...&#10;0xdef...&#10;0x123..."
              />
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                One wallet per line. Algorithms rotate across Dilithium, Falcon, and SPHINCS+.
              </p>
            </label>
          </div>

          <div className="space-y-5 rounded-[28px] border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-slate-900/80">
            <label className="block">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Existing vault contract</span>
              <input
                value={form.contractAddress}
                onChange={(event) => onFieldChange('contractAddress', event.target.value)}
                className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-sm outline-none transition duration-200 focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-slate-950 dark:focus:border-blue-400"
                placeholder="Optional: 0x..."
              />
            </label>

            <div className="rounded-3xl bg-gray-50 p-4 dark:bg-slate-950/70">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">What happens next</p>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-gray-600 dark:text-gray-400">
                <li>Backend registers the admin wallets and preserves the current vault flow.</li>
                <li>PQC keys are generated automatically without changing your existing signing API path.</li>
                <li>If no contract address is provided, the backend deploys the on-chain vault on Sepolia.</li>
              </ul>
            </div>

            <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200">
              The UI has been simplified, but your existing backend and contract behavior stay exactly as-is.
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Rounded, minimal, task-first. The submit action still uses the current backend request.
          </p>

          <div className="flex items-center gap-3">
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={onClose}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition duration-200 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Cancel
            </motion.button>
            <motion.button
              type="submit"
              whileTap={{ scale: 0.98 }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              {loading ? <LoadingSpinner className="h-4 w-4" /> : null}
              {loading ? 'Creating vault...' : 'Create vault'}
            </motion.button>
          </div>
        </div>
      </form>
    </ModalFrame>
  )
}
