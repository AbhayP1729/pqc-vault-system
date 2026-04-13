import { formatEther, getAddress, isAddress, parseEther } from 'ethers'

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
