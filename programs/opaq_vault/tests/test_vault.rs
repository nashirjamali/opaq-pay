use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, program_pack::Pack},
        system_program, AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        token::spl_token,
        token_2022::spl_token_2022::{
            self,
            extension::{confidential_transfer, ExtensionType},
        },
    },
    litesvm::LiteSVM,
    opaq_vault::{state::Config, CONFIG_SEED, VAULT_SEED},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const DECIMALS: u8 = 6;
const FEE_BPS: u16 = 50;

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    user: Keypair,
    usdc: Pubkey,
    wrapped: Pubkey,
    config: Pubkey,
    vault: Pubkey,
    treasury: Pubkey,
    user_usdc: Pubkey,
    user_wrapped: Pubkey,
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], signers: &[&Keypair]) -> bool {
    let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    let res = svm.send_transaction(tx);
    if let Err(e) = &res {
        eprintln!("tx failed: {:?}", e.err);
    }
    svm.expire_blockhash();
    res.is_ok()
}

/// Places an empty, rent-exempt account owned by `owner` so it can be initialized
/// without a system create_account instruction.
fn alloc(svm: &mut LiteSVM, owner: &Pubkey, len: usize) -> Pubkey {
    let key = Pubkey::new_unique();
    let account = Account {
        lamports: svm.minimum_balance_for_rent_exemption(len),
        data: vec![0; len],
        owner: *owner,
        executable: false,
        rent_epoch: 0,
    };
    svm.set_account(key, account).unwrap();
    key
}

fn token_account(
    svm: &mut LiteSVM,
    payer: &Keypair,
    program: &Pubkey,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Pubkey {
    let key = alloc(svm, program, spl_token::state::Account::LEN);
    let ix = if *program == spl_token::ID {
        spl_token::instruction::initialize_account3(program, &key, mint, owner).unwrap()
    } else {
        spl_token_2022::instruction::initialize_account3(program, &key, mint, owner).unwrap()
    };
    assert!(send(svm, &[ix], &[payer]));
    key
}

fn balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let data = svm.get_account(account).unwrap().data;
    spl_token_2022::state::Account::unpack_from_slice(&data[..spl_token_2022::state::Account::LEN])
        .unwrap()
        .amount
}

fn supply(svm: &LiteSVM, mint: &Pubkey) -> u64 {
    let data = svm.get_account(mint).unwrap().data;
    spl_token_2022::state::Mint::unpack_from_slice(&data[..spl_token_2022::state::Mint::LEN])
        .unwrap()
        .supply
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &opaq_vault::id()).0
}

/// Token-2022 wrapper mint whose mint authority is the config PDA.
fn wrapped_mint(svm: &mut LiteSVM, payer: &Keypair, with_confidential: bool) -> Pubkey {
    let extensions: &[ExtensionType] = if with_confidential {
        &[ExtensionType::ConfidentialTransferMint]
    } else {
        &[]
    };
    let len = ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(extensions)
        .unwrap();
    let mint = alloc(svm, &spl_token_2022::ID, len);
    let mut ixs = Vec::new();
    if with_confidential {
        ixs.push(
            confidential_transfer::instruction::initialize_mint(
                &spl_token_2022::ID,
                &mint,
                Some(payer.pubkey()),
                true,
                None,
            )
            .unwrap(),
        );
    }
    ixs.push(
        spl_token_2022::instruction::initialize_mint2(
            &spl_token_2022::ID,
            &mint,
            &config_pda(),
            None,
            DECIMALS,
        )
        .unwrap(),
    );
    assert!(send(svm, &ixs, &[payer]));
    mint
}

fn init_config_ix(
    admin: &Pubkey,
    usdc: &Pubkey,
    wrapped: &Pubkey,
    treasury: &Pubkey,
    fee_bps: u16,
) -> Instruction {
    let config = config_pda();
    let vault = Pubkey::find_program_address(&[VAULT_SEED, config.as_ref()], &opaq_vault::id()).0;
    Instruction::new_with_bytes(
        opaq_vault::id(),
        &opaq_vault::instruction::InitConfig { fee_bps }.data(),
        opaq_vault::accounts::InitConfig {
            admin: *admin,
            config,
            underlying_mint: *usdc,
            wrapped_mint: *wrapped,
            vault,
            treasury: *treasury,
            underlying_token_program: spl_token::ID,
            wrapped_token_program: spl_token_2022::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn base_setup() -> (LiteSVM, Keypair, Keypair, Pubkey, Pubkey) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/opaq_vault.so"
    ));
    svm.add_program(opaq_vault::id(), bytes).unwrap();

    let admin = Keypair::new();
    let user = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let usdc = alloc(&mut svm, &spl_token::ID, spl_token::state::Mint::LEN);
    let ix = spl_token::instruction::initialize_mint2(
        &spl_token::ID,
        &usdc,
        &admin.pubkey(),
        None,
        DECIMALS,
    )
    .unwrap();
    assert!(send(&mut svm, &[ix], &[&admin]));

    let treasury = token_account(&mut svm, &admin, &spl_token::ID, &usdc, &admin.pubkey());
    (svm, admin, user, usdc, treasury)
}

fn setup() -> Env {
    let (mut svm, admin, user, usdc, treasury) = base_setup();
    let wrapped = wrapped_mint(&mut svm, &admin, true);
    assert!(send(
        &mut svm,
        &[init_config_ix(
            &admin.pubkey(),
            &usdc,
            &wrapped,
            &treasury,
            FEE_BPS
        )],
        &[&admin]
    ));

    let user_usdc = token_account(&mut svm, &user, &spl_token::ID, &usdc, &user.pubkey());
    let user_wrapped = token_account(
        &mut svm,
        &user,
        &spl_token_2022::ID,
        &wrapped,
        &user.pubkey(),
    );
    let ix = spl_token::instruction::mint_to(
        &spl_token::ID,
        &usdc,
        &user_usdc,
        &admin.pubkey(),
        &[],
        10_000_000,
    )
    .unwrap();
    assert!(send(&mut svm, &[ix], &[&admin]));

    let config = config_pda();
    let vault = Pubkey::find_program_address(&[VAULT_SEED, config.as_ref()], &opaq_vault::id()).0;
    Env {
        svm,
        admin,
        user,
        usdc,
        wrapped,
        config,
        vault,
        treasury,
        user_usdc,
        user_wrapped,
    }
}

fn deposit_ix(env: &Env, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        opaq_vault::id(),
        &opaq_vault::instruction::Deposit { amount }.data(),
        opaq_vault::accounts::Deposit {
            depositor: env.user.pubkey(),
            config: env.config,
            underlying_mint: env.usdc,
            wrapped_mint: env.wrapped,
            depositor_token: env.user_usdc,
            vault: env.vault,
            treasury: env.treasury,
            destination: env.user_wrapped,
            underlying_token_program: spl_token::ID,
            wrapped_token_program: spl_token_2022::ID,
        }
        .to_account_metas(None),
    )
}

fn withdraw_ix(env: &Env, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        opaq_vault::id(),
        &opaq_vault::instruction::Withdraw { amount }.data(),
        opaq_vault::accounts::Withdraw {
            owner: env.user.pubkey(),
            config: env.config,
            underlying_mint: env.usdc,
            wrapped_mint: env.wrapped,
            owner_wrapped: env.user_wrapped,
            vault: env.vault,
            destination: env.user_usdc,
            underlying_token_program: spl_token::ID,
            wrapped_token_program: spl_token_2022::ID,
        }
        .to_account_metas(None),
    )
}

fn set_fee_ix(env: &Env, admin: &Pubkey, fee_bps: u16) -> Instruction {
    Instruction::new_with_bytes(
        opaq_vault::id(),
        &opaq_vault::instruction::SetFee { fee_bps }.data(),
        opaq_vault::accounts::SetFee {
            admin: *admin,
            config: env.config,
        }
        .to_account_metas(None),
    )
}

#[test]
fn init_config_stores_settings() {
    let env = setup();
    let account = env.svm.get_account(&env.config).unwrap();
    let config = Config::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(config.admin, env.admin.pubkey());
    assert_eq!(config.underlying_mint, env.usdc);
    assert_eq!(config.wrapped_mint, env.wrapped);
    assert_eq!(config.vault, env.vault);
    assert_eq!(config.treasury, env.treasury);
    assert_eq!(config.fee_bps, FEE_BPS);
}

#[test]
fn init_config_rejects_mint_without_confidential_transfer() {
    let (mut svm, admin, _user, usdc, treasury) = base_setup();
    let wrapped = wrapped_mint(&mut svm, &admin, false);
    assert!(!send(
        &mut svm,
        &[init_config_ix(
            &admin.pubkey(),
            &usdc,
            &wrapped,
            &treasury,
            FEE_BPS
        )],
        &[&admin]
    ));
}

#[test]
fn init_config_rejects_fee_above_cap() {
    let (mut svm, admin, _user, usdc, treasury) = base_setup();
    let wrapped = wrapped_mint(&mut svm, &admin, true);
    assert!(!send(
        &mut svm,
        &[init_config_ix(
            &admin.pubkey(),
            &usdc,
            &wrapped,
            &treasury,
            101
        )],
        &[&admin]
    ));
}

#[test]
fn deposit_then_withdraw_keeps_vault_backed_one_to_one() {
    let mut env = setup();

    let ix = deposit_ix(&env, 1_000_000);
    assert!(send(&mut env.svm, &[ix], &[&env.user]));
    // 0.5% fee on 1_000_000 = 5_000
    assert_eq!(balance(&env.svm, &env.treasury), 5_000);
    assert_eq!(balance(&env.svm, &env.vault), 995_000);
    assert_eq!(balance(&env.svm, &env.user_wrapped), 995_000);
    assert_eq!(
        supply(&env.svm, &env.wrapped),
        balance(&env.svm, &env.vault)
    );

    let ix = withdraw_ix(&env, 995_000);
    assert!(send(&mut env.svm, &[ix], &[&env.user]));
    assert_eq!(balance(&env.svm, &env.vault), 0);
    assert_eq!(supply(&env.svm, &env.wrapped), 0);
    assert_eq!(balance(&env.svm, &env.user_usdc), 10_000_000 - 5_000);
}

#[test]
fn rejects_zero_deposit_accepts_one_unit() {
    let mut env = setup();
    let ix = deposit_ix(&env, 0);
    assert!(!send(&mut env.svm, &[ix], &[&env.user]));
    // Fee on 1 unit rounds to 0, so 1 unit is accepted in full; nothing to reject.
    let ix = deposit_ix(&env, 1);
    assert!(send(&mut env.svm, &[ix], &[&env.user]));
    assert_eq!(balance(&env.svm, &env.user_wrapped), 1);
}

#[test]
fn cannot_withdraw_more_than_wrapped_balance() {
    let mut env = setup();
    let ix = deposit_ix(&env, 1_000_000);
    assert!(send(&mut env.svm, &[ix], &[&env.user]));
    let ix = withdraw_ix(&env, 995_001);
    assert!(!send(&mut env.svm, &[ix], &[&env.user]));
}

#[test]
fn set_fee_is_admin_only_and_capped() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();

    let ix = set_fee_ix(&env, &env.user.pubkey(), 10);
    assert!(!send(&mut env.svm, &[ix], &[&env.user]));

    let ix = set_fee_ix(&env, &admin.pubkey(), 101);
    assert!(!send(&mut env.svm, &[ix], &[&admin]));

    let ix = set_fee_ix(&env, &admin.pubkey(), 100);
    assert!(send(&mut env.svm, &[ix], &[&admin]));
    let account = env.svm.get_account(&env.config).unwrap();
    assert_eq!(
        Config::try_deserialize(&mut account.data.as_slice())
            .unwrap()
            .fee_bps,
        100
    );
}
