from __future__ import annotations

import json
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
    execute_contract_proposal,
    normalize_proposal_transaction,
    send_transaction,
)
from backend.schemas import (
    ApproveProposalRequest,
    CreateProposalRequest,
    CreateVaultRequest,
    ExecuteProposalRequest,
    SignProposalRequest,
    VerifySignatureRequest,
)
from pqc import generate_keypair, sign_message, verify_signature

KEYS_DIR = Path(__file__).resolve().parent.parent / "keys"


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


def parse_payload(raw_payload: str | None) -> dict[str, Any] | None:
    if not raw_payload:
        return None

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None

    return parsed_payload if isinstance(parsed_payload, dict) else None


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
        payload = json.loads(key_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Stored key file is not valid JSON.") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Stored key file could not be read.") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="Stored key file payload is invalid.")

    missing_fields = [
        field for field in ("algorithm", "public_key", "private_key") if not payload.get(field)
    ]
    if missing_fields:
        raise HTTPException(
            status_code=500,
            detail=f"Stored key file is missing required fields: {', '.join(missing_fields)}.",
        )

    return {
        "algorithm": str(payload["algorithm"]),
        "public_key": str(payload["public_key"]),
        "private_key": str(payload["private_key"]),
        "key_file": str(key_path),
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
    if keypair["algorithm"] != admin["algorithm"]:
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
        SELECT id, admin_name, public_key, algorithm, key_file, created_at
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
            vault_admins.public_key,
            vault_admins.algorithm,
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
            vault_admins.public_key,
            vault_admins.algorithm,
            proposal_signatures.signature,
            proposal_signatures.is_verified,
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
            "wallet_address": row["signer_wallet_address"],
            "created_at": row["created_at"],
            "is_approved": bool(row["is_approved"]),
            "approved_at": row["approved_at"],
        }
        for row in rows
    ]


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
    if vault["contract_address"] and requested_mode == "direct_transfer":
        return "direct_transfer"
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
        SELECT id, admin_name, public_key, algorithm, key_file, created_at
        FROM vault_admins
        WHERE vault_id = ? AND public_key = ?
        """,
        (vault_id, public_key),
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
        SELECT id, signature, is_verified, signer_wallet_address, created_at
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
        SELECT id, admin_id, signature, is_verified, signer_wallet_address, created_at
        FROM proposal_signatures
        WHERE proposal_id = ? AND LOWER(signer_wallet_address) = LOWER(?)
        """,
        (proposal_id, wallet_address),
    ).fetchone()


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

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO vaults (name, threshold, contract_address, network, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                request.name,
                request.threshold,
                request.contract_address,
                request.network,
                created_at,
            ),
        )
        vault_id = int(cursor.lastrowid)

        for index, admin in enumerate(request.admins, start=1):
            public_key = admin.public_key
            key_file: str | None = None
            if admin.generate_keypair:
                key_path = KEYS_DIR / f"vault_{vault_id}_admin_{index}.json"
                keypair = generate_keypair(algorithm=admin.algorithm, output_path=key_path)
                public_key = keypair["public_key"]
                key_file = keypair["output_path"]
                generated_admin_keys.append(
                    {
                        "name": admin.name,
                        "algorithm": keypair["algorithm"],
                        "public_key": keypair["public_key"],
                        "private_key": keypair["private_key"],
                        "key_file": keypair["output_path"],
                    }
                )

            try:
                connection.execute(
                    """
                    INSERT INTO vault_admins (
                        vault_id,
                        admin_name,
                        public_key,
                        algorithm,
                        key_file,
                        created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (vault_id, admin.name, public_key, admin.algorithm, key_file, created_at),
                )
            except sqlite3.IntegrityError as exc:
                raise HTTPException(
                    status_code=409,
                    detail="Duplicate admin public key for this vault.",
                ) from exc

        vault = get_vault_or_404(connection, vault_id)
        return {
            "vault": serialize_vault(connection, vault),
            "generated_admin_keys": generated_admin_keys,
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

        payload = json.dumps(request.payload, sort_keys=True) if request.payload is not None else None
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
        return {"proposal": serialize_proposal(connection, proposal)}


@app.post("/sign-proposal")
def sign_proposal(request: SignProposalRequest) -> dict[str, Any]:
    with get_connection() as connection:
        proposal = get_proposal_or_404(connection, request.proposal_id)
        if proposal["status"] == "executed":
            raise HTTPException(status_code=409, detail="Executed proposals cannot be signed.")

        if request.signer_wallet_address:
            existing_wallet_signature = find_signature_for_wallet(
                connection,
                proposal["id"],
                request.signer_wallet_address,
            )
            if existing_wallet_signature is not None:
                raise HTTPException(
                    status_code=409,
                    detail="This wallet has already signed the proposal.",
                )

            existing_wallet_approval = find_approval_for_wallet(
                connection,
                proposal["id"],
                request.signer_wallet_address,
            )
            if existing_wallet_approval is not None:
                raise HTTPException(
                    status_code=409,
                    detail="This wallet has already approved the proposal.",
                )

        admin = find_admin_for_vault(connection, proposal["vault_id"], request.admin_public_key)
        if admin is None:
            raise HTTPException(status_code=404, detail="Admin public key is not registered for this vault.")

        keypair = load_admin_keypair(admin)
        if request.algorithm != keypair["algorithm"]:
            raise HTTPException(
                status_code=400,
                detail="Requested algorithm does not match the stored admin key.",
            )

        message = build_proposal_message(proposal)
        signature = sign_message(message, keypair["private_key"], keypair["algorithm"])

        is_valid = verify_signature(
            message,
            signature,
            keypair["public_key"],
            keypair["algorithm"],
        )
        if not is_valid:
            raise HTTPException(status_code=400, detail="Signature verification failed.")

        existing_signature = find_signature_for_admin(connection, proposal["id"], admin["id"])
        if existing_signature is not None:
            raise HTTPException(
                status_code=409,
                detail="This admin has already signed the proposal.",
            )

        try:
            connection.execute(
                """
                INSERT INTO proposal_signatures (
                    proposal_id,
                    admin_id,
                    signature,
                    is_verified,
                    signer_wallet_address,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    proposal["id"],
                    admin["id"],
                    signature,
                    1,
                    request.signer_wallet_address,
                    utc_now(),
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=409,
                detail="This admin has already signed the proposal.",
            ) from exc

        proposal, approval_count = refresh_proposal_status(connection, proposal["id"])
        return {
            "proposal": serialize_proposal(connection, proposal),
            "approval_recorded": False,
            "signature_recorded": True,
            "signature_status": "verified" if is_valid else "failed",
            "approval_count": approval_count,
            "threshold": proposal["threshold_snapshot"],
            "ready_to_execute": approval_count >= proposal["threshold_snapshot"],
            "signature": signature,
            "is_verified": is_valid,
            "key_source": "stored_key_file",
        }


@app.post("/approve-proposal")
def approve_proposal(request: ApproveProposalRequest) -> dict[str, Any]:
    with get_connection() as connection:
        proposal, approval_count = refresh_proposal_status(connection, request.proposal_id)
        if proposal["status"] == "executed":
            raise HTTPException(status_code=409, detail="Executed proposals cannot be approved.")
        if approval_count >= proposal["threshold_snapshot"]:
            raise HTTPException(
                status_code=409,
                detail="Proposal has already reached the approval threshold.",
            )

        admin = find_admin_for_vault(connection, proposal["vault_id"], request.admin_public_key)
        if admin is None:
            raise HTTPException(status_code=404, detail="Admin public key is not registered for this vault.")

        signature_record = find_signature_for_admin(connection, proposal["id"], admin["id"])
        if signature_record is None or not bool(signature_record["is_verified"]):
            raise HTTPException(
                status_code=400,
                detail="A verified PQC signature is required before approval.",
            )

        if request.approver_wallet_address:
            if signature_record["signer_wallet_address"] and (
                str(signature_record["signer_wallet_address"]).lower()
                != request.approver_wallet_address.lower()
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Approval must come from the same wallet that verified the PQC signature.",
                )

            existing_wallet_approval = find_approval_for_wallet(
                connection,
                proposal["id"],
                request.approver_wallet_address,
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
                approver_wallet_address,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                proposal["id"],
                admin["id"],
                signature_record["signature"],
                1,
                request.approver_wallet_address,
                utc_now(),
            ),
        )

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
    algorithm = request.algorithm
    approval_updated = False
    proposal_payload: dict[str, Any] | None = None

    if request.proposal_id is not None:
        with get_connection() as connection:
            proposal = get_proposal_or_404(connection, request.proposal_id)
            message = build_proposal_message(proposal)
            admin = find_admin_for_vault(connection, proposal["vault_id"], request.public_key)

            if admin is not None:
                if admin["key_file"]:
                    keypair = load_admin_keypair(admin)
                    public_key = keypair["public_key"]
                    algorithm = keypair["algorithm"]
                else:
                    public_key = admin["public_key"]
                    algorithm = admin["algorithm"]

            is_valid = verify_signature(message, request.signature, public_key, algorithm)

            if admin is not None:
                signature_record = find_signature_for_admin(connection, proposal["id"], admin["id"])
                if signature_record is not None:
                    connection.execute(
                        "UPDATE proposal_signatures SET is_verified = ? WHERE id = ?",
                        (1 if is_valid else 0, signature_record["id"]),
                    )
                    proposal = get_proposal_or_404(connection, proposal["id"])
                    proposal, _ = refresh_proposal_status(connection, proposal["id"])
                    proposal_payload = serialize_proposal(connection, proposal)
                    approval_updated = True

            return {
                "is_valid": is_valid,
                "message": message,
                "algorithm": algorithm,
                "public_key": public_key,
                "approval_updated": approval_updated,
                "key_source": "stored_key_file" if admin is not None and admin["key_file"] else "request_or_db_public_key",
                "proposal": proposal_payload,
            }

    is_valid = verify_signature(message, request.signature, public_key, algorithm)
    return {
        "is_valid": is_valid,
        "message": message,
        "algorithm": algorithm,
        "public_key": public_key,
        "approval_updated": approval_updated,
        "key_source": "request_public_key",
    }


@app.post("/execute")
def execute_proposal(request: ExecuteProposalRequest) -> dict[str, Any]:
    with get_connection() as connection:
        proposal, approval_count = refresh_proposal_status(connection, request.proposal_id)
        vault = get_vault_or_404(connection, proposal["vault_id"])

        if proposal["status"] == "executed":
            raise HTTPException(status_code=409, detail="Proposal has already been executed.")
        if approval_count < proposal["threshold_snapshot"]:
            raise HTTPException(
                status_code=400,
                detail="Proposal does not have enough approvals to execute.",
            )

        execution_mode = resolve_execution_mode(vault, proposal)
        network = str(vault["network"] or "sepolia")

        try:
            if execution_mode == "vault_contract":
                chain_execution = execute_contract_proposal(
                    contract_address=resolve_contract_address(vault),
                    proposal_id=resolve_onchain_proposal_id(proposal),
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
        return {
            "proposal": serialize_proposal(connection, proposal),
            "approval_count": approval_count,
            "executed": True,
            "transaction_hash": transaction_hash,
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
