from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from backend.env_config import load_project_env


BASE_DIR = Path(__file__).resolve().parent
RUNNER_PATH = BASE_DIR / "ethers_runner.mjs"


class EthersServiceError(RuntimeError):
    """Raised when the ethers.js bridge fails."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        transaction_hash: str | None = None,
        receipt_status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.transaction_hash = transaction_hash
        self.receipt_status = receipt_status


def _network_env_name(network: str, suffix: str) -> str:
    normalized = network.strip().upper().replace("-", "_")
    return f"{normalized}_{suffix}"


def _required_env(network: str, suffix: str) -> str:
    env_name = _network_env_name(network, suffix)
    value = os.environ.get(env_name)
    if not value:
        raise EthersServiceError(
            f"Missing required environment variable: {env_name}."
        )
    return value


def _ensure_node_available() -> str:
    node_binary = shutil.which("node")
    if not node_binary:
        raise EthersServiceError("Node.js is required to run the ethers.js bridge.")
    return node_binary


def run_ethers_action(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    return _run_ethers_action(action, payload, require_wallet=True)


def _run_ethers_action(
    action: str,
    payload: dict[str, Any],
    *,
    require_wallet: bool,
) -> dict[str, Any]:
    network = str(payload.get("network", "sepolia"))
    load_project_env()

    if require_wallet:
        _required_env(network, "RPC_URL")
        _required_env(network, "PRIVATE_KEY")

    node_binary = _ensure_node_available()

    process = subprocess.run(
        [node_binary, str(RUNNER_PATH), action, json.dumps(payload)],
        capture_output=True,
        text=True,
        check=False,
        cwd=BASE_DIR.parent,
        env=os.environ.copy(),
    )

    if process.returncode != 0:
        stderr = process.stderr.strip()
        if stderr:
            try:
                error_payload = json.loads(stderr)
                message = str(error_payload.get("error") or stderr)
                raise EthersServiceError(
                    message,
                    code=str(error_payload.get("code")) if error_payload.get("code") else None,
                    transaction_hash=(
                        str(error_payload.get("transactionHash"))
                        if error_payload.get("transactionHash")
                        else None
                    ),
                    receipt_status=(
                        int(error_payload["receiptStatus"])
                        if isinstance(error_payload.get("receiptStatus"), int)
                        else None
                    ),
                )
            except json.JSONDecodeError:
                message = stderr
        else:
            message = "ethers.js bridge failed without stderr output."

        raise EthersServiceError(message)

    stdout = process.stdout.strip()
    if not stdout:
        raise EthersServiceError("ethers.js bridge returned no output.")

    try:
        response = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise EthersServiceError("ethers.js bridge returned invalid JSON.") from exc

    if not isinstance(response, dict):
        raise EthersServiceError("ethers.js bridge returned an invalid payload.")

    return response


def normalize_proposal_transaction(destination: str, amount_eth: str) -> dict[str, str]:
    response = _run_ethers_action(
        "normalizeProposalTransaction",
        {
            "destination": destination,
            "amountEth": amount_eth,
        },
        require_wallet=False,
    )

    normalized_destination = response.get("destination")
    normalized_amount_eth = response.get("amountEth")
    normalized_amount_wei = response.get("amountWei")
    if not all(
        isinstance(value, str) and value
        for value in (normalized_destination, normalized_amount_eth, normalized_amount_wei)
    ):
        raise EthersServiceError("ethers.js bridge returned an incomplete transaction payload.")

    return {
        "destination": normalized_destination,
        "amount_eth": normalized_amount_eth,
        "amount_wei": normalized_amount_wei,
    }


def send_transaction(
    to: str,
    value_wei: str | int,
    data: str = "0x",
    network: str = "sepolia",
) -> dict[str, Any]:
    return run_ethers_action(
        "sendTransaction",
        {
            "to": to,
            "value": str(value_wei),
            "data": data,
            "network": network,
        },
    )


def execute_contract_proposal(
    contract_address: str,
    proposal_id: int,
    network: str = "sepolia",
) -> dict[str, Any]:
    return run_ethers_action(
        "executeContractProposal",
        {
            "contractAddress": contract_address,
            "proposalId": proposal_id,
            "network": network,
        },
    )
