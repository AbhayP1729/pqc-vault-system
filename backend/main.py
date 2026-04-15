from __future__ import annotations

import json
import logging
import re
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.database import get_connection, init_db
from backend.ethers_service import (
    EthersServiceError,
    approve_contract_proposal,
    create_contract_proposal,
    deploy_vault_contract,
    execute_contract_proposal,
    normalize_proposal_transaction,
    send_transaction,
)
from backend.schemas import (
    ApproveProposalRequest,
    CreateProposalRequest,
    CreateVaultRequest,
    ExecuteProposalRequest,
    RegisterWalletAlgorithmsRequest,
    SignProposalRequest,
    VerifySignatureRequest,
)
from pqc import (
    ensure_wallet_keypair,
    generate_keypair,
    get_algorithm_label,
    get_supported_algorithms,
    get_wallet_key_path,
    load_keypair_payload,
    normalize_algorithm,
    register_wallet_algorithms,
    sign_message,
    verify_signature,
)

KEYS_DIR = Path(__file__).resolve().parent.parent / "keys"
logger = logging.getLogger(__name__)


def get_cors_origins() -> list[str]:
    configured_origins = os.environ.get("BACKEND_CORS_ORIGINS")
    if configured_origins:
        return [origin.strip() for origin in configured_origins.split(",") if origin.strip()]

    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_wallet_address(wallet_address: str | None) -> str | None:
    if wallet_address is None:
        return None

    normalized_wallet_address = wallet_address.strip()
    if not re.fullmatch(r"0x[a-fA-F0-9]{40}", normalized_wallet_address):
        raise HTTPException(status_code=400, detail="Invalid wallet address.")
    return normalized_wallet_address


def parse_payload(raw_payload: str | None) -> dict[str, Any] | None:
    if not raw_payload:
        return None

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None

    return parsed_payload if isinstance(parsed_payload, dict) else None


def extract_wallet_identity(payload: dict[str, Any] | None) -> str | None:
    if not payload:
        return None

    candidate_keys = (
        "proposer_wallet_address",
        "creator_wallet_address",
        "created_by_wallet",
        "submitted_by_wallet",
        "signer_wallet_address",
        "wallet_address",
    )
    for key in candidate_keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def resolve_key_file_path(key_file: str) -> Path:
    candidate = Path(key_file).expanduser()
    if not candidate.is_absolute():
        candidate = KEYS_DIR / candidate

    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="Stored key file could not be found.") from exc

    try:
        resolved.relative_to(KEYS_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(
            status_code=500,
            detail="Stored key file path is outside the managed keys directory.",
        ) from exc

    return resolved


def load_keypair_from_file(key_file: str) -> dict[str, str]:
    key_path = resolve_key_file_path(key_file)

    try:
        return load_keypair_payload(key_path)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Stored key file is not valid JSON.") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Stored key file could not be read.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def build_admin_key_file_path(
    vault_id: int,
    index: int,
    wallet_address: str | None,
    algorithm: str,
) -> Path:
    if wallet_address:
        return get_wallet_key_path(wallet_address, algorithm, KEYS_DIR)
    return KEYS_DIR / f"vault_{vault_id}_admin_{index}.json"


def get_key_status_label(key_generated: bool) -> str:
    return "New key generated" if key_generated else "Existing key used"


def resolve_admin_keypair(
    admin: sqlite3.Row,
    algorithm: str,
) -> dict[str, Any]:
    selected_algorithm = normalize_algorithm(algorithm)
    wallet_address = validate_wallet_address(admin["wallet_address"])
    legacy_key_file = str(admin["key_file"]) if admin["key_file"] else None

    if wallet_address:
        try:
            keypair = ensure_wallet_keypair(
                wallet_address,
                selected_algorithm,
                keys_dir=KEYS_DIR,
                legacy_key_path=legacy_key_file,
            )
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        return {
            **keypair,
            "wallet_address": wallet_address,
            "key_status_label": get_key_status_label(bool(keypair["key_generated"])),
        }

    if not legacy_key_file:
        raise HTTPException(
            status_code=400,
            detail="This admin does not have a stored key file for backend signing.",
        )

    keypair = load_keypair_from_file(legacy_key_file)
    if keypair["algorithm"] != selected_algorithm:
        raise HTTPException(
            status_code=400,
            detail="Requested algorithm does not match the stored admin key.",
        )

    return {
        **keypair,
        "wallet_address": None,
        "key_generated": False,
        "key_status": "existing",
        "key_status_label": get_key_status_label(False),
    }


def load_admin_keypair(admin: sqlite3.Row) -> dict[str, str]:
    key_file = admin["key_file"]
    if not key_file:
        raise HTTPException(
            status_code=400,
            detail="This admin does not have a stored key file for backend signing.",
        )

    keypair = load_keypair_from_file(str(key_file))
    if keypair["public_key"] != admin["public_key"]:
        raise HTTPException(
            status_code=500,
            detail="Stored key file does not match the registered admin public key.",
        )
    if keypair["algorithm"] != normalize_algorithm(str(admin["algorithm"])):
        raise HTTPException(
            status_code=500,
            detail="Stored key file does not match the registered admin algorithm.",
        )

    return keypair


def resolve_contract_address(vault: sqlite3.Row) -> str:
    contract_address = vault["contract_address"] or os.environ.get("SEPOLIA_VAULT_CONTRACT_ADDRESS")
    if not contract_address:
        raise HTTPException(
            status_code=400,
            detail=(
                "No vault contract address is configured. "
                "Store contract_address on the vault or set SEPOLIA_VAULT_CONTRACT_ADDRESS."
            ),
        )
    return str(contract_address)


def resolve_onchain_proposal_id(proposal: sqlite3.Row) -> int:
    if proposal["onchain_proposal_id"] is not None:
        return int(proposal["onchain_proposal_id"])

    inferred_id = int(proposal["id"]) - 1
    if inferred_id < 0:
        raise HTTPException(
            status_code=400,
            detail="Unable to infer an on-chain proposal id for execution.",
        )
    return inferred_id


def build_proposal_message(proposal: sqlite3.Row) -> str:
    payload = parse_payload(proposal["payload"])
    message_version = int(proposal["message_version"] or 1)
    if message_version <= 1:
        message = {
            "proposal_id": proposal["id"],
            "vault_id": proposal["vault_id"],
            "title": proposal["title"],
            "description": proposal["description"] or "",
            "target_address": proposal["destination"],
            "amount": proposal["amount_eth"],
            "payload": payload,
            "created_at": proposal["created_at"],
        }
    else:
        message = {
            "proposal_id": proposal["id"],
            "vault_id": proposal["vault_id"],
            "title": proposal["title"],
            "description": proposal["description"] or "",
            "destination": proposal["destination"],
            "amount_eth": proposal["amount_eth"],
            "amount_wei": proposal["amount_wei"],
            "payload": payload,
            "created_at": proposal["created_at"],
        }
    return json.dumps(message, sort_keys=True, separators=(",", ":"))


def get_vault_or_404(connection: sqlite3.Connection, vault_id: int) -> sqlite3.Row:
    vault = connection.execute(
        """
        SELECT id, name, threshold, contract_address, network, created_at
        FROM vaults
        WHERE id = ?
        """,
        (vault_id,),
    ).fetchone()
    if vault is None:
        raise HTTPException(status_code=404, detail="Vault not found.")
    return vault


def get_proposal_or_404(connection: sqlite3.Connection, proposal_id: int) -> sqlite3.Row:
    proposal = connection.execute(
        """
        SELECT
            id,
            vault_id,
            title,
            description,
            destination,
            amount_eth,
            amount_wei,
            payload,
            status,
            threshold_snapshot,
            message_version,
            onchain_proposal_id,
            execution_tx_hash,
            executed_at,
            created_at
        FROM proposals
        WHERE id = ?
        """,
        (proposal_id,),
    ).fetchone()
    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")
    return proposal


def get_vault_admins(connection: sqlite3.Connection, vault_id: int) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT id, admin_name, wallet_address, public_key, algorithm, key_file, created_at
        FROM vault_admins
        WHERE vault_id = ?
        ORDER BY id
        """,
        (vault_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["admin_name"],
            "wallet_address": row["wallet_address"],
            "public_key": row["public_key"],
            "algorithm": row["algorithm"],
            "key_file": row["key_file"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def get_proposal_approvals(connection: sqlite3.Connection, proposal_id: int) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT
            approvals.id,
            vault_admins.admin_name,
            COALESCE(approvals.public_key, vault_admins.public_key) AS public_key,
            COALESCE(approvals.algorithm, vault_admins.algorithm) AS algorithm,
            approvals.signature,
            approvals.is_verified,
            approvals.approver_wallet_address,
            approvals.created_at
        FROM approvals
        JOIN vault_admins ON vault_admins.id = approvals.admin_id
        WHERE approvals.proposal_id = ?
        ORDER BY approvals.id
        """,
        (proposal_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "admin_name": row["admin_name"],
            "public_key": row["public_key"],
            "algorithm": row["algorithm"],
            "signature": row["signature"],
            "is_verified": bool(row["is_verified"]),
            "wallet_address": row["approver_wallet_address"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def get_proposal_signatures(connection: sqlite3.Connection, proposal_id: int) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT
            proposal_signatures.id,
            vault_admins.admin_name,
            COALESCE(proposal_signatures.public_key, vault_admins.public_key) AS public_key,
            COALESCE(proposal_signatures.algorithm, vault_admins.algorithm) AS algorithm,
            proposal_signatures.signature,
            proposal_signatures.is_verified,
            proposal_signatures.key_generated,
            proposal_signatures.signer_wallet_address,
            proposal_signatures.created_at,
            approvals.id IS NOT NULL AS is_approved,
            approvals.created_at AS approved_at
        FROM proposal_signatures
        JOIN vault_admins ON vault_admins.id = proposal_signatures.admin_id
        LEFT JOIN approvals
          ON approvals.proposal_id = proposal_signatures.proposal_id
         AND approvals.admin_id = proposal_signatures.admin_id
        WHERE proposal_signatures.proposal_id = ?
        ORDER BY proposal_signatures.id
        """,
        (proposal_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "admin_name": row["admin_name"],
            "public_key": row["public_key"],
            "algorithm": row["algorithm"],
            "signature": row["signature"],
            "is_verified": bool(row["is_verified"]),
            "key_generated": bool(row["key_generated"]),
            "wallet_address": row["signer_wallet_address"],
            "created_at": row["created_at"],
            "is_approved": bool(row["is_approved"]),
            "approved_at": row["approved_at"],
        }
        for row in rows
    ]


def get_signature_audit_log(connection: sqlite3.Connection, proposal_id: int) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT
            signature_audit_log.id,
            signature_audit_log.wallet_address,
            signature_audit_log.algorithm,
            signature_audit_log.public_key,
            signature_audit_log.key_generated,
            signature_audit_log.signature,
            signature_audit_log.is_verified,
            signature_audit_log.message,
            signature_audit_log.created_at,
            vault_admins.admin_name
        FROM signature_audit_log
        LEFT JOIN vault_admins ON vault_admins.id = signature_audit_log.admin_id
        WHERE signature_audit_log.proposal_id = ?
        ORDER BY signature_audit_log.id DESC
        """,
        (proposal_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "wallet_address": row["wallet_address"],
            "algorithm": row["algorithm"],
            "public_key": row["public_key"],
            "key_generated": bool(row["key_generated"]),
            "signature": row["signature"],
            "is_verified": bool(row["is_verified"]),
            "verification_result": "Valid" if bool(row["is_verified"]) else "Invalid",
            "message": row["message"],
            "admin_name": row["admin_name"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def record_signature_audit(
    connection: sqlite3.Connection,
    *,
    proposal_id: int,
    admin_id: int | None,
    wallet_address: str | None,
    algorithm: str,
    public_key: str | None,
    signature: str,
    is_verified: bool,
    key_generated: bool = False,
    message: str,
    created_at: str | None = None,
) -> str:
    timestamp = created_at or utc_now()
    connection.execute(
        """
        INSERT INTO signature_audit_log (
            proposal_id,
            admin_id,
            wallet_address,
            algorithm,
            public_key,
            key_generated,
            signature,
            is_verified,
            message,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            proposal_id,
            admin_id,
            wallet_address,
            normalize_algorithm(algorithm),
            public_key,
            1 if key_generated else 0,
            signature,
            1 if is_verified else 0,
            message,
            timestamp,
        ),
    )
    return timestamp


def count_approvals(connection: sqlite3.Connection, proposal_id: int) -> int:
    row = connection.execute(
        """
        SELECT COUNT(*) AS approval_count
        FROM approvals
        WHERE proposal_id = ? AND is_verified = 1
        """,
        (proposal_id,),
    ).fetchone()
    return int(row["approval_count"])


def refresh_proposal_status(
    connection: sqlite3.Connection,
    proposal_id: int,
) -> tuple[sqlite3.Row, int]:
    proposal = get_proposal_or_404(connection, proposal_id)
    approval_count = count_approvals(connection, proposal_id)

    if proposal["status"] != "executed":
        new_status = "approved" if approval_count >= proposal["threshold_snapshot"] else "pending"
        if new_status != proposal["status"]:
            connection.execute(
                "UPDATE proposals SET status = ? WHERE id = ?",
                (new_status, proposal_id),
            )
            proposal = get_proposal_or_404(connection, proposal_id)

    return proposal, approval_count


def serialize_vault(connection: sqlite3.Connection, vault: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": vault["id"],
        "name": vault["name"],
        "threshold": vault["threshold"],
        "contract_address": vault["contract_address"],
        "network": vault["network"],
        "created_at": vault["created_at"],
        "admins": get_vault_admins(connection, vault["id"]),
    }


def serialize_proposal(connection: sqlite3.Connection, proposal: sqlite3.Row) -> dict[str, Any]:
    approval_count = count_approvals(connection, proposal["id"])
    payload = parse_payload(proposal["payload"])
    vault = get_vault_or_404(connection, proposal["vault_id"])
    return {
        "id": proposal["id"],
        "vault_id": proposal["vault_id"],
        "title": proposal["title"],
        "description": proposal["description"],
        "destination": proposal["destination"],
        "amount_eth": proposal["amount_eth"],
        "amount_wei": proposal["amount_wei"],
        "payload": payload,
        "status": proposal["status"],
        "threshold": proposal["threshold_snapshot"],
        "onchain_proposal_id": proposal["onchain_proposal_id"],
        "network": vault["network"],
        "contract_address": vault["contract_address"],
        "approval_count": approval_count,
        "approvals": get_proposal_approvals(connection, proposal["id"]),
        "signatures": get_proposal_signatures(connection, proposal["id"]),
        "signature_audit_log": get_signature_audit_log(connection, proposal["id"]),
        "message_to_sign": build_proposal_message(proposal),
        "execution_tx_hash": proposal["execution_tx_hash"],
        "executed_at": proposal["executed_at"],
        "created_at": proposal["created_at"],
    }


def resolve_execution_mode(vault: sqlite3.Row, proposal: sqlite3.Row) -> str:
    payload = parse_payload(proposal["payload"])
    requested_mode = payload.get("execution_mode") if payload else None
    if requested_mode is None and payload:
        requested_mode = payload.get("executionMode")
    if requested_mode in {"contract", "vault_contract"}:
        return "vault_contract"
    if payload and payload.get("use_vault_contract") is True:
        return "vault_contract"
    if proposal["onchain_proposal_id"] is not None:
        return "vault_contract"
    if vault["contract_address"]:
        return "vault_contract"
    return "direct_transfer"


def map_execution_exception(exc: EthersServiceError) -> HTTPException:
    detail = str(exc)
    if exc.transaction_hash:
        detail = f"{detail} Transaction hash: {exc.transaction_hash}."

    error_code = (exc.code or "").upper()
    if error_code in {"CALL_EXCEPTION", "UNPREDICTABLE_GAS_LIMIT", "TRANSACTION_FAILED"}:
        return HTTPException(status_code=400, detail=detail)
    if error_code in {"INSUFFICIENT_FUNDS", "NONCE_EXPIRED"}:
        return HTTPException(status_code=500, detail=detail)
    return HTTPException(status_code=502, detail=detail)


def find_admin_for_vault(
    connection: sqlite3.Connection,
    vault_id: int,
    public_key: str,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT id, admin_name, wallet_address, public_key, algorithm, key_file, created_at
        FROM vault_admins
        WHERE vault_id = ? AND public_key = ?
        """,
        (vault_id, public_key),
    ).fetchone()


def find_admin_for_wallet(
    connection: sqlite3.Connection,
    vault_id: int,
    wallet_address: str,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT id, admin_name, wallet_address, public_key, algorithm, key_file, created_at
        FROM vault_admins
        WHERE vault_id = ?
          AND LOWER(wallet_address) = LOWER(?)
        """,
        (vault_id, wallet_address),
    ).fetchone()


def get_admin_by_id(connection: sqlite3.Connection, admin_id: int) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT id, admin_name, wallet_address, public_key, algorithm, key_file, created_at
        FROM vault_admins
        WHERE id = ?
        """,
        (admin_id,),
    ).fetchone()


def find_admin_for_wallet_and_algorithm(
    connection: sqlite3.Connection,
    vault_id: int,
    wallet_address: str,
    algorithm: str,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT id, admin_name, wallet_address, public_key, algorithm, key_file, created_at
        FROM vault_admins
        WHERE vault_id = ?
          AND LOWER(wallet_address) = LOWER(?)
          AND algorithm = ?
        """,
        (vault_id, wallet_address, normalize_algorithm(algorithm)),
    ).fetchone()


def find_approval_for_admin(
    connection: sqlite3.Connection,
    proposal_id: int,
    admin_id: int,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT id, signature, is_verified, created_at
        FROM approvals
        WHERE proposal_id = ? AND admin_id = ?
        """,
        (proposal_id, admin_id),
    ).fetchone()


def find_approval_for_wallet(
    connection: sqlite3.Connection,
    proposal_id: int,
    wallet_address: str,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT id, admin_id, signature, is_verified, approver_wallet_address, created_at
        FROM approvals
        WHERE proposal_id = ? AND LOWER(approver_wallet_address) = LOWER(?)
        """,
        (proposal_id, wallet_address),
    ).fetchone()


def find_signature_for_admin(
    connection: sqlite3.Connection,
    proposal_id: int,
    admin_id: int,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT id, signature, is_verified, public_key, algorithm, key_generated, signer_wallet_address, created_at
        FROM proposal_signatures
        WHERE proposal_id = ? AND admin_id = ?
        """,
        (proposal_id, admin_id),
    ).fetchone()


def find_signature_for_wallet(
    connection: sqlite3.Connection,
    proposal_id: int,
    wallet_address: str,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT id, admin_id, signature, is_verified, public_key, algorithm, key_generated, signer_wallet_address, created_at
        FROM proposal_signatures
        WHERE proposal_id = ? AND LOWER(signer_wallet_address) = LOWER(?)
        """,
        (proposal_id, wallet_address),
    ).fetchone()


def find_signature_for_public_key(
    connection: sqlite3.Connection,
    proposal_id: int,
    public_key: str,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            proposal_signatures.id,
            proposal_signatures.admin_id,
            proposal_signatures.signature,
            proposal_signatures.is_verified,
            proposal_signatures.public_key,
            proposal_signatures.algorithm,
            proposal_signatures.key_generated,
            proposal_signatures.signer_wallet_address,
            proposal_signatures.created_at
        FROM proposal_signatures
        WHERE proposal_signatures.proposal_id = ?
          AND proposal_signatures.public_key = ?
        """,
        (proposal_id, public_key),
    ).fetchone()


def resolve_admin_for_proposal_identity(
    connection: sqlite3.Connection,
    *,
    proposal_id: int,
    vault_id: int,
    public_key: str | None = None,
    wallet_address: str | None = None,
) -> tuple[sqlite3.Row | None, sqlite3.Row | None]:
    signature_record: sqlite3.Row | None = None
    if public_key:
        signature_record = find_signature_for_public_key(connection, proposal_id, public_key)
        if signature_record is not None:
            admin = get_admin_by_id(connection, int(signature_record["admin_id"]))
            if admin is not None:
                return admin, signature_record

    admin = find_admin_for_wallet(connection, vault_id, wallet_address) if wallet_address else None
    if admin is None and public_key:
        admin = find_admin_for_vault(connection, vault_id, public_key)

    return admin, signature_record


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Quantum-Safe Vault Backend",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/pqc/algorithms")
def list_pqc_algorithms() -> dict[str, Any]:
    supported_algorithms = get_supported_algorithms()
    return {
        "algorithms": [str(algorithm["label"]) for algorithm in supported_algorithms],
        "algorithm_options": supported_algorithms,
    }


@app.post("/pqc/register-wallet")
def register_wallet_pqc_keys(request: RegisterWalletAlgorithmsRequest) -> dict[str, Any]:
    wallet_address = validate_wallet_address(request.wallet_address)
    if wallet_address is None:
        raise HTTPException(status_code=400, detail="A valid wallet address is required.")

    with get_connection() as connection:
        get_vault_or_404(connection, request.vault_id)
        admin = find_admin_for_wallet(connection, request.vault_id, wallet_address)
        if admin is None:
            raise HTTPException(status_code=404, detail="Wallet is not registered as a vault admin.")

        legacy_key_paths = {
            normalize_algorithm(str(admin["algorithm"])): str(admin["key_file"])
            for admin in [admin]
            if admin["key_file"]
        }
        registrations = register_wallet_algorithms(
            wallet_address,
            keys_dir=KEYS_DIR,
            legacy_key_paths=legacy_key_paths,
        )

    return {
        "wallet_address": wallet_address,
        "registrations": [
            {
                "algorithm": registration["algorithm"],
                "label": get_algorithm_label(str(registration["algorithm"])),
                "public_key": registration["public_key"],
                "key_file": registration["key_file"],
                "key_generated": bool(registration["key_generated"]),
                "key_status": get_key_status_label(bool(registration["key_generated"])),
            }
            for registration in registrations
        ],
    }


@app.get("/vaults")
def list_vaults() -> dict[str, Any]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, name, threshold, contract_address, network, created_at
            FROM vaults
            ORDER BY created_at DESC, id DESC
            """
        ).fetchall()
        return {"vaults": [serialize_vault(connection, row) for row in rows]}


@app.get("/proposals")
def list_proposals(vault_id: int | None = None) -> dict[str, Any]:
    with get_connection() as connection:
        if vault_id is not None:
            get_vault_or_404(connection, vault_id)
            rows = connection.execute(
                """
                SELECT
                    id,
                    vault_id,
                    title,
                    description,
                    destination,
                    amount_eth,
                    amount_wei,
                    payload,
                    status,
                    threshold_snapshot,
                    message_version,
                    onchain_proposal_id,
                    execution_tx_hash,
                    executed_at,
                    created_at
                FROM proposals
                WHERE vault_id = ?
                ORDER BY created_at DESC, id DESC
                """,
                (vault_id,),
            ).fetchall()
        else:
            rows = connection.execute(
                """
                SELECT
                    id,
                    vault_id,
                    title,
                    description,
                    destination,
                    amount_eth,
                    amount_wei,
                    payload,
                    status,
                    threshold_snapshot,
                    message_version,
                    onchain_proposal_id,
                    execution_tx_hash,
                    executed_at,
                    created_at
                FROM proposals
                ORDER BY created_at DESC, id DESC
                """
            ).fetchall()

        serialized_proposals = []
        for proposal in rows:
            refreshed_proposal, _ = refresh_proposal_status(connection, int(proposal["id"]))
            serialized_proposals.append(serialize_proposal(connection, refreshed_proposal))

        return {
            "proposals": serialized_proposals,
        }


@app.post("/create-vault")
def create_vault(request: CreateVaultRequest) -> dict[str, Any]:
    created_at = utc_now()
    generated_admin_keys: list[dict[str, Any]] = []
    deployment: dict[str, Any] | None = None
    normalized_contract_address = validate_wallet_address(request.contract_address)

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO vaults (name, threshold, contract_address, network, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                request.name,
                request.threshold,
                normalized_contract_address,
                request.network,
                created_at,
            ),
        )
        vault_id = int(cursor.lastrowid)

        admin_wallet_addresses: list[str] = []
        seen_wallet_addresses: set[str] = set()
        for index, admin in enumerate(request.admins, start=1):
            public_key = admin.public_key
            algorithm = normalize_algorithm(admin.algorithm)
            wallet_address = validate_wallet_address(admin.wallet_address)
            if wallet_address:
                normalized_wallet_address = wallet_address.lower()
                if normalized_wallet_address in seen_wallet_addresses:
                    raise HTTPException(
                        status_code=409,
                        detail="Duplicate admin wallet address for this vault.",
                    )
                seen_wallet_addresses.add(normalized_wallet_address)
                admin_wallet_addresses.append(wallet_address)

            key_file: str | None = None
            if admin.generate_keypair:
                key_path = build_admin_key_file_path(vault_id, index, wallet_address, algorithm)
                if wallet_address:
                    keypair = ensure_wallet_keypair(
                        wallet_address,
                        algorithm,
                        keys_dir=KEYS_DIR,
                    )
                else:
                    keypair = generate_keypair(algorithm=algorithm, output_path=key_path)
                public_key = keypair["public_key"]
                key_file = keypair["output_path"]
                generated_admin_keys.append(
                    {
                        "name": admin.name,
                        "wallet_address": wallet_address,
                        "algorithm": keypair["algorithm"],
                        "public_key": keypair["public_key"],
                        "key_file": keypair["output_path"],
                    }
                )

            try:
                connection.execute(
                    """
                    INSERT INTO vault_admins (
                        vault_id,
                        admin_name,
                        wallet_address,
                        public_key,
                        algorithm,
                        key_file,
                        created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        vault_id,
                        admin.name,
                        wallet_address,
                        public_key,
                        algorithm,
                        key_file,
                        created_at,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise HTTPException(
                    status_code=409,
                    detail="Duplicate admin public key for this vault.",
                ) from exc

        if normalized_contract_address is None:
            if len(admin_wallet_addresses) != len(request.admins):
                raise HTTPException(
                    status_code=400,
                    detail="Every vault admin needs a wallet address before the on-chain vault can be deployed.",
                )

            try:
                deployment = deploy_vault_contract(
                    admin_addresses=admin_wallet_addresses,
                    threshold=request.threshold,
                    network=request.network,
                )
            except EthersServiceError as exc:
                raise map_execution_exception(exc) from exc

            deployment_contract_address = validate_wallet_address(
                str(deployment.get("contractAddress") or "")
            )
            if deployment_contract_address is None:
                raise HTTPException(
                    status_code=502,
                    detail="Vault deployment succeeded but no contract address was returned.",
                )

            connection.execute(
                "UPDATE vaults SET contract_address = ? WHERE id = ?",
                (deployment_contract_address, vault_id),
            )

        vault = get_vault_or_404(connection, vault_id)
        return {
            "vault": serialize_vault(connection, vault),
            "generated_admin_keys": generated_admin_keys,
            "deployment": deployment,
        }


@app.post("/create-proposal")
def create_proposal(request: CreateProposalRequest) -> dict[str, Any]:
    created_at = utc_now()

    with get_connection() as connection:
        vault = get_vault_or_404(connection, request.vault_id)
        try:
            normalized_transaction = normalize_proposal_transaction(
                destination=request.destination,
                amount_eth=request.amount_eth,
            )
        except EthersServiceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        payload_dict = dict(request.payload or {})
        requested_mode = payload_dict.get("execution_mode")
        if requested_mode is None:
            requested_mode = payload_dict.get("executionMode")

        use_vault_contract = bool(vault["contract_address"])
        if request.onchain_proposal_id is not None:
            use_vault_contract = True
        if requested_mode in {"contract", "vault_contract"}:
            use_vault_contract = True
        if payload_dict.get("use_vault_contract") is True:
            use_vault_contract = True

        proposer_wallet_address: str | None = None
        if use_vault_contract:
            proposer_wallet_address = validate_wallet_address(
                request.proposer_wallet_address or extract_wallet_identity(payload_dict)
            )
            if proposer_wallet_address is None:
                raise HTTPException(
                    status_code=400,
                    detail="A connected admin wallet is required to create an on-chain vault proposal.",
                )

            proposer_admin = find_admin_for_wallet(connection, vault["id"], proposer_wallet_address)
            if proposer_admin is None:
                raise HTTPException(
                    status_code=403,
                    detail="Only registered vault admin wallets can create on-chain proposals.",
                )

            payload_dict["execution_mode"] = "vault_contract"
            payload_dict["use_vault_contract"] = True
            payload_dict.setdefault("proposer_wallet_address", proposer_wallet_address)
        elif payload_dict:
            payload_dict["execution_mode"] = "direct_transfer"

        payload = json.dumps(payload_dict, sort_keys=True) if payload_dict else None
        proposal_columns = {
            str(row["name"])
            for row in connection.execute("PRAGMA table_info(proposals)").fetchall()
        }
        insert_columns = [
            "vault_id",
            "title",
            "description",
        ]
        insert_values: list[Any] = [
            request.vault_id,
            request.title,
            request.description,
        ]

        # Support both the current schema and older databases that still require
        # legacy transaction columns.
        if "target_address" in proposal_columns:
            insert_columns.append("target_address")
            insert_values.append(normalized_transaction["destination"])
        if "amount" in proposal_columns:
            insert_columns.append("amount")
            insert_values.append(normalized_transaction["amount_eth"])

        insert_columns.extend(
            [
                "destination",
                "amount_eth",
                "amount_wei",
                "payload",
                "status",
                "threshold_snapshot",
                "message_version",
                "onchain_proposal_id",
                "created_at",
            ]
        )
        insert_values.extend(
            [
                normalized_transaction["destination"],
                normalized_transaction["amount_eth"],
                normalized_transaction["amount_wei"],
                payload,
                "pending",
                vault["threshold"],
                2,
                request.onchain_proposal_id,
                created_at,
            ]
        )

        placeholders = ", ".join("?" for _ in insert_columns)
        cursor = connection.execute(
            f"""
            INSERT INTO proposals ({", ".join(insert_columns)})
            VALUES ({placeholders})
            """,
            tuple(insert_values),
        )
        proposal = get_proposal_or_404(connection, int(cursor.lastrowid))

        if use_vault_contract and request.onchain_proposal_id is None:
            try:
                chain_proposal = create_contract_proposal(
                    contract_address=resolve_contract_address(vault),
                    proposer_wallet_address=proposer_wallet_address or "",
                    target=normalized_transaction["destination"],
                    value_wei=normalized_transaction["amount_wei"],
                    description=request.description or request.title,
                    network=str(vault["network"] or "sepolia"),
                )
            except EthersServiceError as exc:
                raise map_execution_exception(exc) from exc

            onchain_proposal_id = chain_proposal.get("proposalId")
            if not isinstance(onchain_proposal_id, int):
                raise HTTPException(
                    status_code=502,
                    detail="Vault proposal was created on-chain but no proposal id was returned.",
                )

            connection.execute(
                "UPDATE proposals SET onchain_proposal_id = ? WHERE id = ?",
                (onchain_proposal_id, proposal["id"]),
            )
            proposal = get_proposal_or_404(connection, proposal["id"])

        return {"proposal": serialize_proposal(connection, proposal)}


@app.post("/sign-proposal")
def sign_proposal(request: SignProposalRequest) -> dict[str, Any]:
    with get_connection() as connection:
        proposal = get_proposal_or_404(connection, request.proposal_id)
        if proposal["status"] == "executed":
            raise HTTPException(status_code=409, detail="Already executed.")

        selected_algorithm = normalize_algorithm(request.algorithm)
        signer_wallet_address = validate_wallet_address(request.signer_wallet_address)
        if signer_wallet_address:
            existing_wallet_signature = find_signature_for_wallet(
                connection,
                proposal["id"],
                signer_wallet_address,
            )
            if existing_wallet_signature is not None:
                raise HTTPException(
                    status_code=409,
                    detail="This wallet has already signed the proposal.",
                )

            existing_wallet_approval = find_approval_for_wallet(
                connection,
                proposal["id"],
                signer_wallet_address,
            )
            if existing_wallet_approval is not None:
                raise HTTPException(
                    status_code=409,
                    detail="This wallet has already approved the proposal.",
                )

        admin = None
        if signer_wallet_address:
            admin = find_admin_for_wallet(connection, proposal["vault_id"], signer_wallet_address)
        if admin is None:
            admin = find_admin_for_vault(connection, proposal["vault_id"], request.admin_public_key)
        if admin is None:
            raise HTTPException(status_code=404, detail="Wallet is not registered as a vault admin.")

        if signer_wallet_address and admin["wallet_address"]:
            if str(admin["wallet_address"]).lower() != signer_wallet_address.lower():
                raise HTTPException(
                    status_code=403,
                    detail="Connected wallet does not match this registered vault admin.",
                )

        existing_signature = find_signature_for_admin(connection, proposal["id"], admin["id"])
        if existing_signature is not None:
            raise HTTPException(
                status_code=409,
                detail="This admin has already signed the proposal.",
            )

        keypair = resolve_admin_keypair(admin, selected_algorithm)

        message = build_proposal_message(proposal)
        signature = sign_message(message, keypair["private_key"], keypair["algorithm"])

        is_valid = verify_signature(
            message,
            signature,
            keypair["public_key"],
            keypair["algorithm"],
        )
        if not is_valid:
            record_signature_audit(
                connection,
                proposal_id=proposal["id"],
                admin_id=admin["id"],
                wallet_address=signer_wallet_address,
                algorithm=keypair["algorithm"],
                public_key=keypair["public_key"],
                signature=signature,
                is_verified=False,
                key_generated=bool(keypair["key_generated"]),
                message=message,
            )
            raise HTTPException(
                status_code=400,
                detail="Invalid signature.",
            )

        signature_timestamp = utc_now()
        try:
            connection.execute(
                """
                INSERT INTO proposal_signatures (
                    proposal_id,
                    admin_id,
                    signature,
                    is_verified,
                    public_key,
                    algorithm,
                    key_generated,
                    signer_wallet_address,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    proposal["id"],
                    admin["id"],
                    signature,
                    1,
                    keypair["public_key"],
                    keypair["algorithm"],
                    1 if bool(keypair["key_generated"]) else 0,
                    signer_wallet_address,
                    signature_timestamp,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=409,
                detail="This admin has already signed the proposal.",
            ) from exc

        record_signature_audit(
            connection,
            proposal_id=proposal["id"],
            admin_id=admin["id"],
            wallet_address=signer_wallet_address,
            algorithm=keypair["algorithm"],
            public_key=keypair["public_key"],
            signature=signature,
            is_verified=is_valid,
            key_generated=bool(keypair["key_generated"]),
            message=message,
            created_at=signature_timestamp,
        )

        proposal, approval_count = refresh_proposal_status(connection, proposal["id"])
        verification_details = {
            "message": message,
            "algorithm": keypair["algorithm"],
            "signature": signature,
            "is_valid": is_valid,
            "verification_result": "Valid" if is_valid else "Invalid",
            "timestamp": signature_timestamp,
            "wallet_address": signer_wallet_address,
            "public_key": keypair["public_key"],
        }
        return {
            "proposal": serialize_proposal(connection, proposal),
            "approval_recorded": False,
            "signature_recorded": True,
            "signature_status": "verified" if is_valid else "failed",
            "approval_count": approval_count,
            "threshold": proposal["threshold_snapshot"],
            "ready_to_execute": approval_count >= proposal["threshold_snapshot"],
            "signature": signature,
            "algorithm": keypair["algorithm"],
            "public_key": keypair["public_key"],
            "key_generated": bool(keypair["key_generated"]),
            "key_status": keypair["key_status_label"],
            "is_verified": is_valid,
            "verification": verification_details,
            "key_source": "wallet_algorithm_key" if signer_wallet_address else "stored_key_file",
        }


@app.post("/approve-proposal")
def approve_proposal(request: ApproveProposalRequest) -> dict[str, Any]:
    with get_connection() as connection:
        proposal, approval_count = refresh_proposal_status(connection, request.proposal_id)
        vault = get_vault_or_404(connection, proposal["vault_id"])
        approver_wallet_address = validate_wallet_address(request.approver_wallet_address)
        if proposal["status"] == "executed":
            raise HTTPException(status_code=409, detail="Already executed.")
        if approval_count >= proposal["threshold_snapshot"]:
            raise HTTPException(
                status_code=409,
                detail="Proposal has already reached the approval threshold.",
            )

        admin, signature_record = resolve_admin_for_proposal_identity(
            connection,
            proposal_id=proposal["id"],
            vault_id=proposal["vault_id"],
            public_key=request.admin_public_key,
            wallet_address=approver_wallet_address,
        )
        if admin is None:
            if approver_wallet_address:
                raise HTTPException(
                    status_code=404,
                    detail="Wallet is not registered as a vault admin.",
                )
            raise HTTPException(status_code=404, detail="Admin public key is not registered for this vault.")

        if approver_wallet_address and admin["wallet_address"]:
            if str(admin["wallet_address"]).lower() != approver_wallet_address.lower():
                raise HTTPException(
                    status_code=403,
                    detail="Connected wallet does not match this registered vault admin.",
                )

        if signature_record is None:
            signature_record = find_signature_for_admin(connection, proposal["id"], admin["id"])
        if signature_record is None or not bool(signature_record["is_verified"]):
            raise HTTPException(
                status_code=400,
                detail="A verified PQC signature is required before approval.",
            )

        if approver_wallet_address:
            if signature_record["signer_wallet_address"] and (
                str(signature_record["signer_wallet_address"]).lower()
                != approver_wallet_address.lower()
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Approval must come from the same wallet that verified the PQC signature.",
                )

            existing_wallet_approval = find_approval_for_wallet(
                connection,
                proposal["id"],
                approver_wallet_address,
            )
            if existing_wallet_approval is not None:
                raise HTTPException(
                    status_code=409,
                    detail="This wallet has already approved the proposal.",
                )

        existing_approval = find_approval_for_admin(connection, proposal["id"], admin["id"])
        if existing_approval is not None:
            raise HTTPException(
                status_code=409,
                detail="This admin has already approved the proposal.",
            )

        connection.execute(
            """
            INSERT INTO approvals (
                proposal_id,
                admin_id,
                signature,
                is_verified,
                public_key,
                algorithm,
                approver_wallet_address,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                proposal["id"],
                admin["id"],
                signature_record["signature"],
                1,
                signature_record["public_key"],
                signature_record["algorithm"],
                approver_wallet_address,
                utc_now(),
            ),
        )

        if resolve_execution_mode(vault, proposal) == "vault_contract":
            if approver_wallet_address is None:
                raise HTTPException(
                    status_code=400,
                    detail="A connected admin wallet is required for on-chain approval.",
                )

            try:
                approve_contract_proposal(
                    contract_address=resolve_contract_address(vault),
                    proposal_id=resolve_onchain_proposal_id(proposal),
                    admin_wallet_address=approver_wallet_address,
                    network=str(vault["network"] or "sepolia"),
                )
            except EthersServiceError as exc:
                raise map_execution_exception(exc) from exc

        proposal, approval_count = refresh_proposal_status(connection, proposal["id"])
        return {
            "proposal": serialize_proposal(connection, proposal),
            "approval_recorded": True,
            "approval_count": approval_count,
            "threshold": proposal["threshold_snapshot"],
            "ready_to_execute": approval_count >= proposal["threshold_snapshot"],
        }


@app.post("/verify-signature")
def verify_signature_endpoint(request: VerifySignatureRequest) -> dict[str, Any]:
    message = request.message
    public_key = request.public_key
    algorithm = normalize_algorithm(request.algorithm)
    approval_updated = False
    proposal_payload: dict[str, Any] | None = None

    if request.proposal_id is not None:
        with get_connection() as connection:
            proposal = get_proposal_or_404(connection, request.proposal_id)
            message = build_proposal_message(proposal)
            admin = find_admin_for_vault(connection, proposal["vault_id"], request.public_key)
            signature_record: sqlite3.Row | None = None

            if admin is not None:
                signature_record = find_signature_for_admin(connection, proposal["id"], admin["id"])
            else:
                signature_record = find_signature_for_public_key(
                    connection,
                    proposal["id"],
                    request.public_key,
                )
                if signature_record is not None:
                    admin = get_admin_by_id(connection, int(signature_record["admin_id"]))

            if signature_record is not None:
                if signature_record["public_key"]:
                    public_key = str(signature_record["public_key"])
                if signature_record["algorithm"]:
                    algorithm = normalize_algorithm(str(signature_record["algorithm"]))
            elif admin is not None:
                if admin["key_file"]:
                    keypair = load_admin_keypair(admin)
                    public_key = keypair["public_key"]
                    algorithm = keypair["algorithm"]
                else:
                    public_key = admin["public_key"]
                    algorithm = normalize_algorithm(str(admin["algorithm"]))

            is_valid = verify_signature(message, request.signature, public_key, algorithm)
            verified_at = utc_now()
            audit_wallet_address: str | None = None

            if signature_record is not None:
                audit_wallet_address = signature_record["signer_wallet_address"]
                connection.execute(
                    "UPDATE proposal_signatures SET is_verified = ? WHERE id = ?",
                    (1 if is_valid else 0, signature_record["id"]),
                )
                proposal = get_proposal_or_404(connection, proposal["id"])
                proposal, _ = refresh_proposal_status(connection, proposal["id"])
                approval_updated = True

            record_signature_audit(
                connection,
                proposal_id=proposal["id"],
                admin_id=admin["id"] if admin is not None else None,
                wallet_address=audit_wallet_address,
                algorithm=algorithm,
                public_key=public_key,
                signature=request.signature,
                is_verified=is_valid,
                key_generated=(
                    bool(signature_record["key_generated"])
                    if signature_record is not None and signature_record["key_generated"] is not None
                    else False
                ),
                message=message,
                created_at=verified_at,
            )

            proposal_payload = serialize_proposal(connection, proposal)
            verification_details = {
                "message": message,
                "algorithm": algorithm,
                "signature": request.signature,
                "is_valid": is_valid,
                "verification_result": "Valid" if is_valid else "Invalid",
                "timestamp": verified_at,
                "wallet_address": audit_wallet_address,
                "public_key": public_key,
            }
            return {
                "is_valid": is_valid,
                "message": message,
                "algorithm": algorithm,
                "public_key": public_key,
                "signature": request.signature,
                "verification": verification_details,
                "approval_updated": approval_updated,
                "key_source": "proposal_signature_record" if signature_record is not None else (
                    "stored_key_file" if admin is not None and admin["key_file"] else "request_or_db_public_key"
                ),
                "proposal": proposal_payload,
            }

    is_valid = verify_signature(message, request.signature, public_key, algorithm)
    verified_at = utc_now()
    verification_details = {
        "message": message,
        "algorithm": algorithm,
        "signature": request.signature,
        "is_valid": is_valid,
        "verification_result": "Valid" if is_valid else "Invalid",
        "timestamp": verified_at,
        "wallet_address": None,
        "public_key": public_key,
    }
    return {
        "is_valid": is_valid,
        "message": message,
        "algorithm": algorithm,
        "public_key": public_key,
        "signature": request.signature,
        "verification": verification_details,
        "approval_updated": approval_updated,
        "key_source": "request_public_key",
    }


@app.post("/execute")
def execute_proposal(request: ExecuteProposalRequest) -> dict[str, Any]:
    with get_connection() as connection:
        proposal, approval_count = refresh_proposal_status(connection, request.proposal_id)
        vault = get_vault_or_404(connection, proposal["vault_id"])
        executor_wallet_address = validate_wallet_address(request.executor_wallet_address)

        if proposal["status"] == "executed":
            raise HTTPException(status_code=409, detail="Already executed.")
        if approval_count < proposal["threshold_snapshot"]:
            raise HTTPException(
                status_code=400,
                detail="Not enough approvals.",
            )

        execution_mode = resolve_execution_mode(vault, proposal)
        network = str(vault["network"] or "sepolia")

        try:
            if execution_mode == "vault_contract":
                if executor_wallet_address is None:
                    raise HTTPException(
                        status_code=400,
                        detail="A connected admin wallet is required to execute the on-chain proposal.",
                    )

                executor_admin = find_admin_for_wallet(connection, proposal["vault_id"], executor_wallet_address)
                if executor_admin is None:
                    raise HTTPException(
                        status_code=403,
                        detail="Only registered vault admin wallets can execute this proposal.",
                    )

                chain_execution = execute_contract_proposal(
                    contract_address=resolve_contract_address(vault),
                    proposal_id=resolve_onchain_proposal_id(proposal),
                    executor_wallet_address=executor_wallet_address,
                    network=network,
                )
            else:
                if not proposal["destination"]:
                    raise HTTPException(
                        status_code=400,
                        detail="Proposal is missing a destination address.",
                    )
                amount_wei = str(proposal["amount_wei"] or "").strip()
                if not amount_wei:
                    raise HTTPException(
                        status_code=400,
                        detail="Proposal is missing amount_wei and cannot be executed.",
                    )
                if not amount_wei.isdigit() or int(amount_wei) <= 0:
                    raise HTTPException(
                        status_code=400,
                        detail="Proposal amount_wei must be a positive integer string.",
                    )

                chain_execution = send_transaction(
                    to=str(proposal["destination"]),
                    value_wei=amount_wei,
                    network=network,
                )
        except EthersServiceError as exc:
            raise map_execution_exception(exc) from exc

        executed_at = utc_now()
        transaction_hash = chain_execution.get("hash")
        if not isinstance(transaction_hash, str) or not transaction_hash:
            raise HTTPException(
                status_code=502,
                detail="Blockchain execution succeeded but no transaction hash was returned.",
            )

        connection.execute(
            """
            UPDATE proposals
            SET status = ?, execution_tx_hash = ?, executed_at = ?
            WHERE id = ?
            """,
            ("executed", transaction_hash, executed_at, proposal["id"]),
        )
        proposal = get_proposal_or_404(connection, proposal["id"])
        execution_trace = [
            {"step": "PQC Verified", "status": "complete"},
            {"step": "Approval Threshold Met", "status": "complete"},
            {"step": "Transaction Sent", "status": "complete"},
            {"step": "Confirmed on Blockchain", "status": "complete"},
        ]
        return {
            "proposal": serialize_proposal(connection, proposal),
            "approval_count": approval_count,
            "executed": True,
            "transaction_hash": transaction_hash,
            "execution_trace": execution_trace,
            "execution_status": str(chain_execution.get("status") or "confirmed"),
            "receipt_status": chain_execution.get("receiptStatus"),
            "network": chain_execution.get("network") or network,
            "destination": proposal["destination"],
            "amount_wei": proposal["amount_wei"],
            "execution_mode": execution_mode,
            "contract_address": (
                resolve_contract_address(vault) if execution_mode == "vault_contract" else None
            ),
            "onchain_proposal_id": (
                resolve_onchain_proposal_id(proposal) if execution_mode == "vault_contract" else None
            ),
        }
