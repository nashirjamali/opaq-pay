use anchor_lang::prelude::*;

use crate::{constants::*, error::VaultError};

/// PDA: `["config"]`. Also the vault authority and the wrapper mint authority.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Underlying stablecoin (USDC) mint.
    pub underlying_mint: Pubkey,
    /// Token-2022 wrapper mint with the Confidential Transfer extension.
    pub wrapped_mint: Pubkey,
    /// Token account holding the underlying, PDA `["vault", config]`.
    pub vault: Pubkey,
    /// Underlying-token account receiving protocol fees.
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
    pub vault_bump: u8,
}

/// PDA: `["pending_admin", config]`. Exists only while an admin transfer is proposed.
#[account]
#[derive(InitSpace)]
pub struct PendingAdmin {
    pub new_admin: Pubkey,
    /// Paid the rent; receives it back on accept or cancel.
    pub proposed_by: Pubkey,
    pub bump: u8,
}

impl Config {
    pub fn signer_seeds(&self) -> [&[u8]; 2] {
        [CONFIG_SEED, std::slice::from_ref(&self.bump)]
    }
}

/// Fee in the underlying token, rounded down.
pub fn compute_fee(amount: u64, fee_bps: u16) -> Result<u64> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        / BPS_DENOMINATOR as u128;
    u64::try_from(fee).map_err(|_| VaultError::MathOverflow.into())
}

pub fn validate_fee(fee_bps: u16) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, VaultError::FeeTooHigh);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_rounds_down() {
        assert_eq!(compute_fee(1_000_000, 50).unwrap(), 5_000);
        assert_eq!(compute_fee(199, 50).unwrap(), 0);
        assert_eq!(compute_fee(u64::MAX, MAX_FEE_BPS).unwrap(), u64::MAX / 100);
    }

    #[test]
    fn fee_cap_enforced() {
        assert!(validate_fee(MAX_FEE_BPS).is_ok());
        assert!(validate_fee(MAX_FEE_BPS + 1).is_err());
    }
}
