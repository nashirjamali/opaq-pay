use {
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, system_program,
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    opaq_registry::{state::Handle, HANDLE_SEED},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const SCAN: [u8; 32] = [1u8; 32];
const SPEND: [u8; 32] = [2u8; 32];

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/opaq_registry.so"
    ));
    svm.add_program(opaq_registry::id(), bytes).unwrap();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    (svm, owner)
}

fn send(svm: &mut LiteSVM, ix: Instruction, signer: &Keypair) -> bool {
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    let ok = svm.send_transaction(tx).is_ok();
    svm.expire_blockhash();
    ok
}

fn handle_pda(name: &str) -> Pubkey {
    Pubkey::find_program_address(&[HANDLE_SEED, name.as_bytes()], &opaq_registry::id()).0
}

fn register_ix(owner: &Pubkey, name: &str, scan: [u8; 32], spend: [u8; 32]) -> Instruction {
    Instruction::new_with_bytes(
        opaq_registry::id(),
        &opaq_registry::instruction::RegisterHandle {
            name: name.to_string(),
            scan_pubkey: scan,
            spend_pubkey: spend,
        }
        .data(),
        opaq_registry::accounts::RegisterHandle {
            owner: *owner,
            handle: handle_pda(name),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn update_ix(owner: &Pubkey, name: &str, scan: [u8; 32], spend: [u8; 32]) -> Instruction {
    Instruction::new_with_bytes(
        opaq_registry::id(),
        &opaq_registry::instruction::UpdateMetaAddress {
            scan_pubkey: scan,
            spend_pubkey: spend,
        }
        .data(),
        opaq_registry::accounts::UpdateMetaAddress {
            owner: *owner,
            handle: handle_pda(name),
        }
        .to_account_metas(None),
    )
}

fn read_handle(svm: &LiteSVM, name: &str) -> Handle {
    let account = svm.get_account(&handle_pda(name)).unwrap();
    Handle::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn registers_handle() {
    let (mut svm, owner) = setup();
    assert!(send(
        &mut svm,
        register_ix(&owner.pubkey(), "raka", SCAN, SPEND),
        &owner
    ));

    let handle = read_handle(&svm, "raka");
    assert_eq!(handle.owner, owner.pubkey());
    assert_eq!(handle.scan_pubkey, SCAN);
    assert_eq!(handle.spend_pubkey, SPEND);
    assert_eq!(handle.name, "raka");
}

#[test]
fn rejects_duplicate_handle() {
    let (mut svm, owner) = setup();
    assert!(send(
        &mut svm,
        register_ix(&owner.pubkey(), "raka", SCAN, SPEND),
        &owner
    ));

    let other = Keypair::new();
    svm.airdrop(&other.pubkey(), 1_000_000_000).unwrap();
    assert!(!send(
        &mut svm,
        register_ix(&other.pubkey(), "raka", SCAN, SPEND),
        &other
    ));
}

#[test]
fn rejects_invalid_handles_and_keys() {
    let (mut svm, owner) = setup();
    for name in ["ab", "Raka", "ra-ka", "raka!"] {
        assert!(
            !send(
                &mut svm,
                register_ix(&owner.pubkey(), name, SCAN, SPEND),
                &owner
            ),
            "accepted {name}"
        );
    }
    assert!(!send(
        &mut svm,
        register_ix(&owner.pubkey(), "zero", [0u8; 32], SPEND),
        &owner
    ));
    assert!(!send(
        &mut svm,
        register_ix(&owner.pubkey(), "same", SCAN, SCAN),
        &owner
    ));
}

#[test]
fn only_owner_updates_meta_address() {
    let (mut svm, owner) = setup();
    assert!(send(
        &mut svm,
        register_ix(&owner.pubkey(), "raka", SCAN, SPEND),
        &owner
    ));

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
    assert!(!send(
        &mut svm,
        update_ix(&attacker.pubkey(), "raka", [3u8; 32], [4u8; 32]),
        &attacker
    ));
    assert_eq!(read_handle(&svm, "raka").scan_pubkey, SCAN);

    assert!(send(
        &mut svm,
        update_ix(&owner.pubkey(), "raka", [3u8; 32], [4u8; 32]),
        &owner
    ));
    let handle = read_handle(&svm, "raka");
    assert_eq!(handle.scan_pubkey, [3u8; 32]);
    assert_eq!(handle.spend_pubkey, [4u8; 32]);
}

#[test]
fn announces_payment() {
    let (mut svm, payer) = setup();
    let event_authority =
        Pubkey::find_program_address(&[b"__event_authority"], &opaq_registry::id()).0;
    let ix = |ephemeral: [u8; 32]| {
        Instruction::new_with_bytes(
            opaq_registry::id(),
            &opaq_registry::instruction::Announce {
                ephemeral_pubkey: ephemeral,
                stealth_address: Pubkey::new_unique(),
                view_tag: 7,
            }
            .data(),
            opaq_registry::accounts::Announce {
                announcer: payer.pubkey(),
                event_authority,
                program: opaq_registry::id(),
            }
            .to_account_metas(None),
        )
    };
    assert!(send(&mut svm, ix([9u8; 32]), &payer));
    assert!(!send(&mut svm, ix([0u8; 32]), &payer));
}
