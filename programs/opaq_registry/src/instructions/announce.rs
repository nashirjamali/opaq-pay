use anchor_lang::prelude::*;

use crate::{error::RegistryError, events::Announcement};

/// Stateless: the announcement lives only in the emitted event. Uses `emit_cpi!`
/// so indexers can read it from inner instructions instead of truncatable logs.
#[event_cpi]
#[derive(Accounts)]
pub struct Announce<'info> {
    pub announcer: Signer<'info>,
}

pub fn handle_announce(
    ctx: Context<Announce>,
    ephemeral_pubkey: [u8; 32],
    stealth_address: Pubkey,
    view_tag: u8,
) -> Result<()> {
    require!(ephemeral_pubkey != [0u8; 32], RegistryError::InvalidPubkey);
    require!(
        stealth_address != Pubkey::default(),
        RegistryError::InvalidPubkey
    );

    emit_cpi!(Announcement {
        ephemeral_pubkey,
        stealth_address,
        view_tag,
        announcer: ctx.accounts.announcer.key(),
    });
    Ok(())
}
