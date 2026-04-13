"""Helpers for Dilithium key generation, signing, and verification with liboqs-python."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

DEFAULT_ALGORITHM = "Dilithium2"
DEFAULT_KEY_PATH = Path(__file__).resolve().parent.parent / "keys" / "dilithium_keypair.json"


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


def generate_keypair(
    algorithm: str = DEFAULT_ALGORITHM,
    output_path: str | Path = DEFAULT_KEY_PATH,
) -> dict[str, str]:
    """Generate a Dilithium keypair, save it as JSON, and return the serialized payload."""
    signature_cls = _load_signature_class()

    with signature_cls(algorithm) as signer:
        public_key = signer.generate_keypair()
        private_key = signer.export_secret_key()

    keypair_payload = {
        "algorithm": algorithm,
        "public_key": _encode_bytes(public_key),
        "private_key": _encode_bytes(private_key),
        "output_path": str(_write_json(output_path, {
            "algorithm": algorithm,
            "public_key": _encode_bytes(public_key),
            "private_key": _encode_bytes(private_key),
        })),
    }
    return keypair_payload


def sign_message(
    message: str | bytes,
    private_key: str,
    algorithm: str = DEFAULT_ALGORITHM,
) -> str:
    """Sign a message with a base64-encoded Dilithium private key."""
    signature_cls = _load_signature_class()
    message_bytes = _normalize_message(message)
    secret_key = _decode_bytes(private_key)

    with signature_cls(algorithm, secret_key=secret_key) as signer:
        signature = signer.sign(message_bytes)

    return _encode_bytes(signature)


def verify_signature(
    message: str | bytes,
    signature: str,
    public_key: str,
    algorithm: str = DEFAULT_ALGORITHM,
) -> bool:
    """Verify a base64-encoded Dilithium signature against a base64-encoded public key."""
    signature_cls = _load_signature_class()
    message_bytes = _normalize_message(message)
    signature_bytes = _decode_bytes(signature)
    public_key_bytes = _decode_bytes(public_key)

    with signature_cls(algorithm) as verifier:
        return bool(verifier.verify(message_bytes, signature_bytes, public_key_bytes))
