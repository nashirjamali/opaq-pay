use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[constant]
pub const PENDING_ADMIN_SEED: &[u8] = b"pending_admin";

pub const BPS_DENOMINATOR: u64 = 10_000;

/// Hard cap on the protocol fee: 1%.
#[constant]
pub const MAX_FEE_BPS: u16 = 100;
