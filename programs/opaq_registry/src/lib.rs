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

declare_id!("DaqD6ZznS3TP1NbC2tPrUiBjMNwPbJR3GseHZsBXABNk");

/// Registry of Opaq handles (`@raka`) and their stealth meta-addresses, plus the
/// announcement channel payers use to publish ephemeral keys for stealth payments.
#[program]
pub mod opaq_registry {
    use super::*;

    pub fn register_handle(
        ctx: Context<RegisterHandle>,
        name: String,
        scan_pubkey: [u8; 32],
        spend_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::register_handle::handle_register_handle(ctx, name, scan_pubkey, spend_pubkey)
    }

    pub fn update_meta_address(
        ctx: Context<UpdateMetaAddress>,
        scan_pubkey: [u8; 32],
        spend_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::update_meta_address::handle_update_meta_address(
            ctx,
            scan_pubkey,
            spend_pubkey,
        )
    }

    pub fn announce(
        ctx: Context<Announce>,
        ephemeral_pubkey: [u8; 32],
        stealth_address: Pubkey,
        view_tag: u8,
    ) -> Result<()> {
        instructions::announce::handle_announce(ctx, ephemeral_pubkey, stealth_address, view_tag)
    }
}
