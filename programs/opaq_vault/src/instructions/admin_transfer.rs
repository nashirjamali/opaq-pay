use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::VaultError,
    events::{AdminChanged, AdminTransferCancelled, AdminTransferProposed},
    state::*,
};

/// Step 1: the current admin names a successor. Stored in its own PDA so the `Config`
/// layout stays unchanged for already-initialized deployments.
#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + PendingAdmin::INIT_SPACE,
        seeds = [PENDING_ADMIN_SEED, config.key().as_ref()],
        bump
    )]
    pub pending_admin: Account<'info, PendingAdmin>,
    pub system_program: Program<'info, System>,
}

pub fn handle_propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
    let pending = &mut ctx.accounts.pending_admin;
    pending.new_admin = new_admin;
    pending.proposed_by = ctx.accounts.admin.key();
    pending.bump = ctx.bumps.pending_admin;
    emit!(AdminTransferProposed {
        admin: ctx.accounts.admin.key(),
        new_admin,
    });
    Ok(())
}

/// The current admin withdraws a proposal; rent goes back to whoever proposed it.
#[derive(Accounts)]
pub struct CancelAdminTransfer<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ VaultError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PENDING_ADMIN_SEED, config.key().as_ref()],
        bump = pending_admin.bump,
        has_one = proposed_by,
        close = proposed_by
    )]
    pub pending_admin: Account<'info, PendingAdmin>,
    /// CHECK: rent destination, must match `pending_admin.proposed_by`.
    #[account(mut)]
    pub proposed_by: UncheckedAccount<'info>,
}

pub fn handle_cancel_admin_transfer(ctx: Context<CancelAdminTransfer>) -> Result<()> {
    emit!(AdminTransferCancelled {
        admin: ctx.accounts.admin.key(),
        new_admin: ctx.accounts.pending_admin.new_admin,
    });
    Ok(())
}

/// Step 2: the successor proves it controls the key and takes over.
#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PENDING_ADMIN_SEED, config.key().as_ref()],
        bump = pending_admin.bump,
        constraint = pending_admin.new_admin == new_admin.key() @ VaultError::NotProposedAdmin,
        has_one = proposed_by,
        close = proposed_by
    )]
    pub pending_admin: Account<'info, PendingAdmin>,
    /// CHECK: rent destination, must match `pending_admin.proposed_by`.
    #[account(mut)]
    pub proposed_by: UncheckedAccount<'info>,
}

pub fn handle_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_admin = config.admin;
    config.admin = ctx.accounts.new_admin.key();
    emit!(AdminChanged {
        old_admin,
        new_admin: config.admin,
    });
    Ok(())
}
