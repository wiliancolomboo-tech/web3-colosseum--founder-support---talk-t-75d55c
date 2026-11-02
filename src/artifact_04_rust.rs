use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("PuLSE11111111111111111111111111111111111111");

pub const CAMPAIGN_SEED: &[u8] = b"campaign";
pub const INTERVIEW_SEED: &[u8] = b"interview";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TARGET_INTERVIEWS: u8 = 5;

#[program]
pub mod founder_pulse {
    use super::*;

    /// Initializes a new Founder Support campaign requiring exactly 5 interviews.
    /// Locks initial reward tokens in an escrow vault PDA.
    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        campaign_name: String,
        reward_per_interview: u64,
    ) -> Result<()> {
        require!(campaign_name.len() <= 32, PulseError::NameTooLong);
        require!(reward_per_interview > 0, PulseError::ZeroRewardAmount);

        let campaign = &mut ctx.accounts.campaign;
        campaign.founder = ctx.accounts.founder.key();
        campaign.reward_mint = ctx.accounts.reward_mint.key();
        campaign.vault = ctx.accounts.vault.key();
        campaign.reward_per_interview = reward_per_interview;
        campaign.target_interviews = TARGET_INTERVIEWS;
        campaign.completed_interviews = 0;
        campaign.name = campaign_name;
        campaign.bump = ctx.bumps.campaign;
        campaign.vault_bump = ctx.bumps.vault;
        campaign.created_at = Clock::get()?.unix_timestamp;

        // Total deposit required = 5 * reward_per_interview
        let total_deposit = reward_per_interview
            .checked_mul(TARGET_INTERVIEWS as u64)
            .ok_or(PulseError::MathOverflow)?;

        // Transfer funds from founder token account into protocol vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.founder_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.founder.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, total_deposit)?;

        emit!(CampaignCreatedEvent {
            campaign: campaign.key(),
            founder: campaign.founder,
            reward_per_interview,
            target_interviews: TARGET_INTERVIEWS,
            timestamp: campaign.created_at,
        });

        Ok(())
    }

    /// An interviewee reserves a target slot (1 to 5)
    pub fn reserve_interview_slot(
        ctx: Context<ReserveInterviewSlot>,
        slot_index: u8,
    ) -> Result<()> {
        require!(slot_index >= 1 && slot_index <= TARGET_INTERVIEWS, PulseError::InvalidSlotIndex);

        let interview = &mut ctx.accounts.interview_record;
        require!(interview.status == InterviewStatus::Uninitialized, PulseError::SlotAlreadyClaimed);

        interview.campaign = ctx.accounts.campaign.key();
        interview.interviewee = ctx.accounts.interviewee.key();
        interview.slot_index = slot_index;
        interview.status = InterviewStatus::Reserved;
        interview.reserved_at = Clock::get()?.unix_timestamp;
        interview.bump = ctx.bumps.interview_record;

        emit!(SlotReservedEvent {
            campaign: ctx.accounts.campaign.key(),
            interviewee: interview.interviewee,
            slot_index,
            reserved_at: interview.reserved_at,
        });

        Ok(())
    }

    /// Verifies completion of the interview. Both Founder and Interviewee co-sign,
    /// committing the SHA-256 hash of the sanitized transcript. Payout is atomically settled.
    pub fn submit_and_verify_interview(
        ctx: Context<SubmitAndVerifyInterview>,
        transcript_hash: [u8; 32],
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let interview = &mut ctx.accounts.interview_record;

        require!(interview.status == InterviewStatus::Reserved, PulseError::InvalidInterviewState);
        require!(interview.interviewee == ctx.accounts.interviewee.key(), PulseError::IntervieweeMismatch);
        require!(campaign.founder == ctx.accounts.founder.key(), PulseError::FounderMismatch);

        interview.transcript_hash = transcript_hash;
        interview.status = InterviewStatus::Verified;
        interview.completed_at = Clock::get()?.unix_timestamp;

        // Increment campaign counter
        campaign.completed_interviews = campaign
            .completed_interviews
            .checked_add(1)
            .ok_or(PulseError::MathOverflow)?;

        // Execute CPI transfer from Vault PDA to Interviewee Token Account
        let campaign_key = campaign.key();
        let seeds = &[
            VAULT_SEED,
            campaign_key.as_ref(),
            &[campaign.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.interviewee_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, campaign.reward_per_interview)?;

        emit!(InterviewVerifiedEvent {
            campaign: campaign.key(),
            interviewee: interview.interviewee,
            slot_index: interview.slot_index,
            transcript_hash,
            completed_at: interview.completed_at,
        });

        if campaign.completed_interviews == TARGET_INTERVIEWS {
            emit!(FiveUsersMilestoneAchievedEvent {
                campaign: campaign.key(),
                founder: campaign.founder,
                completed_at: interview.completed_at,
            });
        }

        Ok(())
    }

    /// Reclaims unreserved or abandoned funds if a campaign expires (90 days timeout).
    pub fn reclaim_expired_funds(ctx: Context<ReclaimExpiredFunds>) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        let now = Clock::get()?.unix_timestamp;
        let ninety_days = 90 * 24 * 60 * 60;

        require!(now >= campaign.created_at + ninety_days, PulseError::CampaignNotExpired);

        let remaining_tokens = ctx.accounts.vault.amount;
        require!(remaining_tokens > 0, PulseError::NoTokensRemaining);

        let campaign_key = campaign.key();
        let seeds = &[
            VAULT_SEED,
            campaign_key.as_ref(),
            &[campaign.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.founder_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, remaining_tokens)?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Account Structures
// ---------------------------------------------------------------------------

#[account]
pub struct Campaign {
    pub founder: Pubkey,
    pub reward_mint: Pubkey,
    pub vault: Pubkey,
    pub reward_per_interview: u64,
    pub target_interviews: u8,
    pub completed_interviews: u8,
    pub name: String,
    pub bump: u8,
    pub vault_bump: u8,
    pub created_at: i64,
}

impl Campaign {
    pub const SPACE: usize = 8   // discriminator
        + 32                    // founder
        + 32                    // reward_mint
        + 32                    // vault
        + 8                     // reward_per_interview
        + 1                     // target_interviews
        + 1                     // completed_interviews
        + (4 + 32)              // name string
        + 1                     // bump
        + 1                     // vault_bump
        + 8;                    // created_at
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum InterviewStatus {
    Uninitialized,
    Reserved,
    Verified,
    Cancelled,
}

#[account]
pub struct InterviewRecord {
    pub campaign: Pubkey,
    pub interviewee: Pubkey,
    pub slot_index: u8,
    pub status: InterviewStatus,
    pub transcript_hash: [u8; 32],
    pub reserved_at: i64,
    pub completed_at: i64,
    pub bump: u8,
}

impl InterviewRecord {
    pub const SPACE: usize = 8   // discriminator
        + 32                    // campaign
        + 32                    // interviewee
        + 1                     // slot_index
        + 1                     // status
        + 32                    // transcript_hash
        + 8                     // reserved_at
        + 8                     // completed_at
        + 1;                    // bump
}

// ---------------------------------------------------------------------------
// Instruction Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(campaign_name: String)]
pub struct InitializeCampaign<'info> {
    #[account(
        init,
        payer = founder,
        space = Campaign::SPACE,
        seeds = [CAMPAIGN_SEED, founder.key().as_ref(), campaign_name.as_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    pub reward_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = founder,
        seeds = [VAULT_SEED, campaign.key().as_ref()],
        bump,
        token::mint = reward_mint,
        token::authority = vault
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = founder_token_account.mint == reward_mint.key(),
        constraint = founder_token_account.owner == founder.key()
    )]
    pub founder_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub founder: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(slot_index: u8)]
pub struct ReserveInterviewSlot<'info> {
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init,
        payer = interviewee,
        space = InterviewRecord::SPACE,
        seeds = [INTERVIEW_SEED, campaign.key().as_ref(), &[slot_index]],
        bump
    )]
    pub interview_record: Account<'info, InterviewRecord>,

    #[account(mut)]
    pub interviewee: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitAndVerifyInterview<'info> {
    #[account(
        mut,
        has_one = founder @ PulseError::FounderMismatch,
        has_one = vault @ PulseError::VaultMismatch
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [INTERVIEW_SEED, campaign.key().as_ref(), &[interview_record.slot_index]],
        bump = interview_record.bump,
        has_one = campaign @ PulseError::CampaignMismatch
    )]
    pub interview_record: Account<'info, InterviewRecord>,

    #[account(
        mut,
        seeds = [VAULT_SEED, campaign.key().as_ref()],
        bump = campaign.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = interviewee_token_account.mint == campaign.reward_mint @ PulseError::MintMismatch,
        constraint = interviewee_token_account.owner == interview_record.interviewee @ PulseError::IntervieweeMismatch
    )]
    pub interviewee_token_account: Account<'info, TokenAccount>,

    pub founder: Signer<'info>,
    pub interviewee: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReclaimExpiredFunds<'info> {
    #[account(
        mut,
        has_one = founder @ PulseError::FounderMismatch,
        has_one = vault @ PulseError::VaultMismatch
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [VAULT_SEED, campaign.key().as_ref()],
        bump = campaign.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = founder_token_account.mint == campaign.reward_mint,
        constraint = founder_token_account.owner == founder.key()
    )]
    pub founder_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub founder: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------------------
// Events & Errors
// ---------------------------------------------------------------------------

#[event]
pub struct CampaignCreatedEvent {
    pub campaign: Pubkey,
    pub founder: Pubkey,
    pub reward_per_interview: u64,
    pub target_interviews: u8,
    pub timestamp: i64,
}

#[event]
pub struct SlotReservedEvent {
    pub campaign: Pubkey,
    pub interviewee: Pubkey,
    pub slot_index: u8,
    pub reserved_at: i64,
}

#[event]
pub struct InterviewVerifiedEvent {
    pub campaign: Pubkey,
    pub interviewee: Pubkey,
    pub slot_index: u8,
    pub transcript_hash: [u8; 32],
    pub completed_at: i64,
}

#[event]
pub struct FiveUsersMilestoneAchievedEvent {
    pub campaign: Pubkey,
    pub founder: Pubkey,
    pub completed_at: i64,
}

#[error_code]
pub enum PulseError {
    #[msg("Campaign name exceeds maximum length of 32 characters")]
    NameTooLong,
    #[msg("Reward amount per interview must be greater than zero")]
    ZeroRewardAmount,
    #[msg("Invalid slot index. Must be between 1 and 5")]
    InvalidSlotIndex,
    #[msg("Slot has already been reserved or claimed")]
    SlotAlreadyClaimed,
    #[msg("Interview record is not in a valid reserved state")]
    InvalidInterviewState,
    #[msg("Interviewee signer does not match interview record")]
    IntervieweeMismatch,
    #[msg("Founder signer does not match campaign record")]
    FounderMismatch,
    #[msg("Vault does not match campaign vault")]
    VaultMismatch,
    #[msg("Campaign does not match interview campaign reference")]
    CampaignMismatch,
    #[msg("Token account mint mismatch")]
    MintMismatch,
    #[msg("Campaign has not reached 90 days expiration")]
    CampaignNotExpired,
    #[msg("No tokens remaining in vault to reclaim")]
    NoTokensRemaining,
    #[msg("Mathematical overflow occurred")]
    MathOverflow,
}