# Quantum-Safe Multi-Admin Vault on Ethereum Sepolia

## 1. Project Title
Quantum-Safe Multi-Admin Vault on Ethereum Sepolia

## 2. Overview
This project is a full-stack treasury workflow that combines post-quantum cryptography, threshold-based multi-admin approvals, and real Ethereum Sepolia execution. Admins create vault-backed transfer proposals, sign a canonical proposal message with a PQC algorithm, record verified approvals, and execute only after the configured threshold is reached.

Why PQC matters: Ethereum transactions still rely on classical signatures, but treasury governance can add a quantum-safe approval layer before a transaction is ever relayed onchain. In this implementation, PQC signatures are generated and verified offchain with `liboqs-python`, while actual proposal creation, approval relays, and execution happen on Sepolia through `ethers.js`.

Real-world relevance: this is the kind of architecture you would use for treasury controls, multi-sig style governance, regulated operational wallets, or any workflow where one wallet should not be able to move funds alone.

## 3. Key Features
- Threshold-based multi-admin vaults with configurable approval counts.
- PQC signing with `Dilithium2`, `Falcon-512`, and `SPHINCS+-SHA2-128f-simple`.
- Real Sepolia smart contract deployment and real Sepolia transaction execution.
- Solidity `MultiAdminVault` contract with on-chain proposal storage, approvals, and execution.
- FastAPI backend for vault management, proposal tracking, signature verification, and execution orchestration.
- SQLite persistence for vaults, admins, proposals, signatures, approvals, and signature audit logs.
- Signature audit trail plus UI execution timeline and backend execution trace.
- MetaMask integration for wallet identity, Sepolia network gating, and admin-specific actions.
- Automatic PQC key generation and wallet-specific PQC key registration.
- Etherscan-ready transaction hashes after successful execution.

## 4. System Architecture
Frontend:
- React + TypeScript + Vite dashboard in `frontend/Q-DAY-VAULT`.
- Tailwind CSS and Framer Motion for the vault dashboard, proposal flow, signature status, and execution timeline.
- MetaMask is used for wallet identity and Sepolia gating.

Backend:
- FastAPI application in `backend/main.py`.
- Main API routes: `/pqc/algorithms`, `/pqc/register-wallet`, `/vaults`, `/proposals`, `/create-vault`, `/create-proposal`, `/sign-proposal`, `/approve-proposal`, `/verify-signature`, and `/execute`.
- SQLite database in `backend/vaults.db` by default, with optional override via `VAULT_DB_PATH`.

PQC layer:
- `pqc/dilithium.py` wraps `liboqs-python` for key generation, signing, and verification.
- Wallet-scoped keys are stored under `keys/<wallet-address>/` as `dilithium.json`, `falcon.json`, and `sphincs.json`.
- The backend stores verified signatures separately from approvals and also writes a signature audit log.

Blockchain layer:
- Solidity contract: `contracts/MultiAdminVault.sol`.
- Hardhat compiles the contract and produces the artifact consumed by the backend bridge at `artifacts/contracts/MultiAdminVault.sol/MultiAdminVault.json`.
- `backend/ethers_runner.mjs` uses `ethers.js` and a relayer wallet from `.env` to deploy vaults and submit real Sepolia transactions.

High-level flow:

```text
React + MetaMask
        |
        v
FastAPI Backend
        |
        v
PQC Sign / Verify with liboqs-python
        |
        v
SQLite State + Signature Audit Log
        |
        v
ethers.js Bridge
        |
        v
MultiAdminVault.sol on Sepolia
```

## 5. Workflow (Step-by-step)
1. Wallet connect: the frontend requires MetaMask and blocks vault actions until the connected wallet is on Sepolia.
2. Vault creation: the user enters a vault name, admin count, threshold, and one wallet address per admin. The current UI rotates the initial PQC algorithm assignment across Dilithium, Falcon, and SPHINCS+.
3. Contract deployment: if no existing `contract_address` is provided, the backend deploys `MultiAdminVault` on Sepolia using the admin wallet list and threshold. If a contract address is provided, the vault links to that deployed contract instead.
4. Funding vault: after deployment, send Sepolia ETH to the vault contract address. The contract has a `receive()` function, and the frontend reads the live contract balance.
5. Proposal creation: the user selects a vault, recipient, and ETH amount. The backend normalizes the transfer, stores the proposal locally, and for vault-backed flows also creates the on-chain proposal unless an `onchain_proposal_id` is supplied.
6. PQC signing: a registered admin wallet selects a PQC algorithm in the proposal modal. The backend resolves or generates the corresponding key, signs the canonical message, verifies it immediately, and stores the verified signature plus audit entry.
7. Multi-admin approval: the same wallet that produced the verified PQC signature records the approval. For vault-backed proposals, the backend also relays the on-chain approval to `approveProposal(...)`.
8. Execution: once the threshold is met, a registered admin executes the proposal. For vault-backed flows the backend calls `executeProposal(...)` on the Sepolia vault contract. A legacy direct-transfer fallback also exists in the backend, but the current UI is built around vault-contract mode.
9. Etherscan verification: after execution, the UI shows the transaction hash and a direct Sepolia Etherscan link.

## 6. Prerequisites
- A recent Node.js LTS release with `npm`.
- Python 3.10+ with `pip`.
- `liboqs` / `liboqs-python` available in your Python environment.
- MetaMask installed in the browser.
- Sepolia ETH for the backend relayer wallet and for any wallet you use to manually fund the vault contract.

## 7. Environment Setup
Create a root `.env` file:

```env
SEPOLIA_RPC_URL=
SEPOLIA_PRIVATE_KEY=
SEPOLIA_VAULT_CONTRACT_ADDRESS=
BACKEND_CORS_ORIGINS=
```

Variable reference:
- `SEPOLIA_RPC_URL`: Sepolia RPC endpoint used by Hardhat and by the backend `ethers.js` bridge for deployment, proposal relays, approvals, and execution.
- `SEPOLIA_PRIVATE_KEY`: 0x-prefixed private key for the backend relayer wallet. This is the wallet that pays gas for the current on-chain workflow.
- `SEPOLIA_VAULT_CONTRACT_ADDRESS`: Optional fallback contract address. Use it when linking an already deployed vault contract or when a vault record does not already have a stored contract address.
- `BACKEND_CORS_ORIGINS`: Comma-separated list of frontend origins allowed to call FastAPI. For local development, `http://localhost:5173` should be included.

Optional environment variable:
- `VAULT_DB_PATH`: Overrides the default SQLite database path. If omitted, the backend uses `backend/vaults.db`.

Notes:
- `.env` is already ignored by Git.
- The frontend API base URL is currently hardcoded to `http://localhost:8000` in `frontend/Q-DAY-VAULT/src/api.js`.

## 8. IMPORTANT: Gas & Wallet Requirement
The backend wallet from `SEPOLIA_PRIVATE_KEY` must have Sepolia ETH.

In the current implementation, that wallet is used for:
- Vault contract deployment.
- On-chain proposal creation.
- On-chain approval relays.
- Final on-chain execution.

How to derive the wallet address from the private key:

```bash
node --input-type=module -e "import { Wallet } from 'ethers'; console.log(new Wallet(process.argv[1]).address)" 0xYOUR_PRIVATE_KEY
```

How to fund it:
1. Copy the derived address.
2. Request Sepolia ETH from a faucet or transfer Sepolia ETH from another funded test wallet.
3. Confirm the balance before creating a vault or executing a proposal.

Important distinction:
- MetaMask is used for admin identity and wallet selection in the UI.
- The backend relayer wallet is the one paying gas for the current smart contract flow.

## 9. Installation Steps (Step-by-step)
1. Clone the repository and install root dependencies:

```bash
git clone <your-repo-url>
cd Q_DAY
npm install
```

2. Create the `.env` file from the example:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

3. Backend setup:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install fastapi uvicorn pydantic liboqs-python
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Bash activation alternative:

```bash
python -m venv .venv
source .venv/bin/activate
```

4. Frontend setup:

```bash
cd frontend/Q-DAY-VAULT
npm install
npm run dev
```

5. Contract setup:

```bash
cd ../..
npx hardhat compile
```

Compile before using the app. The backend bridge reads the compiled vault artifact from `artifacts/contracts/MultiAdminVault.sol/MultiAdminVault.json`.

## 10. Running the Project
1. Start the backend:

```bash
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

2. Start the frontend:

```bash
cd frontend/Q-DAY-VAULT
npm run dev
```

3. Connect MetaMask and switch to Sepolia.
4. Create a vault. If you leave the contract address blank, the backend will deploy `MultiAdminVault` on Sepolia automatically.
5. Fund the vault by sending Sepolia ETH to the deployed contract address from MetaMask or another funded Sepolia wallet.
6. Create a proposal in the dashboard flow. If the vault is contract-backed, the backend also creates the on-chain proposal unless you manually provide an existing `onchain_proposal_id`.
7. Sign the proposal with PQC in the proposal modal.
8. Approve it from the same wallet that produced the verified signature.
9. Execute it once the threshold is reached.
10. Open the returned transaction hash on Sepolia Etherscan from the proposal modal.

## 11. Testing Guide
1. Create a `2-of-3` or `3-of-3` vault with three real Sepolia admin addresses.
2. Use separate browser profiles or incognito windows with MetaMask to simulate multiple admins cleanly.
3. Have Admin 1 create the proposal and sign it.
4. Have Admin 2 switch in, sign the same proposal, and approve it.
5. If your threshold requires more approvals, repeat with Admin 3.
6. Execute the proposal from any registered admin wallet after the threshold is met.
7. Test all PQC algorithms by clicking `Register all PQC algorithms` in the proposal modal, then signing proposals with Dilithium, Falcon, and SPHINCS+ from the registered admin wallet.
8. Remember that approval must come from the same wallet that created the verified PQC signature.
9. Run the contract tests locally if you want to validate contract behavior in isolation:

```bash
npx hardhat test test/MultiAdminVault.ts
```

## 12. Common Issues & Fixes
- `Insufficient gas`: the relayer wallet from `SEPOLIA_PRIVATE_KEY` is underfunded. Fund that address with Sepolia ETH, then retry deployment, approval, or execution.
- `Value 0 ETH confusion`: the current dashboard flow is transfer-focused and rejects zero-value amounts. Use a value greater than `0`, or extend the UI/backend if you need zero-value contract-call proposals.
- `Wallet not registered for algorithm`: make sure the connected MetaMask account is one of the vault admin wallets. In the proposal modal, click `Register all PQC algorithms` to generate missing keys for Dilithium, Falcon, and SPHINCS+.
- `Cannot switch admin`: switch MetaMask to another admin account, reconnect if necessary, and refresh the page if the old session persists. Separate browser profiles or incognito windows are the easiest way to simulate multiple admins.
- `Faucet requires mainnet ETH`: some Sepolia faucets use anti-abuse checks. Use a different Sepolia faucet, a provider-backed faucet, or transfer test ETH from another funded Sepolia wallet.
- `Frontend cannot reach backend`: the frontend points to `http://localhost:8000` in `frontend/Q-DAY-VAULT/src/api.js`. If your backend runs elsewhere, update that file and keep `BACKEND_CORS_ORIGINS` in sync.

## 13. Screenshots (Optional placeholders)
**Dashboard**  
_Add a screenshot of the main dashboard with the connected MetaMask wallet, vault cards, and recent proposals._

**Proposal Modal**  
_Add a screenshot of the proposal details modal showing PQC verification, approvals, signature audit log, and action buttons._

**Execution Trace**  
_Add a screenshot of a successfully executed proposal with the transaction hash, Etherscan link, and execution timeline._

## 14. Future Improvements
- MetaMask-only execution so the admin wallet, not the backend relayer, pays gas.
- Layer 2 support for cheaper approval and execution flows.
- zk + PQC hybrid authorization for stronger privacy and verification guarantees.
- Better UI analytics for approval latency, signer activity, and treasury health.

## 15. License
MIT
