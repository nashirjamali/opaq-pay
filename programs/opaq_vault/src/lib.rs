pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("9hoWkfxQ7igd7LJvmeVt1DjPrctY4wrVR7qgcqNZJn1Q");

/// Holds the underlying stablecoin (USDC) 1:1 against a Token-2022 wrapper mint that has
/// the Confidential Transfer extension. Users deposit USDC and receive wrapper tokens in
/// their public balance, then move them into their confidential balance client-side.
///
/// Invariant: vault balance == wrapper supply. The protocol fee is taken in the
/// underlying token on deposit, capped on-chain at `MAX_FEE_BPS`. No instruction lets
/// the admin move vault funds.
#[program]
pub mod opaq_vault {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, fee_bps: u16) -> Result<()> {
        instructions::init_config::handle_init_config(ctx, fee_bps)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx, amount)
    }

    pub fn set_fee(ctx: Context<SetFee>, fee_bps: u16) -> Result<()> {
        instructions::set_fee::handle_set_fee(ctx, fee_bps)
    }
}
