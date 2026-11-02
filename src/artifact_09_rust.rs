use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::UserLoopError;

#[derive(Accounts)]
pub struct AttestAndSettle<'info> {
    #[account(mut)]
    pub founder: Signer<'info>,

    /// CHECK: Validated against session.participant
    #[account(mut, address = session.participant)]
    pub participant: AccountInfo<'info>,

    #[account(
        mut,
        has_one = founder @ UserLoopError::UnauthorizedFounder,
        has_one = vault,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [VAULT_SEED, campaign.key().as_ref()],
        bump = campaign.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = participant_token_account.owner == session.participant,
        constraint = participant_token_account.mint == campaign.reward_mint,
    )]
    pub participant_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [SESSION_SEED, campaign.key().as_ref(), session.session_id.as_ref()],
        bump = session.bump,
        has_one = campaign,
    )]
    pub session: Account<'info, InterviewSession>,

    #[account(
        init_if_needed,
        payer = founder,
        space = MilestoneProof::LEN,
        seeds = [b"milestone", campaign.key().as_ref()],
        bump
    )]
    pub milestone_proof: Option<Account<'info, MilestoneProof>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<AttestAndSettle>,
    feedback_digest: [u8; 32],
) -> Result<()> {
    let session = &mut ctx.accounts.session;
    require!(session.status == SessionStatus::Booked, UserLoopError::InvalidSessionStatus);

    let campaign = &mut ctx.accounts.campaign;
    require!(ctx.accounts.vault.amount >= campaign.reward_per_user, UserLoopError::InsufficientEscrowFunds);

    // 1. Update session status and record verifiable transcript SHA256
    session.status = SessionStatus::Completed;
    session.feedback_digest = feedback_digest;

    // 2. Transfer SPL token incentive from vault to participant using PDA signing
    let campaign_key = campaign.key();
    let seeds = &[
        VAULT_SEED,
        campaign_key.as_ref(),
        &[campaign.vault_bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.participant_token_account.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    token::transfer(cpi_ctx, campaign.reward_per_user)?;

    // 3. Increment campaign completion counter
    campaign.completed_users = campaign.completed_users.checked_add(1).unwrap();
    msg!("Interview Completed. Total Completed: {}/{}", campaign.completed_users, campaign.target_users);

    // 4. Milestone Check: If 5 users achieved, write immutable proof PDA
    if campaign.completed_users >= 5 && ctx.accounts.milestone_proof.is_some() {
        let proof = ctx.accounts.milestone_proof.as_mut().unwrap();
        let clock = Clock::get()?;
        proof.campaign = campaign.key();
        proof.founder = campaign.founder;
        proof.achieved_at = clock.unix_timestamp;
        proof.total_verified_users = campaign.completed_users;
        proof.bump = ctx.bumps.milestone_proof.unwrap_or(0);
        msg!("🏆 COLOSSEUM FOUNDER SUPPORT MILESTONE ACHIEVED: 5 Authentic Interviews Verified!");
    }

    Ok(())
}