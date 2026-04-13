# 🧠 AGENTS.md — Quantum-Safe Multi-Admin Vault System

## 🎯 Objective
Build a full-stack decentralized vault system that uses Post-Quantum Cryptography (PQC) for secure multi-admin approvals before executing blockchain transactions.

---

## 🧩 System Overview

Actors:
- Admin Users (multiple)
- Backend Verification Engine
- Smart Contract (Vault)
- Blockchain Network

Core Flow:
1. Admin creates proposal
2. Admin signs using PQC
3. Backend verifies signature
4. Approvals tracked
5. Smart contract executes when threshold met

---

## 🤖 Agents

### 1. UI Agent (Frontend)
**Responsibility:**
- Build futuristic dashboard
- Display vaults, proposals, approvals
- Animate transitions using Framer Motion

**Tech Stack:**
- React + Vite
- Tailwind CSS
- Framer Motion

**Key Components:**
- VaultDashboard
- ProposalCard
- ApprovalProgressBar
- SignatureStatusIndicator
- ExecutionTimeline

---

### 2. PQC Agent
**Responsibility:**
- Generate Dilithium keypairs
- Sign messages
- Verify signatures

**Tech Stack:**
- liboqs
- oqs-python

**Functions:**
- generate_keypair()
- sign_message(message, private_key)
- verify_signature(message, signature, public_key)

---

### 3. Backend Agent
**Responsibility:**
- API endpoints
- Signature verification
- Proposal tracking
- Trigger blockchain execution

**Tech Stack:**
- FastAPI (recommended)
- SQLite / PostgreSQL

**Endpoints:**
- POST /create-vault
- POST /create-proposal
- POST /sign-proposal
- POST /verify-signature
- GET /proposals
- POST /execute

---

### 4. Smart Contract Agent
**Responsibility:**
- Store vault state
- Manage approvals
- Execute transactions

**Tech Stack:**
- Solidity
- Hardhat
- ethers.js

**Functions:**
- createVault()
- proposeTransaction()
- approveTransaction()
- executeTransaction()

---

### 5. Blockchain Agent
**Responsibility:**
- Deploy contracts
- Send real transactions
- Return tx hash

**Network:**
- Sepolia / Polygon Mumbai

---

### 6. Animation Agent (UI Enhancement)
**Responsibility:**
- Smooth transitions
- Visual feedback for:
  - Signature verification
  - Approval progress
  - Execution pipeline

**Tech Stack:**
- Framer Motion

---

## 🔄 Data Flow

Frontend → Backend → PQC Verification → Smart Contract → Blockchain

---

## 🧪 Demo Features

- Multi-admin vault creation
- PQC-based signature system
- Real-time approval tracking
- Blockchain execution
- Quantum attack simulation toggle

---

## 🚫 Constraints

- No mock transactions
- No hardcoded keys
- All signatures must be real PQC
- Blockchain interaction must be real (testnet)

---

## ✅ Success Criteria

- End-to-end working system
- Real transaction execution
- Fully interactive UI
- Explainable pipeline visualization