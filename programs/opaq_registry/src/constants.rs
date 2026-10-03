use anchor_lang::prelude::*;

#[constant]
pub const HANDLE_SEED: &[u8] = b"handle";

pub const MIN_HANDLE_LEN: usize = 3;

/// Also the PDA seed limit (32 bytes per seed).
pub const MAX_HANDLE_LEN: usize = 32;
