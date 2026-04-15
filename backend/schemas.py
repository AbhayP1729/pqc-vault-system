from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator

from pqc import DEFAULT_ALGORITHM, normalize_algorithm


class AdminInput(BaseModel):
    name: str = Field(min_length=1)
    public_key: str | None = None
    wallet_address: str | None = None
    generate_keypair: bool = False
    algorithm: str = DEFAULT_ALGORITHM

    @model_validator(mode="after")
    def validate_key_source(self) -> "AdminInput":
        if self.generate_keypair and self.public_key:
            raise ValueError("Provide either public_key or generate_keypair, not both.")
        if not self.generate_keypair and not self.public_key:
            raise ValueError("Each admin needs a public_key or generate_keypair=true.")
        self.algorithm = normalize_algorithm(self.algorithm)
        return self


class CreateVaultRequest(BaseModel):
    name: str = Field(min_length=1)
    threshold: int = Field(gt=0)
    contract_address: str | None = None
    network: str = Field(default="sepolia", min_length=1)
    admins: list[AdminInput] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_threshold(self) -> "CreateVaultRequest":
        if self.threshold > len(self.admins):
            raise ValueError("Threshold cannot be greater than the number of admins.")
        return self


class CreateProposalRequest(BaseModel):
    vault_id: int = Field(gt=0)
    title: str = Field(min_length=1)
    description: str | None = None
    destination: str = Field(min_length=1)
    amount_eth: str = Field(min_length=1)
    payload: dict[str, Any] | None = None
    proposer_wallet_address: str | None = None
    onchain_proposal_id: int | None = Field(default=None, ge=0)


class SignProposalRequest(BaseModel):
    proposal_id: int = Field(gt=0)
    admin_public_key: str = Field(min_length=1)
    signature: str | None = None
    private_key: str | None = None
    signer_wallet_address: str | None = None
    algorithm: str = DEFAULT_ALGORITHM

    @model_validator(mode="after")
    def validate_signing_material(self) -> "SignProposalRequest":
        if self.signature and self.private_key:
            raise ValueError("Provide at most one of signature or private_key.")
        self.algorithm = normalize_algorithm(self.algorithm)
        return self


class VerifySignatureRequest(BaseModel):
    signature: str = Field(min_length=1)
    public_key: str = Field(min_length=1)
    message: str | None = None
    proposal_id: int | None = None
    algorithm: str = DEFAULT_ALGORITHM

    @model_validator(mode="after")
    def validate_message_source(self) -> "VerifySignatureRequest":
        has_message = bool(self.message)
        has_proposal_id = self.proposal_id is not None
        if has_message == has_proposal_id:
            raise ValueError("Provide exactly one of message or proposal_id.")
        self.algorithm = normalize_algorithm(self.algorithm)
        return self


class ExecuteProposalRequest(BaseModel):
    proposal_id: int = Field(gt=0)
    executor_wallet_address: str | None = None


class ApproveProposalRequest(BaseModel):
    proposal_id: int = Field(gt=0)
    admin_public_key: str = Field(min_length=1)
    approver_wallet_address: str | None = None


class RegisterWalletAlgorithmsRequest(BaseModel):
    vault_id: int = Field(gt=0)
    wallet_address: str = Field(min_length=1)
