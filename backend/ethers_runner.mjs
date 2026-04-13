import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  getAddress,
  isAddress,
  parseEther,
} from "ethers";

const EXECUTE_ABI = [
  "function executeProposal(uint256 proposalId) returns (bytes)",
];

function fail(message, extra = {}) {
  process.stderr.write(`${JSON.stringify({ error: message, ...extra })}\n`);
  process.exit(1);
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

function formatEthersError(error) {
  const code = typeof error?.code === "string" ? error.code : null;
  const message = getNestedErrorMessage(error);

  if (code === "INSUFFICIENT_FUNDS") {
    return {
      error: "Execution wallet has insufficient Sepolia ETH for the transfer value and gas.",
      code,
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
  if (weiValue <= 0n) {
    fail("amount_wei must be greater than zero.");
  }

  return weiValue;
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

function parsePayload(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    fail("Invalid JSON payload passed to ethers runner.");
  }
}

async function buildWallet(network) {
  const { rpcUrl, privateKey, network: normalizedNetwork } = readNetworkConfig(network);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  return { provider, wallet, network: normalizedNetwork };
}

async function sendTransactionAction(payload) {
  if (!payload.to || !isAddress(payload.to)) {
    fail("A valid destination address is required for sendTransaction.");
  }

  const value = parsePositiveWei(payload.value);
  const { wallet, network } = await buildWallet(payload.network);
  const tx = await wallet.sendTransaction({
    to: payload.to,
    value,
    data: payload.data || "0x",
  });
  const receipt = await waitForSuccessfulReceipt(tx, "Direct transfer");

  return {
    action: "sendTransaction",
    hash: tx.hash,
    from: wallet.address,
    to: tx.to,
    blockNumber: receipt?.blockNumber ?? null,
    status: "confirmed",
    receiptStatus: receipt?.status ?? null,
    network,
  };
}

async function normalizeProposalTransactionAction(payload) {
  const destination = String(payload.destination || "").trim();
  if (!destination || !isAddress(destination)) {
    fail("Invalid Ethereum address");
  }

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
    destination: getAddress(destination),
    amountEth: formatEther(amountWei),
    amountWei: amountWei.toString(),
  };
}

async function executeContractProposalAction(payload) {
  if (!payload.contractAddress || !isAddress(payload.contractAddress)) {
    fail("A valid contract address is required to execute the vault proposal.");
  }
  if (payload.proposalId === undefined || payload.proposalId === null) {
    fail("A proposalId is required to execute the vault proposal.");
  }

  const { wallet, network } = await buildWallet(payload.network);
  const contract = new Contract(payload.contractAddress, EXECUTE_ABI, wallet);
  const tx = await contract.executeProposal(BigInt(String(payload.proposalId)));
  const receipt = await waitForSuccessfulReceipt(tx, "Vault contract execution");

  return {
    action: "executeContractProposal",
    hash: tx.hash,
    from: wallet.address,
    contractAddress: payload.contractAddress,
    proposalId: Number(payload.proposalId),
    blockNumber: receipt?.blockNumber ?? null,
    status: "confirmed",
    receiptStatus: receipt?.status ?? null,
    network,
  };
}

async function main() {
  const action = process.argv[2];
  const payload = parsePayload(process.argv[3]);

  let response;
  if (action === "sendTransaction") {
    response = await sendTransactionAction(payload);
  } else if (action === "normalizeProposalTransaction") {
    response = await normalizeProposalTransactionAction(payload);
  } else if (action === "executeContractProposal") {
    response = await executeContractProposalAction(payload);
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
