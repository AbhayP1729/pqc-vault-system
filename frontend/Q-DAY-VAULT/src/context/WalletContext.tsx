import { createContext, useContext, useEffect, useState } from 'react'

import { getEthBalance } from '../lib/ethereum'
import {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_NETWORK_NAME,
  clearWalletSession,
  formatWalletAddress,
  getEthereumProvider,
  isSepoliaChainId,
  persistWalletSession,
  readWalletSession,
  resolveChainId,
  resolvePrimaryAccount,
} from '../lib/wallet'

import type { EthereumProvider } from '../lib/wallet'
import type { ReactNode } from 'react'
import type { Eip1193Provider } from 'ethers'

type WalletAction = 'connect' | 'switch' | null

type WalletContextValue = {
  ethereumProvider: EthereumProvider | null
  hasMetaMask: boolean
  walletAddress: string | null
  walletChainId: string | null
  walletEthBalance: string | null
  walletActionLoading: WalletAction
  isWalletConnected: boolean
  isOnSepolia: boolean
  walletIdentityLabel: string
  networkLabel: string
  connectWallet: () => Promise<{ address: string; chainId: string | null }>
  switchNetwork: () => Promise<string | null>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const initialWalletSession = readWalletSession()
  const [walletAddress, setWalletAddress] = useState<string | null>(initialWalletSession.address)
  const [walletChainId, setWalletChainId] = useState<string | null>(initialWalletSession.chainId)
  const [walletEthBalance, setWalletEthBalance] = useState<string | null>(null)
  const [walletActionLoading, setWalletActionLoading] = useState<WalletAction>(null)
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

  useEffect(() => {
    if (!ethereumProvider) {
      updateWalletSession(null, null)
      return
    }

    const provider = ethereumProvider
    let cancelled = false

    async function syncWalletFromProvider(reason: string) {
      try {
        const [accountsResult, chainIdResult] = await Promise.all([
          provider.request({ method: 'eth_accounts' }),
          provider.request({ method: 'eth_chainId' }),
        ])

        if (cancelled) {
          return
        }

        const nextAddress = resolvePrimaryAccount(accountsResult)
        const nextChainId = resolveChainId(chainIdResult)
        console.log('[Wallet Debug] Provider sync', {
          reason,
          walletAddress: nextAddress ?? 'Not connected',
          chainId: nextChainId ?? 'Unavailable',
        })
        updateWalletSession(nextAddress, nextChainId)
      } catch {
        if (!cancelled) {
          updateWalletSession(null, null)
        }
      }
    }

    function handleAccountsChanged(accounts: unknown) {
      console.log('[Wallet Debug] accountsChanged', accounts)
      void syncWalletFromProvider('accountsChanged')
    }

    function handleChainChanged(chainId: unknown) {
      console.log('[Wallet Debug] chainChanged', chainId)
      void syncWalletFromProvider('chainChanged')
    }

    void syncWalletFromProvider('initial')
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

    if (!ethereumProvider || !walletAddress || !isOnSepolia) {
      setWalletEthBalance(null)
      return
    }

    const balanceAddress = walletAddress

    async function hydrateWalletBalance() {
      try {
        const balance = await getEthBalance(ethereumProvider as Eip1193Provider, balanceAddress)
        if (!cancelled) {
          setWalletEthBalance(`${Number(balance).toFixed(4)} ETH`)
        }
      } catch {
        if (!cancelled) {
          setWalletEthBalance('Unavailable')
        }
      }
    }

    void hydrateWalletBalance()

    return () => {
      cancelled = true
    }
  }, [ethereumProvider, isOnSepolia, walletAddress])

  async function connectWallet() {
    if (!ethereumProvider) {
      throw new Error('Install or enable MetaMask to connect a wallet.')
    }

    setWalletActionLoading('connect')

    try {
      const [accountsResult, chainIdResult] = await Promise.all([
        ethereumProvider.request({ method: 'eth_requestAccounts' }),
        ethereumProvider.request({ method: 'eth_chainId' }),
      ])
      const nextAddress = resolvePrimaryAccount(accountsResult)
      const nextChainId = resolveChainId(chainIdResult)

      if (!nextAddress) {
        throw new Error('MetaMask did not return an account.')
      }

      updateWalletSession(nextAddress, nextChainId)
      return {
        address: nextAddress,
        chainId: nextChainId,
      }
    } finally {
      setWalletActionLoading(null)
    }
  }

  async function switchNetwork() {
    if (!ethereumProvider) {
      throw new Error('Install or enable MetaMask to switch networks.')
    }

    setWalletActionLoading('switch')

    try {
      await ethereumProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      })
      const chainIdResult = await ethereumProvider.request({ method: 'eth_chainId' })
      const nextChainId = resolveChainId(chainIdResult)
      updateWalletSession(walletAddress, nextChainId)
      return nextChainId
    } finally {
      setWalletActionLoading(null)
    }
  }

  return (
    <WalletContext.Provider
      value={{
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
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider.')
  }

  return context
}
