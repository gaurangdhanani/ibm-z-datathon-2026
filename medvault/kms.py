"""VLT-1: key management and envelope encryption, AES-256-GCM throughout.

master key   derived from MEDVAULT_SECRET_KEY with HKDF-SHA256; lives only in memory
vault KEK    random per vault, stored wrapped by the master key (``Vault.wrapped_kek``)
record DEK   random per record, stored wrapped by the vault KEK (``Record.wrapped_dek``)

Every wrap and ciphertext is bound to its owner through GCM additional data
(``vault:<id>:v<version>`` / ``record:<id>:v<version>``), so a blob moved to another row or key
version fails to decrypt. A key swap (VLT-6, ``rotate_record``) replaces the KEK *and* every DEK
and re-encrypts the bytes: the previous holder's key material opens nothing, even a kept copy.
"""

from __future__ import annotations

import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from medvault.models import Record, Vault

KEY_BYTES = 32
NONCE_BYTES = 12


def derive_master_key(secret_key: str) -> bytes:
    hkdf = HKDF(
        algorithm=hashes.SHA256(), length=KEY_BYTES, salt=b"medvault-kms", info=b"master-key-v1"
    )
    return hkdf.derive(secret_key.encode("utf-8"))


def new_key() -> bytes:
    return AESGCM.generate_key(bit_length=256)


def seal(key: bytes, plaintext: bytes, aad: bytes) -> bytes:
    """nonce || ciphertext+tag."""
    nonce = os.urandom(NONCE_BYTES)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, aad)


def unseal(key: bytes, blob: bytes, aad: bytes) -> bytes:
    return AESGCM(key).decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], aad)


def vault_aad(vault_id: int, version: int) -> bytes:
    return f"vault:{vault_id}:v{version}".encode()


def record_aad(record_id: int, version: int) -> bytes:
    return f"record:{record_id}:v{version}".encode()


class Kms:
    def __init__(self, secret_key: str) -> None:
        self._master = derive_master_key(secret_key)

    # ---- vault keys -------------------------------------------------------------------------

    def new_vault_key(self, vault_id: int, version: int) -> tuple[bytes, bytes]:
        """Returns (kek, wrapped_kek). Store the wrapped one on the vault; never the kek."""
        kek = new_key()
        return kek, seal(self._master, kek, vault_aad(vault_id, version))

    def unwrap_vault_key(self, vault: Vault) -> bytes:
        if vault.wrapped_kek is None:
            raise ValueError(f"vault {vault.id} has no key; run `make seed`")
        return unseal(self._master, vault.wrapped_kek, vault_aad(vault.id, vault.key_version))

    # ---- records ----------------------------------------------------------------------------

    def encrypt_record(
        self, kek: bytes, record: Record, plaintext: bytes, tags: dict | None, version: int
    ) -> None:
        """Fresh DEK: fills ciphertext, nonce, wrapped_dek, encrypted_tags, key_version, size."""
        if record.id is None:
            raise ValueError("flush the record first so the AAD can include its id")
        dek = new_key()
        aad = record_aad(record.id, version)
        record.nonce = os.urandom(NONCE_BYTES)
        record.ciphertext = AESGCM(dek).encrypt(record.nonce, plaintext, aad)
        record.wrapped_dek = seal(kek, dek, aad)
        record.encrypted_tags = seal(dek, json.dumps(tags).encode(), aad) if tags else None
        record.key_version = version
        record.size_bytes = len(plaintext)

    def _dek(self, kek: bytes, record: Record) -> bytes:
        return unseal(kek, record.wrapped_dek, record_aad(record.id, record.key_version))

    def decrypt_record(self, kek: bytes, record: Record) -> bytes:
        aad = record_aad(record.id, record.key_version)
        return AESGCM(self._dek(kek, record)).decrypt(record.nonce, record.ciphertext, aad)

    def decrypt_tags(self, kek: bytes, record: Record) -> dict | None:
        if record.encrypted_tags is None:
            return None
        aad = record_aad(record.id, record.key_version)
        return json.loads(unseal(self._dek(kek, record), record.encrypted_tags, aad))

    def rotate_record(self, old_kek: bytes, new_kek: bytes, record: Record, version: int) -> None:
        """Key swap step: decrypt under the old keys, re-encrypt under a new DEK and the new KEK."""
        plaintext = self.decrypt_record(old_kek, record)
        tags = self.decrypt_tags(old_kek, record)
        self.encrypt_record(new_kek, record, plaintext, tags, version)
