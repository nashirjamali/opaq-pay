use anchor_lang::prelude::*;

#[event]
pub struct HandleRegistered {
    pub handle: Pubkey,
    pub name: String,
    pub owner: Pubkey,
    pub scan_pubkey: [u8; 32],
    pub spend_pubkey: [u8; 32],
}

#[event]
pub struct MetaAddressUpdated {
    pub handle: Pubkey,
    pub scan_pubkey: [u8; 32],
    pub spend_pubkey: [u8; 32],
}

/// Published by the payer alongside a stealth payment so the recipient can find it
/// by scanning with their scan key (ERC-5564-style announcement).
#[event]
pub struct Announcement {
    pub ephemeral_pubkey: [u8; 32],
    pub stealth_address: Pubkey,
    /// First byte of the shared secret hash; lets scanners skip most non-matching
    /// announcements without a full key derivation.
    pub view_tag: u8,
    pub announcer: Pubkey,
}
