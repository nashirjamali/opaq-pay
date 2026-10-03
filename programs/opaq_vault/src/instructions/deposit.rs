use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{
        mint_to, transfer_checked, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
    },
};

use crate::{constants::*, error::VaultError, events::Deposited, state::*};

/// Moves `amount` of the underlying from the depositor: `amount - fee` into the vault and
/// `fee` to the treasury, then mints `amount - fee` wrapper tokens to `destination`.
/// `destination` may belong to anyone, so a stealth address can sweep straight into the
/// recipient's wrapper account.
#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = underlying_mint,
        has_one = wrapped_mint,
        has_one = vault,
        has_one = treasury,
    )]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = underlying_token_program)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, mint::token_program = wrapped_token_program)]
    pub wrapped_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = depositor,
        token::token_program = underlying_token_program,
    )]
    pub depositor_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = underlying_mint, token::token_program = underlying_token_program)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = underlying_mint, token::token_program = underlying_token_program)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = wrapped_mint, token::token_program = wrapped_token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub underlying_token_program: Interface<'info, TokenInterface>,
    pub wrapped_token_program: Program<'info, Token2022>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);
    let fee = compute_fee(amount, ctx.accounts.config.fee_bps)?;
    let net = amount.checked_sub(fee).ok_or(VaultError::MathOverflow)?;
    require!(net > 0, VaultError::AmountTooSmall);

    let decimals = ctx.accounts.underlying_mint.decimals;
    let underlying_program = ctx.accounts.underlying_token_program.key();

    transfer_checked(
        CpiContext::new(
            underlying_program,
            TransferChecked {
                from: ctx.accounts.depositor_token.to_account_info(),
                mint: ctx.accounts.underlying_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        net,
        decimals,
    )?;

    if fee > 0 {
        transfer_checked(
            CpiContext::new(
                underlying_program,
                TransferChecked {
                    from: ctx.accounts.depositor_token.to_account_info(),
                    mint: ctx.accounts.underlying_mint.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            fee,
            decimals,
        )?;
    }

    let seeds = ctx.accounts.config.signer_seeds();
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.wrapped_token_program.key(),
            MintTo {
                mint: ctx.accounts.wrapped_mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[&seeds],
        ),
        net,
    )?;

    emit!(Deposited {
        depositor: ctx.accounts.depositor.key(),
        destination: ctx.accounts.destination.key(),
        amount,
        fee,
    });
    Ok(())
}
