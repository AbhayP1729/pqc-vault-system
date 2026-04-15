import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Contract,
  ContractFactory,
  Interface,
  JsonRpcProvider,
  Wallet,
  formatEther,
  getAddress,
  isAddress,
  parseEther,
} from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const VAULT_ARTIFACT_PATH = path.join(
  PROJECT_ROOT,
  "artifacts",
  "contracts",
  "MultiAdminVault.sol",
  "MultiAdminVault.json",
);

let vaultArtifactCache = null;
let vaultInterfaceCache = null;

function fail(message, extra = {}) {
  process.stderr.write(`${JSON.stringify({ error: message, ...extra })}\n`);
  process.exit(1);
}

function parsePayload(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    fail("Invalid JSON payload passed to ethers runner.");
  }
}

function readVaultArtifact() {
  if (!vaultArtifactCache) {
    vaultArtifactCache = JSON.parse(fs.readFileSync(VAULT_ARTIFACT_PATH, "utf8"));
  }

  return vaultArtifactCache;
}

function getVaultInterface() {
  if (!vaultInterfaceCache) {
    vaultInterfaceCache = new Interface(readVaultArtifact().abi);
  }

  return vaultInterfaceCache;
}

function getNestedErrorMessage(error) {
  const candidates = [
    error?.shortMessage,
    error?.reason,
    error?.info?.error?.message,
    error?.error?.message,
    error?.message,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "Unknown ethers.js error.";
}

function getCustomErrorData(error) {
  const candidates = [
    error?.data,
    error?.info?.error?.data,
    error?.error?.data,
    error?.receipt?.revertReason,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("0x")) {
      return candidate;
    }
  }

  return null;
}

function decodeVaultCustomError(error) {
  const data = getCustomErrorData(error);
  if (!data) {
    return null;
  }

  try {
    return getVaultInterface().parseError(data);
  } catch {
    return null;
  }
}

function formatCustomError(parsedError) {
  if (!parsedError) {
    return null;
  }

  const args = Array.from(parsedError.args ?? []);
  const name = parsedError.name;

  if (name === "InsufficientBalance") {
    const [available, required] = args;
    return {
      error: `Vault contract has insufficient funds. Available ${formatEther(available)} ETH, required ${formatEther(required)} ETH.`,
      code: "VAULT_INSUFFICIENT_BALANCE",
    };
  }

  if (name === "InsufficientApprovals") {
    const [currentApprovals, thresholdRequired] = args;
    return {
      error: `Vault approval threshold not met on-chain. ${currentApprovals.toString()} / ${thresholdRequired.toString()} approvals recorded.`,
      code: "VAULT_INSUFFICIENT_APPROVALS",
    };
  }

  if (name === "ProposalAlreadyApproved") {
    return {
      error: "This admin wallet has already approved the on-chain proposal.",
      code: "VAULT_ALREADY_APPROVED",
    };
  }

  if (name === "ProposalAlreadyExecuted") {
    return {
      error: "This on-chain proposal has already been executed.",
      code: "VAULT_ALREADY_EXECUTED",
    };
  }

  if (name === "ProposalDoesNotExist") {
    return {
      error: "The on-chain proposal does not exist for this vault.",
      code: "VAULT_PROPOSAL_NOT_FOUND",
    };
  }

  if (name === "NotAdmin") {
    return {
      error: "The specified wallet is not registered as a vault admin.",
      code: "VAULT_NOT_ADMIN",
    };
  }

  if (name === "NotRelayer") {
    return {
      error: "The backend relayer is not authorized for this vault contract.",
      code: "VAULT_NOT_RELAYER",
    };
  }

  if (name === "InvalidAdmin") {
    return {
      error: "The vault contract rejected an invalid admin or target address.",
      code: "VAULT_INVALID_ADMIN",
    };
  }

  if (name === "InvalidThreshold") {
    return {
      error: "The vault contract rejected the configured admin threshold.",
      code: "VAULT_INVALID_THRESHOLD",
    };
  }

  if (name === "DuplicateAdmin") {
    return {
      error: "The vault contract rejected duplicate admin wallet addresses.",
      code: "VAULT_DUPLICATE_ADMIN",
    };
  }

  if (name === "ExecutionFailed") {
    return {
      error: "The vault contract call reverted while executing the proposal payload.",
      code: "VAULT_EXECUTION_FAILED",
    };
  }

  return {
    error: `Vault contract reverted with ${name}.`,
    code: `VAULT_${name.toUpperCase()}`,
  };
}

function formatEthersError(error) {
  const customError = formatCustomError(decodeVaultCustomError(error));
  if (customError) {
    return {
      ...customError,
      transactionHash: error?.receipt?.hash ?? error?.transactionHash ?? error?.hash ?? null,
      receiptStatus: typeof error?.receipt?.status === "number" ? error.receipt.status : null,
    };
  }

  const code = typeof error?.code === "string" ? error.code : null;
  const message = getNestedErrorMessage(error);

  if (code === "INSUFFICIENT_FUNDS") {
    return {
      error: "Execution wallet has insufficient Sepolia ETH for gas.",
      code: "RELAYER_INSUFFICIENT_FUNDS",
    };
  }

  if (code === "CALL_EXCEPTION" || code === "UNPREDICTABLE_GAS_LIMIT") {
    return {
      error: `Contract execution reverted: ${message}`,
      code,
      transactionHash: error?.receipt?.hash ?? error?.transactionHash ?? null,
      receiptStatus: typeof error?.receipt?.status === "number" ? error.receipt.status : null,
    };
  }

  if (code === "NETWORK_ERROR" || code === "SERVER_ERROR" || code === "TIMEOUT") {
    return {
      error: `Unable to reach the Sepolia RPC endpoint: ${message}`,
      code,
    };
  }

  if (code === "NONCE_EXPIRED") {
    return {
      error: "Execution wallet nonce is out of sync with Sepolia. Retry after pending transactions are mined.",
      code,
    };
  }

  return {
    error: message,
    code,
    transactionHash: error?.receipt?.hash ?? error?.transactionHash ?? error?.hash ?? null,
    receiptStatus: typeof error?.receipt?.status === "number" ? error.receipt.status : null,
  };
}

function parsePositiveWei(value) {
  const normalizedValue = String(value ?? "").trim();
  if (!normalizedValue || !/^\d+$/.test(normalizedValue)) {
    fail("amount_wei must be a positive integer string.");
  }

  const weiValue = BigInt(normalizedValue);
  if (weiValue < 0n) {
    fail("amount_wei must be zero or greater.");
  }

  return weiValue;
}

function normalizeAddress(value, fieldName) {
  const normalizedValue = String(value ?? "").trim();
  if (!normalizedValue || !isAddress(normalizedValue)) {
    fail(`A valid ${fieldName} is required.`);
  }

  return getAddress(normalizedValue);
}

function normalizeAdminAddresses(admins) {
  if (!Array.isArray(admins) || admins.length === 0) {
    fail("At least one admin wallet address is required to deploy the vault.");
  }

  const normalizedAdmins = admins.map((admin) => normalizeAddress(admin, "admin wallet address"));
  if (new Set(normalizedAdmins.map((admin) => admin.toLowerCase())).size !== normalizedAdmins.length) {
    fail("Duplicate admin wallet addresses are not allowed.");
  }

  return normalizedAdmins;
}

async function waitForSuccessfulReceipt(tx, context) {
  const receipt = await tx.wait();
  if (receipt && receipt.status !== 1) {
    fail(`${context} was mined but failed onchain.`, {
      code: "TRANSACTION_FAILED",
      transactionHash: tx.hash,
      receiptStatus: typeof receipt.status === "number" ? receipt.status : null,
    });
  }

  return receipt;
}

function readNetworkConfig(network) {
  const normalized = String(network || "sepolia").trim().toUpperCase().replace(/-/g, "_");
  const rpcUrl = process.env[`${normalized}_RPC_URL`];
  const privateKey = process.env[`${normalized}_PRIVATE_KEY`];

  if (!rpcUrl) {
    fail(`Missing required environment variable: ${normalized}_RPC_URL.`);
  }
  if (!privateKey) {
    fail(`Missing required environment variable: ${normalized}_PRIVATE_KEY.`);
  }

  return { rpcUrl, privateKey, network: normalized.toLowerCase() };
}

async function buildWallet(network) {
  const { rpcUrl, privateKey, network: normalizedNetwork } = readNetworkConfig(network);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  return { provider, wallet, network: normalizedNetwork };
}

function getVaultContract(address, wallet) {
  return new Contract(address, readVaultArtifact().abi, wallet);
}

function extractEventArgs(receipt, eventName) {
  const contractInterface = getVaultInterface();

  for (const log of receipt?.logs ?? []) {
    try {
      const parsedLog = contractInterface.parseLog(log);
      if (parsedLog?.name === eventName) {
        return parsedLog.args;
      }
    } catch {
      // Ignore unrelated logs.
    }
  }

  return null;
}

async function deployVaultAction(payload) {
  const adminAddresses = normalizeAdminAddresses(payload.admins);
  const threshold = BigInt(String(payload.threshold ?? ""));
  if (threshold <= 0n || threshold > BigInt(adminAddresses.length)) {
    fail("Vault threshold must be between 1 and the number of admins.");
  }

  const { wallet, network } = await buildWallet(payload.network);
  const artifact = readVaultArtifact();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(adminAddresses, threshold);
  const deploymentTx = contract.deploymentTransaction();
  const receipt = deploymentTx
    ? await waitForSuccessfulReceipt(deploymentTx, "Vault deployment")
    : null;
  const contractAddress = await contract.getAddress();

  return {
    action: "deployVault",
    contractAddress,
    deploymentTxHash: deploymentTx?.hash ?? null,
    deployer: wallet.address,
    relayer: wallet.address,
    blockNumber: receipt?.blockNumber ?? null,
    status: "confirmed",
    receiptStatus: receipt?.status ?? null,
    network,
  };
}

async function createContractProposalAction(payload) {
  const contractAddress = normalizeAddress(payload.contractAddress, "contract address");
  const proposer = normalizeAddress(payload.proposer, "proposer wallet address");
  const target = normalizeAddress(payload.target, "proposal target address");
  const value = parsePositiveWei(payload.value);
  const data = String(payload.data ?? "0x").trim() || "0x";
  const description = String(payload.description ?? "").trim();

  const { wallet, network } = await buildWallet(payload.network);
  const contract = getVaultContract(contractAddress, wallet);
  const tx = await contract.createProposal(proposer, target, value, data, description);
  const receipt = await waitForSuccessfulReceipt(tx, "Vault proposal creation");
  const eventArgs = extractEventArgs(receipt, "ProposalCreated");
  if (!eventArgs) {
    fail("Vault proposal was created but the ProposalCreated event could not be parsed.", {
      code: "PROPOSAL_EVENT_MISSING",
      transactionHash: tx.hash,
      receiptStatus: receipt?.status ?? null,
    });
  }

  return {
    action: "createContractProposal",
    hash: tx.hash,
    contractAddress,
    proposer,
    target,
    value: value.toString(),
    proposalId: Number(eventArgs.proposalId),
    blockNumber: receipt?.blockNumber ?? null,
    status: "confirmed",
    receiptStatus: receipt?.status ?? null,
    network,
  };
}

async function approveContractProposalAction(payload) {
  const contractAddress = normalizeAddress(payload.contractAddress, "contract address");
  const admin = normalizeAddress(payload.admin, "admin wallet address");
  if (payload.proposalId === undefined || payload.proposalId === null) {
    fail("A proposalId is required to approve the vault proposal.");
  }

  const proposalId = BigInt(String(payload.proposalId));
  const { wallet, network } = await buildWallet(payload.network);
  const contract = getVaultContract(contractAddress, wallet);
  const tx = await contract.approveProposal(proposalId, admin);
  const receipt = await waitForSuccessfulReceipt(tx, "Vault proposal approval");

  return {
    action: "approveContractProposal",
    hash: tx.hash,
    contractAddress,
    admin,
    proposalId: Number(proposalId),
    blockNumber: receipt?.blockNumber ?? null,
    status: "confirmed",
    receiptStatus: receipt?.status ?? null,
    network,
  };
}

async function executeContractProposalAction(payload) {
  const contractAddress = normalizeAddress(payload.contractAddress, "contract address");
  const executor = normalizeAddress(payload.executor, "executor wallet address");
  if (payload.proposalId === undefined || payload.proposalId === null) {
    fail("A proposalId is required to execute the vault proposal.");
  }

  const proposalId = BigInt(String(payload.proposalId));
  const { wallet, network } = await buildWallet(payload.network);
  const contract = getVaultContract(contractAddress, wallet);
  const tx = await contract.executeProposal(proposalId, executor);
  const receipt = await waitForSuccessfulReceipt(tx, "Vault contract execution");

  return {
    action: "executeContractProposal",
    hash: tx.hash,
    contractAddress,
    executor,
    proposalId: Number(proposalId),
    blockNumber: receipt?.blockNumber ?? null,
    status: "confirmed",
    receiptStatus: receipt?.status ?? null,
    network,
  };
}

async function sendTransactionAction(payload) {
  const to = normalizeAddress(payload.to, "destination address");
  const value = parsePositiveWei(payload.value);
  const { wallet, network } = await buildWallet(payload.network);
  const tx = await wallet.sendTransaction({
    to,
    value,
    data: payload.data || "0x",
  });
  const receipt = await waitForSuccessfulReceipt(tx, "Direct transfer");

  return {
    action: "sendTransaction",
    hash: tx.hash,
    from: wallet.address,
    to,
    blockNumber: receipt?.blockNumber ?? null,
    status: "confirmed",
    receiptStatus: receipt?.status ?? null,
    network,
  };
}

async function normalizeProposalTransactionAction(payload) {
  const destination = normalizeAddress(payload.destination, "destination address");
  const amountEth = String(payload.amountEth || "").trim();
  if (!amountEth) {
    fail("Enter valid ETH amount");
  }

  let amountWei;
  try {
    amountWei = parseEther(amountEth);
  } catch {
    fail("Enter valid ETH amount");
  }

  if (amountWei <= 0n) {
    fail("Enter valid ETH amount");
  }

  return {
    action: "normalizeProposalTransaction",
    destination,
    amountEth: formatEther(amountWei),
    amountWei: amountWei.toString(),
  };
}

async function main() {
  const action = process.argv[2];
  const payload = parsePayload(process.argv[3]);

  let response;
  if (action === "deployVault") {
    response = await deployVaultAction(payload);
  } else if (action === "createContractProposal") {
    response = await createContractProposalAction(payload);
  } else if (action === "approveContractProposal") {
    response = await approveContractProposalAction(payload);
  } else if (action === "executeContractProposal") {
    response = await executeContractProposalAction(payload);
  } else if (action === "sendTransaction") {
    response = await sendTransactionAction(payload);
  } else if (action === "normalizeProposalTransaction") {
    response = await normalizeProposalTransactionAction(payload);
  } else {
    fail("Unsupported ethers.js action.");
  }

  process.stdout.write(`${JSON.stringify(response)}\n`);
}

main().catch((error) => {
  if (error instanceof Error) {
    const formattedError = formatEthersError(error);
    fail(formattedError.error, formattedError);
    return;
  }

  fail(String(error));
});
