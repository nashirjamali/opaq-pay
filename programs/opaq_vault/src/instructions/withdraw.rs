use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{
        burn, transfer_checked, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
    },
};

use crate::{constants::*, error::VaultError, events::Withdrawn, state::*};

/// Burns `amount` wrapper tokens from the owner's public balance and releases the same
/// amount of the underlying from the vault. The owner must first move funds from their
/// confidential balance to their public balance (client-side, Token-2022 withdraw).
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = underlying_mint,
        has_one = wrapped_mint,
        has_one = vault,
    )]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = underlying_token_program)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, mint::token_program = wrapped_token_program)]
    pub wrapped_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = wrapped_mint,
        token::authority = owner,
        token::token_program = wrapped_token_program,
    )]
    pub owner_wrapped: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = underlying_mint, token::token_program = underlying_token_program)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = underlying_mint, token::token_program = underlying_token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub underlying_token_program: Interface<'info, TokenInterface>,
    pub wrapped_token_program: Program<'info, Token2022>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);

    burn(
        CpiContext::new(
            ctx.accounts.wrapped_token_program.key(),
            Burn {
                mint: ctx.accounts.wrapped_mint.to_account_info(),
                from: ctx.accounts.owner_wrapped.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    let seeds = ctx.accounts.config.signer_seeds();
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.underlying_token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.underlying_mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[&seeds],
        ),
        amount,
        ctx.accounts.underlying_mint.decimals,
    )?;

    emit!(Withdrawn {
        owner: ctx.accounts.owner.key(),
        destination: ctx.accounts.destination.key(),
        amount,
    });
    Ok(())
}
