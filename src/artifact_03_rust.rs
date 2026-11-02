use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("Loopx5v111111111111111111111111111111111111");

pub const MAX_INTERVIEWS_PER_CAMPAIGN: u8 = 5;
pub const DISCRIMINATOR_LENGTH: usize = 8;

#[program]
pub mod userloop {
    use super::*;

    /// Initializes a new Founder Customer Discovery Campaign (target: 5 users).
    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        project_name: String,
        interview_reward_lamports: u64,
    ) -> Result<()> {
        require!(project_name.len() <= 64, UserLoopError::ProjectNameTooLong);
        require!(interview_reward_lamports > 0, UserLoopError::ZeroRewardAmount);

        let campaign = &mut ctx.accounts.campaign;
        campaign.founder = ctx.accounts.founder.key();
        campaign.project_name = project_name;
        campaign.interview_reward_lamports = interview_reward_lamports;
        campaign.target_interviews = MAX_INTERVIEWS_PER_CAMPAIGN;
        campaign.completed_interviews = 0;
        campaign.is_fully_validated = false;
        campaign.bump = ctx.bumps.campaign;

        // Escrow total rewards: 5 * interview_reward_lamports
        let total_deposit = interview_reward_lamports
            .checked_mul(MAX_INTERVIEWS_PER_CAMPAIGN as u64)
            .ok_or(UserLoopError::MathOverflow)?;

        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.founder.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        transfer(cpi_context, total_deposit)?;

        emit!(CampaignInitialized {
            founder: campaign.founder,
            project_name: campaign.project_name.clone(),
            total_escrow: total_deposit,
        });

        Ok(())
    }

    /// User registers for one of the 5 interview slots.
    pub fn book_interview(
        ctx: Context<BookInterview>,
        slot_index: u8,
    ) -> Result<()> {
        require!(slot_index < MAX_INTERVIEWS_PER_CAMPAIGN, UserLoopError::InvalidSlotIndex);
        let campaign = &ctx.accounts.campaign;
        require!(!campaign.is_fully_validated, UserLoopError::CampaignAlreadyCompleted);

        let session = &mut ctx.accounts.session;
        require!(session.status == SessionStatus::Uninitialized, UserLoopError::SlotAlreadyOccupied);

        session.campaign = campaign.key();
        session.slot_index = slot_index;
        session.interviewee = ctx.accounts.interviewee.key();
        session.status = SessionStatus::Booked;
        session.transcript_hash = [0u8; 32];
        session.satisfaction_score = 0;
        session.bump = ctx.bumps.session;

        emit!(InterviewBooked {
            campaign: campaign.key(),
            slot_index,
            interviewee: session.interviewee,
        });

        Ok(())
    }

    /// Founder and backend attest interview completion, record transcript hash, and release escrow to user.
    pub fn complete_interview(
        ctx: Context<CompleteInterview>,
        transcript_hash: [u8; 32],
        satisfaction_score: u8,
    ) -> Result<()> {
        require!(satisfaction_score >= 1 && satisfaction_score <= 10, UserLoopError::InvalidScore);
        
        let session = &mut ctx.accounts.session;
        require!(session.status == SessionStatus::Booked, UserLoopError::InvalidSessionStatus);

        let campaign = &mut ctx.accounts.campaign;
        require!(campaign.founder == ctx.accounts.founder.key(), UserLoopError::UnauthorizedFounder);

        // Update session state
        session.transcript_hash = transcript_hash;
        session.satisfaction_score = satisfaction_score;
        session.status = SessionStatus::Completed;

        // Increment campaign counter
        campaign.completed_interviews = campaign
            .completed_interviews
            .checked_add(1)
            .ok_or(UserLoopError::MathOverflow)?;

        if campaign.completed_interviews == MAX_INTERVIEWS_PER_CAMPAIGN {
            campaign.is_fully_validated = true;
            emit!(ValidationMilestoneReached {
                campaign: campaign.key(),
                founder: campaign.founder,
            });
        }

        // Transfer escrowed reward from Vault PDA to Interviewee
        let founder_key = campaign.founder;
        let vault_bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[
            b"vault",
            founder_key.as_ref(),
            &[vault_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.interviewee.to_account_info(),
            },
            signer,
        );
        transfer(cpi_context, campaign.interview_reward_lamports)?;

        emit!(InterviewCompleted {
            campaign: campaign.key(),
            slot_index: session.slot_index,
            interviewee: session.interviewee,
            transcript_hash,
            satisfaction_score,
            reward_paid: campaign.interview_reward_lamports,
        });

        Ok(())
    }

    /// Emergency refund for founder if slots remain unbooked/abandoned after 14 days.
    pub fn emergency_refund(ctx: Context<EmergencyRefund>) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        require!(campaign.founder == ctx.accounts.founder.key(), UserLoopError::UnauthorizedFounder);
        
        let remaining_interviews = MAX_INTERVIEWS_PER_CAMPAIGN
            .checked_sub(campaign.completed_interviews)
            .ok_or(UserLoopError::MathOverflow)?;

        require!(remaining_interviews > 0, UserLoopError::NoRefundAvailable);

        let refund_amount = campaign.interview_reward_lamports
            .checked_mul(remaining_interviews as u64)
            .ok_or(UserLoopError::MathOverflow)?;

        let founder_key = campaign.founder;
        let vault_bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[
            b"vault",
            founder_key.as_ref(),
            &[vault_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.founder.to_account_info(),
            },
            signer,
        );
        transfer(cpi_context, refund_amount)?;

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(project_name: String, interview_reward_lamports: u64)]
pub struct InitializeCampaign<'info> {
    #[account(
        init,
        payer = founder,
        space = DISCRIMINATOR_LENGTH + CampaignAccount::LEN,
        seeds = [b"campaign", founder.key().as_ref()],
        bump
    )]
    pub campaign: Account<'info, CampaignAccount>,

    /// CHECK: PDA acting as reward escrow vault
    #[account(
        mut,
        seeds = [b"vault", founder.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub founder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(slot_index: u8)]
pub struct BookInterview<'info> {
    #[account(
        mut,
        seeds = [b"campaign", campaign.founder.as_ref()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, CampaignAccount>,

    #[account(
        init,
        payer = interviewee,
        space = DISCRIMINATOR_LENGTH + SessionAccount::LEN,
        seeds = [b"session", campaign.key().as_ref(), &[slot_index]],
        bump
    )]
    pub session: Account<'info, SessionAccount>,

    #[account(mut)]
    pub interviewee: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CompleteInterview<'info> {
    #[account(
        mut,
        seeds = [b"campaign", founder.key().as_ref()],
        bump = campaign.bump,
        has_one = founder
    )]
    pub campaign: Account<'info, CampaignAccount>,

    #[account(
        mut,
        seeds = [b"session", campaign.key().as_ref(), &[session.slot_index]],
        bump = session.bump
    )]
    pub session: Account<'info, SessionAccount>,

    /// CHECK: Validated against session.interviewee
    #[account(
        mut,
        address = session.interviewee @ UserLoopError::InvalidIntervieweeAddress
    )]
    pub interviewee: AccountInfo<'info>,

    /// CHECK: PDA Escrow Vault
    #[account(
        mut,
        seeds = [b"vault", founder.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    pub founder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyRefund<'info> {
    #[account(
        mut,
        seeds = [b"campaign", founder.key().as_ref()],
        bump = campaign.bump,
        has_one = founder
    )]
    pub campaign: Account<'info, CampaignAccount>,

    /// CHECK: PDA Escrow Vault
    #[account(
        mut,
        seeds = [b"vault", founder.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub founder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// -----------------------------------------------------------------------------
// STATE STRUCTS
// -----------------------------------------------------------------------------

#[account]
pub struct CampaignAccount {
    pub founder: Pubkey,               // 32
    pub project_name: String,           // 4 + 64 = 68
    pub interview_reward_lamports: u64, // 8
    pub target_interviews: u8,          // 1
    pub completed_interviews: u8,       // 1
    pub is_fully_validated: bool,       // 1
    pub bump: u8,                       // 1
}

impl CampaignAccount {
    pub const LEN: usize = 32 + 68 + 8 + 1 + 1 + 1 + 1 + 16;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Uninitialized,
    Booked,
    Completed,
    Disputed,
}

#[account]
pub struct SessionAccount {
    pub campaign: Pubkey,              // 32
    pub slot_index: u8,                // 1
    pub interviewee: Pubkey,           // 32
    pub status: SessionStatus,         // 1
    pub transcript_hash: [u8; 32],     // 32
    pub satisfaction_score: u8,        // 1
    pub bump: u8,                      // 1
}

impl SessionAccount {
    pub const LEN: usize = 32 + 1 + 32 + 1 + 32 + 1 + 1 + 8;
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct CampaignInitialized {
    pub founder: Pubkey,
    pub project_name: String,
    pub total_escrow: u64,
}

#[event]
pub struct InterviewBooked {
    pub campaign: Pubkey,
    pub slot_index: u8,
    pub interviewee: Pubkey,
}

#[event]
pub struct InterviewCompleted {
    pub campaign: Pubkey,
    pub slot_index: u8,
    pub interviewee: Pubkey,
    pub transcript_hash: [u8; 32],
    pub satisfaction_score: u8,
    pub reward_paid: u64,
}

#[event]
pub struct ValidationMilestoneReached {
    pub campaign: Pubkey,
    pub founder: Pubkey,
}

#[error_code]
pub enum UserLoopError {
    #[msg("Project name exceeds maximum length of 64 characters.")]
    ProjectNameTooLong,
    #[msg("Interview reward lamports must be greater than zero.")]
    ZeroRewardAmount,
    #[msg("Numeric overflow during arithmetic calculation.")]
    MathOverflow,
    #[msg("Slot index exceeds 0-4 allowance.")]
    InvalidSlotIndex,
    #[msg("Campaign has already completed all 5 required discovery interviews.")]
    CampaignAlreadyCompleted,
    #[msg("Selected interview slot is already occupied.")]
    SlotAlreadyOccupied,
    #[msg("Interview session is not in Booked state.")]
    InvalidSessionStatus,
    #[msg("Signer is not authorized founder.")]
    UnauthorizedFounder,
    #[msg("Interviewee account does not match booked participant.")]
    InvalidIntervieweeAddress,
    #[msg("Satisfaction score must be between 1 and 10.")]
    InvalidScore,
    #[msg("All slots have been completed; no refund balance.")]
    NoRefundAvailable,
}