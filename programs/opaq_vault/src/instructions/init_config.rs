use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{
        spl_token_2022::extension::confidential_transfer::ConfidentialTransferMint, Token2022,
    },
    token_interface::{get_mint_extension_data, Mint, TokenAccount, TokenInterface},
};

use crate::{constants::*, error::VaultError, events::ConfigInitialized, state::*};

/// The wrapper mint is created client-side (Token-2022 + Confidential Transfer
/// extension) with the config PDA as mint authority, then handed to this instruction.
#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = underlying_token_program)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mint::token_program = wrapped_token_program,
        mint::authority = config,
        mint::decimals = underlying_mint.decimals,
    )]
    pub wrapped_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED, config.key().as_ref()],
        bump,
        token::mint = underlying_mint,
        token::authority = config,
        token::token_program = underlying_token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        token::mint = underlying_mint,
        token::token_program = underlying_token_program,
    )]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    pub underlying_token_program: Interface<'info, TokenInterface>,
    pub wrapped_token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_config(ctx: Context<InitConfig>, fee_bps: u16) -> Result<()> {
    validate_fee(fee_bps)?;

    let wrapped_mint = &ctx.accounts.wrapped_mint;
    require!(wrapped_mint.supply == 0, VaultError::WrapperSupplyNotZero);
    require!(
        wrapped_mint.freeze_authority.is_none(),
        VaultError::FreezeAuthoritySet
    );
    get_mint_extension_data::<ConfidentialTransferMint>(&wrapped_mint.to_account_info())
        .map_err(|_| error!(VaultError::MissingConfidentialTransfer))?;

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.underlying_mint = ctx.accounts.underlying_mint.key();
    config.wrapped_mint = wrapped_mint.key();
    config.vault = ctx.accounts.vault.key();
    config.treasury = ctx.accounts.treasury.key();
    config.fee_bps = fee_bps;
    config.bump = ctx.bumps.config;
    config.vault_bump = ctx.bumps.vault;

    emit!(ConfigInitialized {
        admin: config.admin,
        underlying_mint: config.underlying_mint,
        wrapped_mint: config.wrapped_mint,
        vault: config.vault,
        treasury: config.treasury,
        fee_bps,
    });
    Ok(())
}
