use anchor_lang::prelude::*;

declare_id!("FndrSupp111111111111111111111111111111111111");

#[program]
pub mod founder_support {
    use super::*;

    /// Initializes a founder discovery campaign targeting 5 verified user interviews.
    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        project_name: String,
        target_interviews: u8,
    ) -> Result<()> {
        require!(
            project_name.len() <= 64,
            FounderSupportError::ProjectNameTooLong
        );
        require!(
            target_interviews > 0 && target_interviews <= 20,
            FounderSupportError::InvalidTargetCount
        );

        let campaign = &mut ctx.accounts.campaign;
        campaign.founder = ctx.accounts.founder.key();
        campaign.project_name = project_name;
        campaign.target_interviews = target_interviews;
        campaign.completed_interviews = 0;
        campaign.bump = ctx.bumps.campaign;
        campaign.created_at = Clock::get()?.unix_timestamp;

        emit!(CampaignInitializedEvent {
            founder: campaign.founder,
            project_name: campaign.project_name.clone(),
            target_interviews,
            timestamp: campaign.created_at,
        });

        Ok(())
    }

    /// Records an immutable customer interview attestation verified by the user's wallet.
    pub fn record_interview(
        ctx: Context<RecordInterview>,
        interview_index: u8,
        transcript_hash: [u8; 32],
        nps_score: u8,
        willing_to_pay_lamports: u64,
        pain_point_category: u8,
    ) -> Result<()> {
        require!(
            nps_score <= 10,
            FounderSupportError::InvalidNpsScore
        );
        require!(
            interview_index == ctx.accounts.campaign.completed_interviews,
            FounderSupportError::SequenceOutOfOrder
        );
        require!(
            ctx.accounts.campaign.completed_interviews < ctx.accounts.campaign.target_interviews,
            FounderSupportError::CampaignTargetExceeded
        );

        let attestation = &mut ctx.accounts.interview_attestation;
        attestation.campaign = ctx.accounts.campaign.key();
        attestation.founder = ctx.accounts.founder.key();
        attestation.user_wallet = ctx.accounts.user_wallet.key();
        attestation.interview_index = interview_index;
        attestation.transcript_hash = transcript_hash;
        attestation.nps_score = nps_score;
        attestation.willing_to_pay_lamports = willing_to_pay_lamports;
        attestation.pain_point_category = pain_point_category;
        attestation.timestamp = Clock::get()?.unix_timestamp;
        attestation.bump = ctx.bumps.interview_attestation;

        let campaign = &mut ctx.accounts.campaign;
        campaign.completed_interviews = campaign
            .completed_interviews
            .checked_add(1)
            .ok_or(FounderSupportError::ArithmeticOverflow)?;

        emit!(InterviewRecordedEvent {
            campaign: campaign.key(),
            founder: campaign.founder,
            user_wallet: attestation.user_wallet,
            interview_index,
            transcript_hash,
            nps_score,
            timestamp: attestation.timestamp,
        });

        if campaign.completed_interviews == campaign.target_interviews {
            emit!(CampaignCompletedEvent {
                campaign: campaign.key(),
                founder: campaign.founder,
                total_interviews: campaign.completed_interviews,
                completed_at: attestation.timestamp,
            });
        }

        Ok(())
    }

    /// Closes an attestation account and refunds lamports to the founder when decommissioning.
    pub fn close_attestation(
        _ctx: Context<CloseAttestation>,
        _interview_index: u8,
    ) -> Result<()> {
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION STRUCTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(project_name: String)]
pub struct InitializeCampaign<'info> {
    #[account(
        init,
        payer = founder,
        space = Campaign::LEN,
        seeds = [b"campaign", founder.key().as_ref(), project_name.as_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(mut)]
    pub founder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(interview_index: u8)]
pub struct RecordInterview<'info> {
    #[account(
        mut,
        seeds = [b"campaign", founder.key().as_ref(), campaign.project_name.as_bytes()],
        bump = campaign.bump,
        has_one = founder @ FounderSupportError::UnauthorizedFounder
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init,
        payer = founder,
        space = InterviewAttestation::LEN,
        seeds = [
            b"interview",
            campaign.key().as_ref(),
            &[interview_index]
        ],
        bump
    )]
    pub interview_attestation: Account<'info, InterviewAttestation>,

    #[account(mut)]
    pub founder: Signer<'info>,

    /// The ecosystem user being interviewed. Must co-sign to attest to the interview validity.
    pub user_wallet: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(interview_index: u8)]
pub struct CloseAttestation<'info> {
    #[account(
        seeds = [b"campaign", founder.key().as_ref(), campaign.project_name.as_bytes()],
        bump = campaign.bump,
        has_one = founder @ FounderSupportError::UnauthorizedFounder
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        close = founder,
        seeds = [
            b"interview",
            campaign.key().as_ref(),
            &[interview_index]
        ],
        bump = interview_attestation.bump,
        has_one = campaign,
        has_one = founder
    )]
    pub interview_attestation: Account<'info, InterviewAttestation>,

    #[account(mut)]
    pub founder: Signer<'info>,
}

// -----------------------------------------------------------------------------
// STATE STRUCTS
// -----------------------------------------------------------------------------

#[account]
pub struct Campaign {
    pub founder: Pubkey,            // 32
    pub project_name: String,       // 4 + 64 = 68
    pub target_interviews: u8,      // 1
    pub completed_interviews: u8,   // 1
    pub bump: u8,                   // 1
    pub created_at: i64,            // 8
}

impl Campaign {
    pub const LEN: usize = 8 + 32 + 68 + 1 + 1 + 1 + 8 + 64; // Account discriminator + padding
}

#[account]
pub struct InterviewAttestation {
    pub campaign: Pubkey,               // 32
    pub founder: Pubkey,                // 32
    pub user_wallet: Pubkey,            // 32
    pub interview_index: u8,            // 1
    pub transcript_hash: [u8; 32],      // 32
    pub nps_score: u8,                  // 1
    pub willing_to_pay_lamports: u64,   // 8
    pub pain_point_category: u8,        // 1 (0: UX/Wallet, 1: High Fees, 2: Performance, 3: Tooling, 4: Other)
    pub timestamp: i64,                 // 8
    pub bump: u8,                       // 1
}

impl InterviewAttestation {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 1 + 32 + 1 + 8 + 1 + 8 + 1 + 32; // Discriminator + padding
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct CampaignInitializedEvent {
    pub founder: Pubkey,
    pub project_name: String,
    pub target_interviews: u8,
    pub timestamp: i64,
}

#[event]
pub struct InterviewRecordedEvent {
    pub campaign: Pubkey,
    pub founder: Pubkey,
    pub user_wallet: Pubkey,
    pub interview_index: u8,
    pub transcript_hash: [u8; 32],
    pub nps_score: u8,
    pub timestamp: i64,
}

#[event]
pub struct CampaignCompletedEvent {
    pub campaign: Pubkey,
    pub founder: Pubkey,
    pub total_interviews: u8,
    pub completed_at: i64,
}

#[error_code]
pub enum FounderSupportError {
    #[msg("Project name exceeds maximum length of 64 characters.")]
    ProjectNameTooLong,
    #[msg("Target interviews must be between 1 and 20.")]
    InvalidTargetCount,
    #[msg("NPS score must be between 0 and 10.")]
    InvalidNpsScore,
    #[msg("Interview sequence out of order.")]
    SequenceOutOfOrder,
    #[msg("Campaign target interviews already completed.")]
    CampaignTargetExceeded,
    #[msg("Signer is not authorized founder for this campaign.")]
    UnauthorizedFounder,
    #[msg("Arithmetic overflow occurred.")]
    ArithmeticOverflow,
}