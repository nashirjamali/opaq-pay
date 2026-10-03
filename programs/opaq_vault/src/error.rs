use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Fee exceeds the 1% cap")]
    FeeTooHigh,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Amount after fee must be greater than zero")]
    AmountTooSmall,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Wrapper mint must have the Confidential Transfer extension")]
    MissingConfidentialTransfer,
    #[msg("Wrapper mint must have no freeze authority")]
    FreezeAuthoritySet,
    #[msg("Wrapper mint must have zero supply at initialization")]
    WrapperSupplyNotZero,
    #[msg("Only the admin can perform this action")]
    Unauthorized,
}
