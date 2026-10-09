use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub underlying_mint: Pubkey,
    pub wrapped_mint: Pubkey,
    pub vault: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
}

/// Deposit amounts are public on-chain anyway (SPL transfers); the event only makes
/// them easy to index.
#[event]
pub struct Deposited {
    pub depositor: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub fee: u64,
}

#[event]
pub struct Withdrawn {
    pub owner: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
}

#[event]
pub struct FeeUpdated {
    pub old_fee_bps: u16,
    pub new_fee_bps: u16,
}

#[event]
pub struct AdminTransferProposed {
    pub admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct AdminTransferCancelled {
    pub admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct AdminChanged {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}
