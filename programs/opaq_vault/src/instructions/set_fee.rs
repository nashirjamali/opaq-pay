use anchor_lang::prelude::*;

use crate::{constants::*, error::VaultError, events::FeeUpdated, state::*};

#[derive(Accounts)]
pub struct SetFee<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ VaultError::Unauthorized,
    )]
    pub config: Account<'info, Config>,
}

pub fn handle_set_fee(ctx: Context<SetFee>, fee_bps: u16) -> Result<()> {
    validate_fee(fee_bps)?;

    let config = &mut ctx.accounts.config;
    let old_fee_bps = config.fee_bps;
    config.fee_bps = fee_bps;

    emit!(FeeUpdated {
        old_fee_bps,
        new_fee_bps: fee_bps,
    });
    Ok(())
}
