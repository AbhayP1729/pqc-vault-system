export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

type WalletSession = {
  address: string | null
  chainId: string | null
}

const WALLET_SESSION_KEY = 'pqc-vault-wallet-session'

export const SEPOLIA_CHAIN_ID = '0xaa36a7'
export const SEPOLIA_NETWORK_NAME = 'Sepolia'

export function getEthereumProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') {
    return null
  }

  return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null
}

export function isSepoliaChainId(chainId: string | null | undefined) {
  return chainId?.toLowerCase() === SEPOLIA_CHAIN_ID
}

export function formatWalletAddress(address: string | null | undefined) {
  if (!address) {
    return 'Not connected'
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function readWalletSession(): WalletSession {
  if (typeof window === 'undefined') {
    return {
      address: null,
      chainId: null,
    }
  }

  try {
    const rawValue = window.sessionStorage.getItem(WALLET_SESSION_KEY)
    if (!rawValue) {
      return {
        address: null,
        chainId: null,
      }
    }

    const parsed = JSON.parse(rawValue)
    return {
      address: typeof parsed?.address === 'string' && parsed.address ? parsed.address : null,
      chainId: typeof parsed?.chainId === 'string' && parsed.chainId ? parsed.chainId : null,
    }
  } catch {
    return {
      address: null,
      chainId: null,
    }
  }
}

export function persistWalletSession(session: WalletSession) {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(session))
}

export function clearWalletSession() {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(WALLET_SESSION_KEY)
}

export function resolvePrimaryAccount(value: unknown) {
  if (!Array.isArray(value)) {
    return null
  }

  const account = value.find((candidate) => typeof candidate === 'string' && candidate)
  return typeof account === 'string' ? account : null
}

export function resolveChainId(value: unknown) {
  return typeof value === 'string' && value ? value : null
}

export function getWalletErrorMessage(error: unknown, fallbackMessage: string) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const errorCode = (error as { code?: number }).code
    if (errorCode === 4001) {
      return 'MetaMask request was rejected.'
    }
    if (errorCode === 4902) {
      return 'Sepolia is not available in this MetaMask instance.'
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallbackMessage
}
