use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::state::*;
use crate::errors::UserLoopError;

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct InitializeCampaign<'info> {
    #[account(mut)]
    pub founder: Signer<'info>,

    pub reward_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = founder,
        space = Campaign::LEN,
        seeds = [CAMPAIGN_SEED, founder.key().as_ref(), &campaign_id.to_le_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init,
        payer = founder,
        seeds = [VAULT_SEED, campaign.key().as_ref()],
        bump,
        token::mint = reward_mint,
        token::authority = vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializeCampaign>,
    _campaign_id: u64,
    reward_per_user: u64,
    target_users: u32,
    metadata_uri: String,
) -> Result<()> {
    require!(target_users >= 5, UserLoopError::InsufficientTargetQuota);
    require!(metadata_uri.len() <= 128, UserLoopError::InvalidDigestLength);

    let campaign = &mut ctx.accounts.campaign;
    campaign.founder = ctx.accounts.founder.key();
    campaign.reward_mint = ctx.accounts.reward_mint.key();
    campaign.vault = ctx.accounts.vault.key();
    campaign.reward_per_user = reward_per_user;
    campaign.target_users = target_users;
    campaign.completed_users = 0;
    campaign.bump = ctx.bumps.campaign;
    campaign.vault_bump = ctx.bumps.vault;
    campaign.metadata_uri = metadata_uri;

    msg!("Campaign Initialized: Target {} Users. Vault: {}", target_users, ctx.accounts.vault.key());
    Ok(())
}