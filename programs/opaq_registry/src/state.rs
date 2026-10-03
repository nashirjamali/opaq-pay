use anchor_lang::prelude::*;

use crate::{constants::*, error::RegistryError};

/// A registered handle and the recipient's stealth meta-address.
/// PDA: `["handle", name]`.
#[account]
#[derive(InitSpace)]
pub struct Handle {
    /// Account allowed to update the meta-address. Holds no funds.
    pub owner: Pubkey,
    /// Public scan key (detects incoming payments).
    pub scan_pubkey: [u8; 32],
    /// Public spend key (one-time keys are derived from it).
    pub spend_pubkey: [u8; 32],
    #[max_len(MAX_HANDLE_LEN)]
    pub name: String,
    pub bump: u8,
}

pub fn validate_handle_name(name: &str) -> Result<()> {
    let len = name.len();
    require!(
        (MIN_HANDLE_LEN..=MAX_HANDLE_LEN).contains(&len)
            && name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'),
        RegistryError::InvalidHandle
    );
    Ok(())
}

pub fn validate_meta_address(scan_pubkey: &[u8; 32], spend_pubkey: &[u8; 32]) -> Result<()> {
    require!(
        *scan_pubkey != [0u8; 32] && *spend_pubkey != [0u8; 32],
        RegistryError::InvalidPubkey
    );
    require!(scan_pubkey != spend_pubkey, RegistryError::DuplicateKeys);
    Ok(())
}
