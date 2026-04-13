import { LoadingSpinner } from './LoadingSpinner'
import { ThemeToggle } from './ThemeToggle'

import type { NavItem, Theme } from '../types'

type NavbarProps = {
  items: NavItem[]
  activeItem: NavItem
  onSelect: (item: NavItem) => void
  theme: Theme
  onToggleTheme: () => void
  walletAddress: string | null
  walletLabel: string
  networkLabel: string
  isOnSepolia: boolean
  hasMetaMask: boolean
  walletActionLoading: 'connect' | 'switch' | null
  onConnectWallet: () => void
  onSwitchNetwork: () => void
}

export function Navbar({
  items,
  activeItem,
  onSelect,
  theme,
  onToggleTheme,
  walletAddress,
  walletLabel,
  networkLabel,
  isOnSepolia,
  hasMetaMask,
  walletActionLoading,
  onConnectWallet,
  onSwitchNetwork,
}: NavbarProps) {
  const showConnectButton = !walletAddress
  const showSwitchButton = Boolean(walletAddress) && !isOnSepolia

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white transition-colors duration-200 dark:border-gray-700 dark:bg-[#0B0F19]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 transition-colors duration-200 dark:text-gray-100">
              PQC Vault
            </h1>
            <p className="text-sm text-gray-500 transition-colors duration-200 dark:text-gray-400">
              Multi-admin approvals on Sepolia
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            {items.map((item) => {
              const isActive = item === activeItem

              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => onSelect(item)}
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
          </nav>
        </div>

        <div className="flex flex-col gap-3 lg:items-end">
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-left shadow-sm transition-colors duration-200 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {walletAddress ? 'Connected wallet' : hasMetaMask ? 'Wallet disconnected' : 'MetaMask unavailable'}
              </p>
              <p
                className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400"
                title={walletAddress ?? undefined}
              >
                {walletLabel}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{networkLabel}</p>
            </div>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showConnectButton ? (
              <button
                type="button"
                onClick={onConnectWallet}
                disabled={!hasMetaMask || walletActionLoading === 'connect'}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-cyan-400 dark:text-slate-950 dark:hover:bg-cyan-300"
              >
                {walletActionLoading === 'connect' ? <LoadingSpinner className="h-4 w-4" /> : null}
                Connect Wallet
              </button>
            ) : null}
            {showSwitchButton ? (
              <button
                type="button"
                onClick={onSwitchNetwork}
                disabled={walletActionLoading === 'switch'}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 transition duration-200 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-950/40"
              >
                {walletActionLoading === 'switch' ? <LoadingSpinner className="h-4 w-4" /> : null}
                Switch Network
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}
