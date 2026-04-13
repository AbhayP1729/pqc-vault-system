# From secp256k1 to ML-DSA: A Code-Level Anatomy of a Quantum-Safe Multi-Admin Vault on Ethereum Sepolia

## Abstract
Blockchains inherit a profound asymmetry from classical public-key cryptography: settlement is transparent and persistent, while signature security is contingent on assumptions that large-scale quantum computers are expected to erode. This project implements a hybrid mitigation path rather than a theoretical rewrite. A React/Tailwind/Framer frontend gates operator actions through MetaMask, a FastAPI backend manages proposal state and approval thresholds, a Python post-quantum module signs and verifies proposal payloads with Dilithium2 via [liboqs](https://open-quantum-safe.github.io/liboqs/), and a Node/[ethers.js](https://docs.ethers.org/v6/) bridge pushes real transactions to [Ethereum Sepolia](https://ethereum.org/developers/docs/networks/). The Solidity vault contract encodes threshold governance onchain, while the current observed runtime path uses off-chain PQC approvals followed by Sepolia execution. The result is a working prototype of quantum-aware treasury control: not a simulation, not a slide deck, but an executable system with stored signatures, persisted approvals, and recorded transaction hashes.

## Introduction
The modern blockchain stack still leans heavily on elliptic-curve cryptography. Ethereum externally owned accounts ultimately authenticate with ECDSA over `secp256k1`, and once a transaction is published, its signature exposes enough information to recover the public key behind the account. Under classical assumptions, this is acceptable. Under a fault-tolerant quantum threat model, it is not.

The core problem is asymptotic. The security of elliptic-curve signatures rests on the hardness of the discrete logarithm problem. [Shor's algorithm](https://en.wikipedia.org/wiki/Shor%27s_algorithm) turns that hardness assumption from exponential-style brute-force resistance into a polynomial-time target once sufficiently capable quantum hardware exists. The practical implication is severe: treasury wallets, governance operators, and long-lived public identities become future liabilities the moment their public-key material is inferable from onchain activity.

This is not just a cryptography problem. It is an operational systems problem. If blockchain governance remains bound to classical signatures while settlement histories remain public forever, then high-value wallets become durable attack surfaces. The project analyzed here addresses that issue by inserting a post-quantum approval layer into the vault workflow while retaining EVM settlement.

## Quantum Threat Deep Dive
At the signature layer, the main classical assumption is elliptic-curve discrete logarithm hardness. Given a generator point `G` and public key `Q = dG`, recovering the secret scalar `d` is believed to be infeasible on classical machines for well-chosen curves such as `secp256k1`. That belief is exactly what secures Ethereum transaction authorization today.

Shor's algorithm breaks that confidence by reducing integer factorization and discrete logarithms to polynomial-time quantum procedures. The essential move is not "faster brute force." It is structure extraction. Quantum period-finding, implemented through the quantum Fourier transform (QFT), exploits algebraic regularity in groups where classical attacks require astronomically expensive search. For elliptic-curve systems, that means the security margin collapses once quantum hardware reaches fault-tolerant scale.

Hashing degrades differently. [Grover's algorithm](https://en.wikipedia.org/wiki/Grover%27s_algorithm) does not annihilate Keccak or SHA-style primitives outright; instead it reduces brute-force complexity quadratically. A 256-bit hash does not become trivial, but its effective security margin is cut roughly in half against unstructured search. That distinction matters because blockchain security is layered:

- The signature layer faces a potentially catastrophic asymptotic break from Shor.
- The hash layer faces a serious but more gradual reduction from Grover.

The more realistic threat model is hybrid. Quantum capability does not arrive into a vacuum; it arrives into an ecosystem already rich with public transaction graphs, high-value account labeling, key-reuse patterns, and treasury heuristics. Classical analytics can identify the most lucrative targets. Quantum algorithms can then be reserved for exactly those exposed public-key instances that matter. In that sense, "pattern extraction via superposition" is best understood not as magic key revelation, but as a future ability to evaluate structured candidate spaces without classical serial enumeration.

That is why a 2028-2035 horizon is increasingly treated as an engineering planning window rather than a precise prophecy. The risk is not that every Ethereum key breaks tomorrow. The risk is that once the cryptanalytic threshold is crossed, migration time disappears for systems that waited too long.

## Why Blockchain Is at Risk
Blockchain systems expose risk asymmetrically across layers.

First, the signature layer is the primary fault line. If an attacker can derive a private signing key from an exposed public key, they can authorize arbitrary transactions. In Ethereum, that means transaction forgery, treasury drain, governance capture, and irreversible state transitions.

Second, the hash layer is not the immediate first point of failure, but it is still relevant. Address derivation, Merkle commitments, and transaction integrity all lean on hash security. Grover does not instantly invalidate these constructions, but it compresses their long-term margin.

Third, public-key exposure is persistent. A blockchain does not forget. A transaction signed years before a practical quantum machine exists can still have revealed cryptographic material that becomes exploitable later. This is why "harvest now, exploit later" is not limited to encrypted archives; it applies to public signing histories too.

## Project Overview
The codebase implements a hybrid post-quantum vault architecture composed of four distinct planes:

1. A React frontend for proposal creation, review, approval, and execution.
2. A FastAPI backend that stores vault state, enforces threshold approval rules, and orchestrates cryptographic checks.
3. A Python post-quantum module that generates keys and performs Dilithium2 signing and verification through [liboqs](https://open-quantum-safe.github.io/liboqs/).
4. An Ethereum execution bridge that submits real Sepolia transactions via [ethers.js](https://docs.ethers.org/v6/).

The contribution is not that the EVM itself has become post-quantum. It has not. The contribution is that proposal authorization is lifted out of the classical ECDSA-only model and redefined as a post-quantum approval workflow that still terminates in real blockchain settlement.

## System Architecture
The implementation is best understood as a hybrid approval plane sitting above a conventional Ethereum execution plane.

### Frontend
The frontend is a Vite/React application styled with Tailwind CSS v4 and animated with Framer Motion. Its operational responsibilities are narrowly defined:

- Connect to MetaMask.
- Enforce the Sepolia chain id (`0xaa36a7`).
- Create vaults and proposals through FastAPI.
- Trigger proposal signing, approval, and execution.
- Display approval progress and Etherscan links after settlement.

An important detail is that the frontend does not submit Ethereum transactions itself. In the current implementation, MetaMask is an identity and network-gating layer, not the final settlement signer. The browser uses `ethers` primarily for input validation: checking addresses, parsing ETH amounts, and normalizing values before API submission.

### Backend
The FastAPI backend is the system's control plane. It exposes the endpoints `/create-vault`, `/create-proposal`, `/sign-proposal`, `/approve-proposal`, `/verify-signature`, `/execute`, and `/proposals`. State is persisted in SQLite across the tables:

- `vaults`
- `vault_admins`
- `proposals`
- `proposal_signatures`
- `approvals`

The backend also manages the `keys/` directory, where generated Dilithium keypairs are stored as JSON files. Vault creation can either register externally supplied public keys or instruct the backend to generate keypairs server-side.

### PQC Module
The Python module `pqc/dilithium.py` wraps [liboqs](https://open-quantum-safe.github.io/liboqs/) and exposes three operations:

- `generate_keypair`
- `sign_message`
- `verify_signature`

Keys and signatures are base64-encoded for transport and persistence. In runtime testing, the environment successfully generated a Dilithium2 keypair, signed a message, and verified the signature end-to-end.

### Smart Contract
The Solidity contract `MultiAdminVault.sol` implements classic threshold vault semantics:

- The constructor validates the admin set and immutable threshold.
- `createProposal` stores `target`, `value`, `data`, `description`, and `createdAt`.
- `approveProposal` rejects duplicate approvals per admin and increments `approvalCount`.
- `executeProposal` requires `approvalCount >= threshold`, checks balance, marks the proposal executed, and performs a low-level `target.call{value: proposal.value}(proposal.data)`.

Local Hardhat tests pass for deployment, threshold-gated execution, and duplicate-approval rejection.

### Blockchain Execution
The chain bridge is split intentionally:

- Python normalizes and validates the execution request.
- Node runs `ethers_runner.mjs`.
- `ethers_runner.mjs` builds `JsonRpcProvider` and `Wallet` objects from `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY`.
- Transactions are submitted to Sepolia and awaited until a successful receipt is returned.

The `.env` file in the repo points `SEPOLIA_RPC_URL` to an [Infura](https://www.infura.io/) Sepolia endpoint, so the execution path is wired to real public infrastructure rather than a mock RPC.

### Data Flow
The observed runtime path in this repository is:

```text
React UI + MetaMask session
    -> FastAPI /create-vault
    -> FastAPI /create-proposal
    -> FastAPI /sign-proposal
         -> liboqs Dilithium2 sign
         -> liboqs Dilithium2 verify
    -> FastAPI /approve-proposal
    -> FastAPI /execute
         -> Node ethers.js runner
         -> Infura Sepolia RPC
         -> Sepolia transaction receipt
         -> execution_tx_hash persisted
    -> UI renders hash + Etherscan link
```

The contract-capable path is also present in code:

```text
If contract_address is configured
and onchain_proposal_id or execution_mode=vault_contract is supplied,
FastAPI /execute
    -> ethers Contract.executeProposal(proposalId)
    -> MultiAdminVault on Sepolia
```

That distinction matters. The repository contains a real threshold vault contract and a backend adapter for contract execution, but the currently observed live records in `vaults.db` show direct-transfer execution rather than contract-backed proposal execution.

## PQC Implementation Details
The post-quantum design is stronger than a simple "swap ECDSA for Dilithium" slogan. The implementation signs a canonical proposal message built from a deterministic JSON structure containing:

- `proposal_id`
- `vault_id`
- `title`
- `description`
- `destination`
- `amount_eth`
- `amount_wei`
- `payload`
- `created_at`

The backend serializes this message with sorted keys and stable separators before signing. That is a subtle but important systems choice: post-quantum signatures are only as reliable as the byte-string canonicalization they authenticate.

The signing pipeline is:

1. Load the admin's stored key file from `keys/`.
2. Decode the base64 Dilithium private key.
3. Sign the canonical message using `Signature("Dilithium2", secret_key=...)`.
4. Immediately verify the signature with the stored public key.
5. Persist the verified signature in `proposal_signatures`.

Approval is intentionally separated from signature creation. A proposal cannot be approved unless a verified PQC signature already exists. The backend also binds the approval wallet to the same MetaMask address that initiated the signature step when such a wallet address is present. In effect, the system splits authorization into two gates:

- post-quantum cryptographic validity
- operator-session consistency

This is a practical design for transitional systems. The MetaMask wallet identifies the acting operator, while Dilithium authenticates the proposal approval material.

Why does Dilithium help? Because its security is based on lattice problems such as Module-LWE and Module-SIS, for which no Shor-style polynomial-time quantum break is known. In NIST terminology, [FIPS 204](https://csrc.nist.gov/pubs/fips/204/final) standardizes ML-DSA, derived from CRYSTALS-Dilithium. The library surface here still uses the pre-standardization family name `Dilithium2`, but conceptually it occupies the ML-DSA class of lattice signatures.

## Real-Time Execution, Not Simulation
The system's blockchain step is real.

On execution, the backend does not toggle a local flag and call it success. It invokes `wallet.sendTransaction(...)` for direct transfers or `contract.executeProposal(...)` for contract mode, waits for mining, checks that `receipt.status === 1`, stores `execution_tx_hash`, and returns the hash to the UI. The frontend then constructs a direct [Sepolia Etherscan](https://sepolia.etherscan.io/) URL and displays it in the proposal modal.

This means three things:

1. Gas is real, even on testnet.
2. Nonce state matters.
3. RPC reachability and receipt finality are operational dependencies.

The error surface in `ethers_runner.mjs` reflects this reality. It explicitly maps:

- insufficient funds
- gas estimation failure
- contract revert conditions
- network and server errors
- nonce desynchronization

The runtime records in `vaults.db` show persisted Sepolia transaction hashes for multiple executed proposals. In other words, this repository has crossed the line from conceptual demo to actual network interaction.

One nuance is essential for accuracy: every observed executed proposal in the local database uses `onchain_proposal_id = null`, and recent vaults have `contract_address = None`. So the live execution evidence proves real Sepolia settlement, but it proves the direct-transfer execution mode, not end-to-end use of the onchain `MultiAdminVault` proposal/approval lifecycle. The contract path is implemented and test-covered, but not the currently dominant runtime path.

## Classical vs Post-Quantum Signatures

| Property | ECDSA (`secp256k1`) | Dilithium2 / ML-DSA family |
| --- | --- | --- |
| Security basis | Elliptic-curve discrete log | Module-LWE / Module-SIS lattice problems |
| Quantum resistance | Broken by large-scale Shor-style attacks | No known polynomial-time quantum break |
| Public key size | ~33 bytes compressed or 64 bytes uncompressed | ~1,312 bytes raw |
| Private key size | 32 bytes | ~2,528 bytes raw |
| Signature size | ~64-72 bytes | ~2,420 bytes raw |
| Onchain friendliness | Excellent due to compact artifacts and mature precompiles | Expensive without specialized verification paths |
| Verification cost profile | Small and well integrated into blockchain tooling | Much heavier in bandwidth, storage, and verification logic |
| Migration posture | Legacy baseline | Future-oriented but operationally heavier |

This is the real trade-off. Post-quantum signatures buy asymptotic safety at the cost of much larger cryptographic artifacts and more awkward integration. That is why hybrid systems matter.

## Key Insights
### 1. The signature layer is the first quantum fault line
Ethereum's immediate quantum weakness is not Keccak. It is the classical signature stack that authorizes irreversible value transfer.

### 2. PQC integration is already feasible in application architecture
This codebase proves that engineers do not need to wait for an entirely post-quantum chain. A service-side approval plane can introduce lattice-based signatures today while preserving EVM execution.

### 3. Hybrid designs are the practical migration bridge
The most realistic near-term architecture is not "replace Ethereum." It is "retain EVM settlement, harden authorization, and progressively reduce dependence on classical signatures."

### 4. Wallet identity and cryptographic authorization are not the same thing
In this implementation, MetaMask is the operator's identity/session layer, while Dilithium is the approval-authentication layer, and a backend-held EOA is the settlement signer. That separation is operationally useful, but it must be documented explicitly because it defines the trust boundary.

### 5. Real transaction receipts matter more than stylized prototypes
Persisted transaction hashes, receipt checks, and explorer links create a falsifiable system. That is where research prototypes become engineering artifacts.

## Results
The codebase and local runtime state support several concrete conclusions:

- The `MultiAdminVault` contract passes local tests for deployment, threshold enforcement, execution, and duplicate-approval rejection.
- The PQC runtime successfully generates Dilithium2 keys and verifies signatures using `liboqs`.
- The backend persists separate signature and approval records, enforcing "sign first, approve second."
- The local database currently contains 24 vaults, 18 proposals, 13 stored signatures, 13 approvals, and 11 proposals marked executed with transaction hashes.
- The UI renders transaction hashes and links them to [Sepolia Etherscan](https://sepolia.etherscan.io/).

The strongest empirical result is therefore not simply "PQC works" or "Sepolia works." It is that the application successfully combines post-quantum approval semantics with real blockchain execution in a single operational pipeline.

## Quantum Impact and Standardization Context
This prototype sits directly inside the emerging migration landscape defined by the NIST PQC standards:

- [FIPS 203](https://csrc.nist.gov/pubs/fips/203/final): ML-KEM
- [FIPS 204](https://csrc.nist.gov/pubs/fips/204/final): ML-DSA, derived from CRYSTALS-Dilithium
- [FIPS 205](https://csrc.nist.gov/pubs/fips/205/final): SLH-DSA, derived from SPHINCS+

These standards matter because they turn PQC from research candidate sets into procurement-grade engineering targets. They also clarify the signature migration landscape: Dilithium/ML-DSA offers a strong performance-security balance, [SPHINCS+ / SLH-DSA](https://csrc.nist.gov/pubs/fips/205/final) offers conservative hash-based assurance, and Falcon remains part of the broader transition discussion as NIST continues work toward a future FIPS 206 track.

For blockchain systems, the implication is direct. Migration urgency is not only about theoretical cryptanalysis timelines; it is about replacing signature dependencies in long-lived, publicly exposed systems before the break point arrives. Treasury control, governance execution, and key management are exactly the places where that migration has to start.

## Conclusion
The most important lesson from this codebase is that quantum-safe blockchain security does not begin by rewriting consensus. It begins by re-architecting authorization.

This project demonstrates a credible transitional model: post-quantum signatures secure the approval workflow, threshold logic governs execution readiness, and Sepolia provides an actual settlement layer. The current live implementation still relies on a backend-held classical EOA for final transaction submission, and the fully contract-native path is only partially exercised in runtime data. But that does not weaken the result. It clarifies the migration sequence.

Future-ready systems will not be built by waiting for a perfect post-quantum chain. They will be built by progressively isolating classical cryptography from the most critical control surfaces. This vault system is valuable precisely because it is incomplete in the right way: it is already operational, already hybrid, and already pointing toward the architecture that post-quantum blockchain security will require.
