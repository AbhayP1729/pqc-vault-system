# Quantum-Safe Multi-Admin Vault System

A full-stack vault approval system that adds a post-quantum authorization layer to Ethereum transaction execution. The application combines Dilithium signatures, threshold-based multi-admin approvals, a FastAPI verification backend, a Solidity vault contract, and a React dashboard with MetaMask-based operator gating for Ethereum Sepolia.

## Description

The Quantum-Safe Multi-Admin Vault System is designed for treasury-style workflows where sensitive blockchain transactions should not be executed by a single operator. Admins create proposals, sign canonical proposal payloads with post-quantum cryptography, record verified approvals, and execute only after the configured approval threshold is met.

The current codebase includes:

- A React, Tailwind CSS, and Framer Motion frontend for vault and proposal operations.
- A FastAPI backend that persists vaults, proposals, signatures, approvals, and execution receipts in SQLite.
- A Dilithium wrapper around `liboqs-python` for key generation, signing, and verification.
- A Hardhat Solidity contract named `MultiAdminVault` for onchain threshold vault execution.
- A Node.js and ethers.js bridge that submits real Sepolia transactions and returns confirmed transaction hashes.

## Problem Statement

Most blockchain wallets and smart contract admin flows rely on classical elliptic-curve signatures such as ECDSA over `secp256k1`. A sufficiently capable fault-tolerant quantum computer running Shor's algorithm would threaten the discrete logarithm assumptions behind these signatures. For high-value vaults, governance systems, and treasury operators, that creates a long-term risk: public blockchain data is durable, while exposed public keys and historical signatures may remain useful to future attackers.

This project explores a hybrid mitigation path. It does not make Ethereum itself post-quantum. Instead, it adds a post-quantum approval plane before blockchain execution, so sensitive proposals require verified Dilithium signatures and threshold approvals before a Sepolia transaction is submitted.

## Features

- PQC-based signatures using Dilithium through `liboqs-python`.
- Multi-admin vault creation with configurable approval thresholds.
- Separate proposal signing and approval stages for clearer auditability.
- Real-time blockchain execution through ethers.js and Ethereum Sepolia.
- MetaMask integration for wallet identity, Sepolia network gating, and UI session state.
- Proposal lifecycle tracking across proposed, signed, approved, and executed states.
- SQLite-backed persistence for vaults, admins, proposals, signatures, approvals, and execution hashes.
- Etherscan transaction links after successful Sepolia execution.
- Solidity `MultiAdminVault` contract with threshold-gated proposal approval and execution.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, Vite, TypeScript, Tailwind CSS, Framer Motion, ethers.js |
| Backend | FastAPI, Pydantic, SQLite |
| PQC | Dilithium2, `liboqs-python`, base64-encoded key and signature payloads |
| Blockchain | Solidity `0.8.28`, Hardhat 3, ethers.js, Ethereum Sepolia |
| Wallet | MetaMask |

## System Architecture

Conceptual flow: `UI -> PQC approval layer -> Backend verification engine -> Smart Contract -> Blockchain`.

In this implementation, the FastAPI backend orchestrates the PQC module, persists approvals, and then submits execution through the ethers.js bridge.

```text
React UI + MetaMask
        |
        v
FastAPI Backend
        |
        v
PQC Module: Dilithium key generation, signing, verification
        |
        v
Approval Store: SQLite vaults, proposals, signatures, approvals
        |
        v
Execution Bridge: Node.js + ethers.js
        |
        v
MultiAdminVault / Sepolia transaction execution
        |
        v
Ethereum Sepolia + transaction hash returned to UI
```

Runtime flow:

1. The UI connects to MetaMask and requires Sepolia.
2. A vault is created with a threshold and one or more admin identities.
3. The backend generates or registers Dilithium admin public keys.
4. A proposal is created with destination, amount, metadata, and a canonical message to sign.
5. The backend signs and verifies the proposal message using Dilithium.
6. The backend records approvals only after a verified PQC signature exists.
7. When approvals meet the threshold, `/execute` submits the blockchain transaction.
8. The transaction hash is persisted and displayed in the frontend.

The backend supports two execution modes:

- Direct transfer mode, where the backend execution wallet sends Sepolia ETH to the proposal destination.
- Vault contract mode, where `/execute` calls `executeProposal(uint256)` on a configured `MultiAdminVault` contract when `contract_address` and an onchain proposal id or `execution_mode=vault_contract` payload are supplied.

## Project Structure

```text
backend/                  FastAPI app, SQLite schema, ethers.js bridge wrapper
pqc/                      Dilithium key generation, signing, and verification helpers
contracts/                Solidity contracts, including MultiAdminVault.sol
test/                     Hardhat tests for MultiAdminVault
frontend/Q-DAY-VAULT/     React + Vite dashboard
scripts/                  Hardhat example scripts
ignition/modules/         Hardhat Ignition examples
keys/                     Generated Dilithium key files, keep private
.env.example              Required environment variable template
```

## Installation Guide

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd Q_DAY
```

### 2. Configure Environment Variables

Create a local `.env` file from the example:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill in your Sepolia RPC URL, funded execution wallet private key, deployed vault contract address if using contract execution, and allowed frontend origins.

### 3. Setup Backend

Create and activate a Python virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate
```

On Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install backend dependencies:

```bash
pip install fastapi uvicorn pydantic liboqs-python
```

`liboqs-python` requires the Open Quantum Safe native library stack. If installation fails, install the platform-specific `liboqs` prerequisites first, then retry the Python package installation.

### 4. Setup Frontend

```bash
cd frontend/Q-DAY-VAULT
npm install
cd ../..
```

### 5. Setup Contracts

Install Hardhat dependencies from the repository root:

```bash
npm install
```

Compile the contracts:

```bash
npx hardhat compile
```

Run the contract tests:

```bash
npx hardhat test test/MultiAdminVault.ts
```

## Environment Variables

The `.env.example` file documents the required runtime variables:

```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
SEPOLIA_PRIVATE_KEY=YOUR_SEPOLIA_PRIVATE_KEY
SEPOLIA_VAULT_CONTRACT_ADDRESS=0xYourVaultContractAddress
BACKEND_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

| Variable | Purpose |
| --- | --- |
| `SEPOLIA_RPC_URL` | Sepolia RPC endpoint used by Hardhat and the backend ethers.js bridge. |
| `SEPOLIA_PRIVATE_KEY` | Private key for the funded Sepolia execution wallet. Do not commit this value. |
| `SEPOLIA_VAULT_CONTRACT_ADDRESS` | Deployed `MultiAdminVault` contract address used when contract execution is requested. |
| `BACKEND_CORS_ORIGINS` | Comma-separated list of frontend origins allowed to call the FastAPI backend. |

Generated Dilithium keypairs are written under `keys/`. Treat this directory as sensitive secret material.

## Running the Project

### Start the Backend

From the repository root:

```bash
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

The API will be available at:

```text
http://127.0.0.1:8000
```

Main backend endpoints:

```text
GET  /proposals
POST /create-vault
POST /create-proposal
POST /sign-proposal
POST /approve-proposal
POST /verify-signature
POST /execute
```

### Start the Frontend

In a separate terminal:

```bash
cd frontend/Q-DAY-VAULT
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

### Deploy the Contract, If Needed

If you already have a deployed `MultiAdminVault` on Sepolia, set `SEPOLIA_VAULT_CONTRACT_ADDRESS` in `.env` and skip deployment.

The current repository includes the `MultiAdminVault.sol` contract and a Counter Ignition example, but it does not include a dedicated `MultiAdminVault` deployment module yet. To deploy the vault contract to Sepolia, add a Hardhat Ignition module or deployment script that passes:

- `admins`: an array of Ethereum admin addresses.
- `threshold`: the required number of onchain approvals.
- optional deployment value: Sepolia ETH to fund the vault.

Then deploy with the Sepolia network:

```bash
npx hardhat ignition deploy --network sepolia ignition/modules/<YourVaultModule>.ts
```

After deployment, update:

```env
SEPOLIA_VAULT_CONTRACT_ADDRESS=<deployed-contract-address>
```

## Usage

1. Open the frontend and connect MetaMask.
2. Switch MetaMask to Ethereum Sepolia when prompted.
3. Create a vault by entering a vault name, admin count, and approval threshold.
4. Create a proposal by selecting the vault, entering a title, recipient address, and ETH amount.
5. Open the proposal details modal.
6. Click `Sign with PQC` to generate and verify a Dilithium signature for the proposal.
7. Click `Approve` to record the verified admin approval.
8. Repeat signing and approval until the threshold is reached.
9. Click `Execute` to submit the Sepolia transaction.
10. Review the returned transaction hash and open the Etherscan link from the proposal modal.

For contract-backed execution, create or link the matching onchain proposal, include the onchain proposal id or contract execution payload when creating the backend proposal, and ensure `SEPOLIA_VAULT_CONTRACT_ADDRESS` is configured.

## Screenshots

Add project screenshots here after capturing the running application:

```text
docs/screenshots/dashboard.png
docs/screenshots/proposal-modal.png
docs/screenshots/execution-confirmation.png
```

Suggested views:

- Dashboard with connected Sepolia wallet.
- Vault creation form and live vault card.
- Proposal lifecycle modal showing signing, approval, and execution.
- Etherscan transaction confirmation.

## Future Improvements

- Add a dedicated Hardhat Ignition module for deploying `MultiAdminVault`.
- Add frontend controls for contract-backed proposal creation and `onchain_proposal_id` linking.
- Add a `/vaults` API endpoint so the frontend can rehydrate vaults across browser sessions.
- Add a `requirements.txt` or `pyproject.toml` for reproducible backend setup.
- Move generated PQC private keys into a secure keystore or HSM-backed storage layer.
- Add authentication and role binding between MetaMask addresses and registered PQC admins.
- Add WebSocket or server-sent event updates for live proposal state changes.
- Add integration tests for FastAPI, PQC signing, and Sepolia execution error handling.
- Add a repository-level deployment guide and screenshots.

## License

The `MultiAdminVault.sol` contract is marked with the MIT SPDX license identifier. Add a repository-level `LICENSE` file before publishing the full project under a formal license.
