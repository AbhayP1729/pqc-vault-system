import axios from 'axios'
import { useCallback, useState } from 'react'

export const API_BASE_URL = 'http://localhost:8000'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
  },
})

function getErrorMessage(error, fallbackMessage = 'Something went wrong.') {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail

    if (typeof detail === 'string' && detail.trim().length > 0) {
      return detail
    }

    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => item?.msg)
        .filter(Boolean)
        .join(', ')
    }

    if (error.message) {
      return error.message
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallbackMessage
}

async function request(config, fallbackMessage) {
  try {
    const response = await apiClient(config)
    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error, fallbackMessage))
  }
}

export function createVault(data) {
  return request(
    {
      method: 'post',
      url: '/create-vault',
      data,
    },
    'Unable to create vault.',
  )
}

export function createProposal(data) {
  return request(
    {
      method: 'post',
      url: '/create-proposal',
      data,
    },
    'Unable to create proposal.',
  )
}

export function signProposal(data) {
  return request(
    {
      method: 'post',
      url: '/sign-proposal',
      data,
    },
    'Unable to sign proposal.',
  )
}

export function approveProposal(data) {
  return request(
    {
      method: 'post',
      url: '/approve-proposal',
      data,
    },
    'Unable to approve proposal.',
  )
}

export function verifySignature(data) {
  return request(
    {
      method: 'post',
      url: '/verify-signature',
      data,
    },
    'Unable to verify signature.',
  )
}

export function getVaults() {
  return request(
    {
      method: 'get',
      url: '/vaults',
    },
    'Unable to load vaults.',
  )
}

export function getPqcAlgorithms() {
  return request(
    {
      method: 'get',
      url: '/pqc/algorithms',
    },
    'Unable to load PQC algorithms.',
  )
}

export function registerWalletPqcAlgorithms(data) {
  return request(
    {
      method: 'post',
      url: '/pqc/register-wallet',
      data,
    },
    'Unable to register PQC algorithms for this wallet.',
  )
}

export function getProposals(params = {}) {
  return request(
    {
      method: 'get',
      url: '/proposals',
      params,
    },
    'Unable to load proposals.',
  )
}

export function executeProposal(id, executorWalletAddress) {
  return request(
    {
      method: 'post',
      url: '/execute',
      data: {
        proposal_id: id,
        executor_wallet_address: executorWalletAddress,
      },
    },
    'Unable to execute proposal.',
  )
}

export function useApiRequest(apiFunction) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const run = useCallback(
    async (...args) => {
      setLoading(true)
      setError(null)

      try {
        return await apiFunction(...args)
      } catch (requestError) {
        const message = getErrorMessage(requestError)
        setError(message)
        throw new Error(message)
      } finally {
        setLoading(false)
      }
    },
    [apiFunction],
  )

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return { run, loading, error, clearError }
}
