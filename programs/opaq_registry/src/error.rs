use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    #[msg("Handle must be 3-32 characters of a-z, 0-9 or _")]
    InvalidHandle,
    #[msg("Public key must not be all zeros")]
    InvalidPubkey,
    #[msg("Scan and spend keys must differ")]
    DuplicateKeys,
    #[msg("Only the handle owner can perform this action")]
    Unauthorized,
}
