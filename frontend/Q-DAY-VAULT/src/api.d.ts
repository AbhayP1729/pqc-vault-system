export const API_BASE_URL: string

export type ApiPayload = Record<string, unknown>

export type ApiApprovalResponse = {
  admin_name?: string
  public_key?: string
  algorithm?: string
  signature?: string
  is_verified?: boolean
  wallet_address?: string | null
  created_at?: string | null
}

export type ApiSignatureResponse = {
  admin_name?: string
  public_key?: string
  algorithm?: string
  signature?: string
  is_verified?: boolean
  key_generated?: boolean
  wallet_address?: string | null
  created_at?: string | null
  approved_at?: string | null
  is_approved?: boolean
}

export type ApiSignatureAuditLogResponse = {
  id?: number
  admin_name?: string | null
  public_key?: string | null
  wallet_address?: string | null
  algorithm?: string
  key_generated?: boolean
  signature?: string
  message?: string
  is_verified?: boolean
  verification_result?: string
  created_at?: string | null
}

export type ApiGeneratedAdminKey = {
  name?: string
  wallet_address?: string | null
  algorithm?: string
  public_key?: string
  private_key?: string
  key_file?: string
}

export type ApiVaultAdmin = {
  id?: number
  name?: string
  wallet_address?: string | null
  public_key?: string
  algorithm?: string
  key_file?: string | null
}

export type ApiVaultResponse = {
  id?: number
  name?: string
  threshold?: number
  contract_address?: string | null
  network?: string
  admins?: ApiVaultAdmin[]
}

export type ApiPqcAlgorithmResponse = {
  family?: string
  name?: string
  label?: string
}

export type ApiVerificationResponse = {
  message?: string | null
  algorithm?: string
  signature?: string
  is_valid?: boolean
  verification_result?: string
  timestamp?: string | null
  wallet_address?: string | null
  public_key?: string
}

export type ApiProposalResponse = {
  id?: number | string
  vault_id?: number
  network?: string
  contract_address?: string | null
  payload?: ApiPayload | null
  title?: string
  description?: string | null
  destination?: string
  amount_eth?: string
  amount_wei?: string | null
  approval_count?: number
  threshold?: number
  onchain_proposal_id?: number | null
  approvals?: ApiApprovalResponse[]
  signatures?: ApiSignatureResponse[]
  signature_audit_log?: ApiSignatureAuditLogResponse[]
  status?: string
  executed_at?: string | null
  created_at?: string | null
  message_to_sign?: string
  execution_tx_hash?: string | null
}

export type ApiCreateVaultResponse = {
  vault?: ApiVaultResponse
  generated_admin_keys?: ApiGeneratedAdminKey[]
}

export type ApiGetVaultsResponse = {
  vaults?: ApiVaultResponse[]
}

export type ApiGetPqcAlgorithmsResponse = {
  algorithms?: Array<ApiPqcAlgorithmResponse | string>
  algorithm_options?: ApiPqcAlgorithmResponse[]
}

export type ApiCreateProposalResponse = {
  proposal?: ApiProposalResponse
}

export type ApiSignProposalResponse = {
  proposal?: ApiProposalResponse
  approval_recorded?: boolean
  signature_recorded?: boolean
  signature_status?: string
  approval_count?: number
  threshold?: number
  ready_to_execute?: boolean
  signature?: string
  algorithm?: string
  public_key?: string
  key_generated?: boolean
  key_status?: string
  is_verified?: boolean
  verification?: ApiVerificationResponse
}

export type ApiWalletAlgorithmRegistration = {
  algorithm?: string
  label?: string
  public_key?: string
  key_file?: string
  key_generated?: boolean
  key_status?: string
}

export type ApiRegisterWalletPqcResponse = {
  wallet_address?: string
  registrations?: ApiWalletAlgorithmRegistration[]
}

export type ApiApproveProposalResponse = {
  proposal?: ApiProposalResponse
  approval_recorded?: boolean
  approval_count?: number
  threshold?: number
  ready_to_execute?: boolean
}

export type ApiExecuteProposalResponse = {
  proposal?: ApiProposalResponse
  approval_count?: number
  executed?: boolean
  transaction_hash?: string
  execution_status?: string
  execution_trace?: Array<{ step?: string; status?: string }>
  network?: string
  contract_address?: string
  onchain_proposal_id?: number
}

export type ApiRequestState<TArgs extends unknown[] = unknown[], TResult = unknown> = {
  run: (...args: TArgs) => Promise<TResult>
  loading: boolean
  error: string | null
  clearError: () => void
}

export function createVault(data: ApiPayload): Promise<ApiCreateVaultResponse>
export function createProposal(data: ApiPayload): Promise<ApiCreateProposalResponse>
export function signProposal(data: ApiPayload): Promise<ApiSignProposalResponse>
export function approveProposal(data: ApiPayload): Promise<ApiApproveProposalResponse>
export function verifySignature(data: ApiPayload): Promise<unknown>
export function getVaults(): Promise<ApiGetVaultsResponse>
export function getPqcAlgorithms(): Promise<ApiGetPqcAlgorithmsResponse>
export function registerWalletPqcAlgorithms(data: ApiPayload): Promise<ApiRegisterWalletPqcResponse>
export function getProposals(
  params?: Record<string, string | number | boolean | undefined>,
): Promise<{ proposals: ApiProposalResponse[] }>
export function executeProposal(
  id: number | string,
  executorWalletAddress?: string | null,
): Promise<ApiExecuteProposalResponse>
export function useApiRequest<TArgs extends unknown[], TResult>(
  apiFunction: (...args: TArgs) => Promise<TResult>,
): ApiRequestState<TArgs, TResult>
