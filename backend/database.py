from __future__ import annotations

import os
import sqlite3
from decimal import Decimal, InvalidOperation
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("VAULT_DB_PATH", BASE_DIR / "vaults.db"))

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS vaults (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        threshold INTEGER NOT NULL CHECK (threshold > 0),
        contract_address TEXT,
        network TEXT NOT NULL DEFAULT 'sepolia',
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS vault_admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id INTEGER NOT NULL,
        admin_name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        key_file TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (vault_id) REFERENCES vaults (id) ON DELETE CASCADE,
        UNIQUE (vault_id, public_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        destination TEXT NOT NULL,
        amount_eth TEXT NOT NULL,
        amount_wei TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL,
        threshold_snapshot INTEGER NOT NULL CHECK (threshold_snapshot > 0),
        message_version INTEGER NOT NULL DEFAULT 2,
        onchain_proposal_id INTEGER,
        execution_tx_hash TEXT,
        executed_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (vault_id) REFERENCES vaults (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id INTEGER NOT NULL,
        admin_id INTEGER NOT NULL,
        signature TEXT NOT NULL,
        is_verified INTEGER NOT NULL CHECK (is_verified IN (0, 1)),
        created_at TEXT NOT NULL,
        FOREIGN KEY (proposal_id) REFERENCES proposals (id) ON DELETE CASCADE,
        FOREIGN KEY (admin_id) REFERENCES vault_admins (id) ON DELETE CASCADE,
        UNIQUE (proposal_id, admin_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS proposal_signatures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id INTEGER NOT NULL,
        admin_id INTEGER NOT NULL,
        signature TEXT NOT NULL,
        is_verified INTEGER NOT NULL CHECK (is_verified IN (0, 1)),
        signer_wallet_address TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (proposal_id) REFERENCES proposals (id) ON DELETE CASCADE,
        FOREIGN KEY (admin_id) REFERENCES vault_admins (id) ON DELETE CASCADE,
        UNIQUE (proposal_id, admin_id)
    )
    """,
)


def _get_column_names(connection: sqlite3.Connection, table_name: str) -> set[str]:
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row["name"]) for row in rows}


def _ensure_column(
    connection: sqlite3.Connection,
    table_name: str,
    column_name: str,
    column_definition: str,
) -> None:
    if column_name not in _get_column_names(connection, table_name):
        connection.execute(
            f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"
        )


def _normalize_legacy_amount_to_wei(amount_eth: str | None) -> str | None:
    if not amount_eth:
        return None

    normalized_amount = amount_eth.strip()
    if normalized_amount.lower().endswith("eth"):
        normalized_amount = normalized_amount[:-3].strip()

    if not normalized_amount:
        return None

    try:
        decimal_value = Decimal(normalized_amount)
    except InvalidOperation:
        return None

    if decimal_value <= 0:
        return None

    wei_value = decimal_value * Decimal("1000000000000000000")
    if wei_value != wei_value.to_integral_value():
        return None

    return str(int(wei_value))


def _backfill_proposal_transaction_fields(connection: sqlite3.Connection) -> None:
    column_names = _get_column_names(connection, "proposals")

    if "target_address" in column_names and "destination" in column_names:
        connection.execute(
            """
            UPDATE proposals
            SET destination = target_address
            WHERE target_address IS NOT NULL
              AND (destination IS NULL OR TRIM(destination) = '')
            """
        )

    if "amount" in column_names and "amount_eth" in column_names:
        connection.execute(
            """
            UPDATE proposals
            SET amount_eth = amount
            WHERE amount IS NOT NULL
              AND (amount_eth IS NULL OR TRIM(amount_eth) = '')
            """
        )

    legacy_rows = connection.execute(
        """
        SELECT id, amount_eth
        FROM proposals
        WHERE amount_eth IS NOT NULL
          AND TRIM(amount_eth) != ''
          AND (amount_wei IS NULL OR TRIM(amount_wei) = '')
        """
    ).fetchall()
    for row in legacy_rows:
        amount_wei = _normalize_legacy_amount_to_wei(str(row["amount_eth"]))
        if amount_wei:
            connection.execute(
                "UPDATE proposals SET amount_wei = ? WHERE id = ?",
                (amount_wei, row["id"]),
            )


def _backfill_signatures_from_legacy_approvals(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        INSERT OR IGNORE INTO proposal_signatures (
            proposal_id,
            admin_id,
            signature,
            is_verified,
            signer_wallet_address,
            created_at
        )
        SELECT
            proposal_id,
            admin_id,
            signature,
            is_verified,
            approver_wallet_address,
            created_at
        FROM approvals
        """
    )


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_connection() as connection:
        for statement in SCHEMA:
            connection.execute(statement)

        _ensure_column(connection, "vaults", "contract_address", "TEXT")
        _ensure_column(connection, "vaults", "network", "TEXT NOT NULL DEFAULT 'sepolia'")
        _ensure_column(connection, "vault_admins", "key_file", "TEXT")
        _ensure_column(connection, "proposals", "destination", "TEXT")
        _ensure_column(connection, "proposals", "amount_eth", "TEXT")
        _ensure_column(connection, "proposals", "amount_wei", "TEXT")
        _ensure_column(connection, "proposals", "message_version", "INTEGER NOT NULL DEFAULT 1")
        _ensure_column(connection, "proposals", "onchain_proposal_id", "INTEGER")
        _ensure_column(connection, "approvals", "approver_wallet_address", "TEXT")
        _ensure_column(connection, "proposal_signatures", "signer_wallet_address", "TEXT")
        _backfill_proposal_transaction_fields(connection)
        _backfill_signatures_from_legacy_approvals(connection)
