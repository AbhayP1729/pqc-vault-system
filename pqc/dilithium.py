"""Helpers for PQC key generation, signing, and verification with liboqs-python."""

from __future__ import annotations

import base64
import json
import logging
import re
from pathlib import Path
from typing import Any

DEFAULT_ALGORITHM = "Dilithium2"
DEFAULT_KEYS_DIR = Path(__file__).resolve().parent.parent / "keys"
DEFAULT_KEY_PATH = DEFAULT_KEYS_DIR / "dilithium_keypair.json"
SUPPORTED_ALGORITHMS = (
    {
        "family": "Dilithium",
        "name": "Dilithium2",
        "label": "Dilithium",
    },
    {
        "family": "Falcon",
        "name": "Falcon-512",
        "label": "Falcon",
    },
    {
        "family": "SPHINCS+",
        "name": "SPHINCS+-SHA2-128f-simple",
        "label": "SPHINCS+",
    },
)
SUPPORTED_ALGORITHM_NAMES = {str(item["name"]) for item in SUPPORTED_ALGORITHMS}
SUPPORTED_ALGORITHM_LABELS = {str(item["name"]): str(item["label"]) for item in SUPPORTED_ALGORITHMS}
ALGORITHM_KEY_FILENAMES = {
    "Dilithium2": "dilithium.json",
    "Falcon-512": "falcon.json",
    "SPHINCS+-SHA2-128f-simple": "sphincs.json",
}
ALGORITHM_ALIASES = {
    "dilithium": "Dilithium2",
    "dilithium2": "Dilithium2",
    "falcon": "Falcon-512",
    "falcon512": "Falcon-512",
    "falcon-512": "Falcon-512",
    "sphincs": "SPHINCS+-SHA2-128f-simple",
    "sphincs+": "SPHINCS+-SHA2-128f-simple",
    "sphincs-sha2-128f-simple": "SPHINCS+-SHA2-128f-simple",
    "sphincs+-sha2-128f-simple": "SPHINCS+-SHA2-128f-simple",
}
logger = logging.getLogger(__name__)


def _load_signature_class():
    """Import liboqs-python even if another package shadows `oqs` in the environment."""
    try:
        from oqs import Signature  # type: ignore[attr-defined]

        return Signature
    except (ImportError, AttributeError):
        try:
            from oqs.oqs import Signature

            return Signature
        except ImportError as exc:
            raise ImportError(
                "liboqs-python could not be imported. Install `liboqs-python` and "
                "make sure another `oqs` package is not shadowing it."
            ) from exc


def _normalize_message(message: str | bytes) -> bytes:
    if isinstance(message, bytes):
        return message
    return message.encode("utf-8")


def _encode_bytes(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _decode_bytes(value: str) -> bytes:
    return base64.b64decode(value.encode("ascii"))


def _write_json(path: str | Path, payload: dict[str, Any]) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return destination


def _normalize_wallet_address(wallet_address: str) -> str:
    normalized = wallet_address.strip().lower()
    if not re.fullmatch(r"0x[a-f0-9]{40}", normalized):
        raise ValueError("Wallet address must be a valid 0x-prefixed Ethereum address.")
    return normalized


def get_algorithm_label(algorithm: str | None) -> str:
    mechanism = normalize_algorithm(algorithm)
    return SUPPORTED_ALGORITHM_LABELS.get(mechanism, mechanism)


def get_wallet_key_dir(
    wallet_address: str,
    keys_dir: str | Path = DEFAULT_KEYS_DIR,
) -> Path:
    return Path(keys_dir) / _normalize_wallet_address(wallet_address)


def get_wallet_key_path(
    wallet_address: str,
    algorithm: str = DEFAULT_ALGORITHM,
    keys_dir: str | Path = DEFAULT_KEYS_DIR,
) -> Path:
    mechanism = normalize_algorithm(algorithm)
    file_name = ALGORITHM_KEY_FILENAMES.get(mechanism)
    if not file_name:
        raise ValueError(f"No key filename is defined for algorithm {mechanism}.")
    return get_wallet_key_dir(wallet_address, keys_dir) / file_name


def load_keypair_payload(path: str | Path) -> dict[str, str]:
    key_path = Path(path)
    payload = json.loads(key_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Stored key file payload is invalid.")

    missing_fields = [
        field for field in ("algorithm", "public_key", "private_key") if not payload.get(field)
    ]
    if missing_fields:
        raise ValueError(
            f"Stored key file is missing required fields: {', '.join(missing_fields)}."
        )

    return {
        "algorithm": normalize_algorithm(str(payload["algorithm"])),
        "public_key": str(payload["public_key"]),
        "private_key": str(payload["private_key"]),
        "key_file": str(key_path),
    }


def normalize_algorithm(algorithm: str | None) -> str:
    """Return the liboqs mechanism name for a supported UI/backend algorithm."""
    candidate = (algorithm or DEFAULT_ALGORITHM).strip()
    if candidate in SUPPORTED_ALGORITHM_NAMES:
        return candidate

    normalized_alias = candidate.lower().replace(" ", "").replace("_", "-")
    resolved = ALGORITHM_ALIASES.get(normalized_alias)
    if resolved:
        return resolved

    supported = ", ".join(item["name"] for item in SUPPORTED_ALGORITHMS)
    raise ValueError(f"Unsupported PQC algorithm: {candidate}. Supported algorithms: {supported}.")


def get_supported_algorithms() -> list[dict[str, str]]:
    return [dict(item) for item in SUPPORTED_ALGORITHMS]


def generate_keypair(
    algorithm: str = DEFAULT_ALGORITHM,
    output_path: str | Path = DEFAULT_KEY_PATH,
) -> dict[str, str]:
    """Generate a PQC keypair, save it as JSON, and return the serialized payload."""
    signature_cls = _load_signature_class()
    mechanism = normalize_algorithm(algorithm)

    with signature_cls(mechanism) as signer:
        public_key = signer.generate_keypair()
        private_key = signer.export_secret_key()

    keypair_payload = {
        "algorithm": mechanism,
        "public_key": _encode_bytes(public_key),
        "private_key": _encode_bytes(private_key),
        "output_path": str(_write_json(output_path, {
            "algorithm": mechanism,
            "public_key": _encode_bytes(public_key),
            "private_key": _encode_bytes(private_key),
        })),
    }
    return keypair_payload


def ensure_wallet_keypair(
    wallet_address: str,
    algorithm: str = DEFAULT_ALGORITHM,
    keys_dir: str | Path = DEFAULT_KEYS_DIR,
    legacy_key_path: str | Path | None = None,
) -> dict[str, str | bool]:
    mechanism = normalize_algorithm(algorithm)
    key_path = get_wallet_key_path(wallet_address, mechanism, keys_dir)

    if key_path.exists():
        keypair = load_keypair_payload(key_path)
        return {
            **keypair,
            "output_path": str(keypair["key_file"]),
            "key_generated": False,
            "key_status": "existing",
        }

    if legacy_key_path is not None:
        legacy_path = Path(legacy_key_path)
        if legacy_path.exists():
            legacy_keypair = load_keypair_payload(legacy_path)
            if legacy_keypair["algorithm"] == mechanism:
                migrated_path = _write_json(
                    key_path,
                    {
                        "algorithm": legacy_keypair["algorithm"],
                        "public_key": legacy_keypair["public_key"],
                        "private_key": legacy_keypair["private_key"],
                    },
                )
                return {
                    **legacy_keypair,
                    "key_file": str(migrated_path),
                    "output_path": str(migrated_path),
                    "key_generated": False,
                    "key_status": "existing",
                }

    keypair = generate_keypair(mechanism, key_path)
    logger.info(
        "Generated new %s key for wallet %s",
        get_algorithm_label(mechanism),
        _normalize_wallet_address(wallet_address),
    )
    return {
        **keypair,
        "key_file": keypair["output_path"],
        "key_generated": True,
        "key_status": "generated",
    }


def register_wallet_algorithms(
    wallet_address: str,
    *,
    keys_dir: str | Path = DEFAULT_KEYS_DIR,
    legacy_key_paths: dict[str, str | Path] | None = None,
) -> list[dict[str, str | bool]]:
    registrations: list[dict[str, str | bool]] = []
    for algorithm in [str(item["name"]) for item in SUPPORTED_ALGORITHMS]:
        registrations.append(
            ensure_wallet_keypair(
                wallet_address,
                algorithm,
                keys_dir=keys_dir,
                legacy_key_path=(legacy_key_paths or {}).get(algorithm),
            )
        )
    return registrations


def sign_message(
    message: str | bytes,
    private_key: str | None = None,
    algorithm: str = DEFAULT_ALGORITHM,
    *,
    wallet_address: str | None = None,
    keys_dir: str | Path = DEFAULT_KEYS_DIR,
) -> str:
    """Sign a message with a base64-encoded PQC private key."""
    signature_cls = _load_signature_class()
    message_bytes = _normalize_message(message)
    mechanism = normalize_algorithm(algorithm)

    if private_key is None:
        if wallet_address is None:
            raise ValueError("Provide either private_key or wallet_address to sign_message.")
        keypair = ensure_wallet_keypair(wallet_address, mechanism, keys_dir=keys_dir)
        private_key = str(keypair["private_key"])
        mechanism = str(keypair["algorithm"])

    secret_key = _decode_bytes(private_key)

    with signature_cls(mechanism, secret_key=secret_key) as signer:
        signature = signer.sign(message_bytes)

    return _encode_bytes(signature)


def verify_signature(
    message: str | bytes,
    signature: str,
    public_key: str | None = None,
    algorithm: str = DEFAULT_ALGORITHM,
    *,
    wallet_address: str | None = None,
    keys_dir: str | Path = DEFAULT_KEYS_DIR,
) -> bool:
    """Verify a base64-encoded PQC signature against a base64-encoded public key."""
    signature_cls = _load_signature_class()
    message_bytes = _normalize_message(message)
    signature_bytes = _decode_bytes(signature)
    mechanism = normalize_algorithm(algorithm)

    if public_key is None:
        if wallet_address is None:
            raise ValueError("Provide either public_key or wallet_address to verify_signature.")
        keypair = load_keypair_payload(get_wallet_key_path(wallet_address, mechanism, keys_dir))
        public_key = keypair["public_key"]
        mechanism = keypair["algorithm"]

    public_key_bytes = _decode_bytes(public_key)

    with signature_cls(mechanism) as verifier:
        return bool(verifier.verify(message_bytes, signature_bytes, public_key_bytes))
