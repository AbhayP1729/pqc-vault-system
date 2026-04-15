import { BrowserProvider, formatEther, getAddress, isAddress, parseEther } from 'ethers'

import type { Eip1193Provider } from 'ethers'

export function normalizeEthereumAddress(address: string) {
  const normalizedAddress = address.trim()
  if (!normalizedAddress || !isAddress(normalizedAddress)) {
    throw new Error('Invalid Ethereum address')
  }

  return getAddress(normalizedAddress)
}

export function normalizeEthereumAddressList(rawValue: string) {
  return rawValue
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeEthereumAddress)
}

export async function getEthBalance(provider: Eip1193Provider, address: string) {
  const ethersProvider = new BrowserProvider(provider)
  const balance = await ethersProvider.getBalance(normalizeEthereumAddress(address))
  return formatEther(balance)
}

export function validateProposalTransaction(destination: string, amountEth: string) {
  const normalizedDestination = destination.trim()
  if (!normalizedDestination || !isAddress(normalizedDestination)) {
    throw new Error('Invalid Ethereum address')
  }

  const normalizedAmountEth = amountEth.trim()
  if (!normalizedAmountEth) {
    throw new Error('Enter valid ETH amount')
  }

  let amountWei: bigint
  try {
    amountWei = parseEther(normalizedAmountEth)
  } catch {
    throw new Error('Enter valid ETH amount')
  }

  if (amountWei <= 0n) {
    throw new Error('Enter valid ETH amount')
  }

  return {
    destination: getAddress(normalizedDestination),
    amountEth: formatEther(amountWei),
    amountWei: amountWei.toString(),
  }
}
