use anchor_lang::prelude::*;

use crate::{constants::*, events::HandleRegistered, state::*};

#[derive(Accounts)]
#[instruction(name: String)]
pub struct RegisterHandle<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Handle::INIT_SPACE,
        seeds = [HANDLE_SEED, name.as_bytes()],
        bump
    )]
    pub handle: Account<'info, Handle>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_handle(
    ctx: Context<RegisterHandle>,
    name: String,
    scan_pubkey: [u8; 32],
    spend_pubkey: [u8; 32],
) -> Result<()> {
    validate_handle_name(&name)?;
    validate_meta_address(&scan_pubkey, &spend_pubkey)?;

    let handle = &mut ctx.accounts.handle;
    handle.owner = ctx.accounts.owner.key();
    handle.scan_pubkey = scan_pubkey;
    handle.spend_pubkey = spend_pubkey;
    handle.name = name.clone();
    handle.bump = ctx.bumps.handle;

    emit!(HandleRegistered {
        handle: handle.key(),
        name,
        owner: handle.owner,
        scan_pubkey,
        spend_pubkey,
    });
    Ok(())
}
