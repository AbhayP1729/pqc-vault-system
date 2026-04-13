import { motion } from 'framer-motion'

import type { Vault } from '../types'

type VaultCardProps = {
  vault: Vault
}

export function VaultCard({ vault }: VaultCardProps) {
  return (
    <motion.article
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.18 }}
      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition duration-200 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{vault.name}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{vault.network}</p>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600 dark:bg-slate-800 dark:text-gray-300">
          {vault.pendingApprovals} pending
        </span>
      </div>

      <div className="mt-4 rounded-xl bg-gray-50 p-3 dark:bg-slate-800/80">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Balance</p>
        <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{vault.balance}</p>
      </div>

      <div className="mt-4 grid gap-3 border-t border-gray-200 pt-3 text-sm dark:border-gray-700 sm:grid-cols-3">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Admins</p>
          <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{vault.adminCount}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Threshold</p>
          <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{vault.threshold ?? 0}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Contract</p>
          <p className="mt-1 truncate font-mono text-xs text-gray-900 dark:text-gray-200">
            {vault.contractAddress ?? 'Pending'}
          </p>
        </div>
      </div>
    </motion.article>
  )
}
