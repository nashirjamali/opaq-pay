use anchor_lang::prelude::*;

use crate::{constants::*, error::RegistryError, events::MetaAddressUpdated, state::*};

#[derive(Accounts)]
pub struct UpdateMetaAddress<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [HANDLE_SEED, handle.name.as_bytes()],
        bump = handle.bump,
        has_one = owner @ RegistryError::Unauthorized
    )]
    pub handle: Account<'info, Handle>,
}

pub fn handle_update_meta_address(
    ctx: Context<UpdateMetaAddress>,
    scan_pubkey: [u8; 32],
    spend_pubkey: [u8; 32],
) -> Result<()> {
    validate_meta_address(&scan_pubkey, &spend_pubkey)?;

    let handle = &mut ctx.accounts.handle;
    handle.scan_pubkey = scan_pubkey;
    handle.spend_pubkey = spend_pubkey;

    emit!(MetaAddressUpdated {
        handle: handle.key(),
        scan_pubkey,
        spend_pubkey,
    });
    Ok(())
}
