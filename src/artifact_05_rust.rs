use anchor_lang::prelude::*;

declare_id!("Colo5UsersSupport1111111111111111111111111111");

pub const MAX_SLUG_LEN: usize = 32;
pub const MAX_FEEDBACK_HASH_LEN: usize = 64;
pub const REQUIRED_INTERVIEW_COUNT: u8 = 5;

#[program]
pub mod colosseum_founder_support {
    use super::*;

    /// Initializes a new customer discovery campaign for a founder.
    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        slug: String,
        project_name: String,
        target_persona: String,
    ) -> Result<()> {
        require!(
            slug.as_bytes().len() > 0 && slug.as_bytes().len() <= MAX_SLUG_LEN,
            FounderSupportError::InvalidSlugLength
        );
        require!(
            project_name.as_bytes().len() > 0 && project_name.as_bytes().len() <= 64,
            FounderSupportError::StringTooLong
        );
        require!(
            target_persona.as_bytes().len() > 0 && target_persona.as_bytes().len() <= 64,
            FounderSupportError::StringTooLong
        );

        let campaign = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;

        campaign.founder = ctx.accounts.founder.key();
        campaign.slug = slug;
        campaign.project_name = project_name;
        campaign.target_persona = target_persona;
        campaign.interviews_completed = 0;
        campaign.target_goal = REQUIRED_INTERVIEW_COUNT;
        campaign.is_milestone_completed = false;
        campaign.created_at = clock.unix_timestamp;
        campaign.updated_at = clock.unix_timestamp;
        campaign.bump = ctx.bumps.campaign;

        emit!(CampaignInitializedEvent {
            founder: campaign.founder,
            slug: campaign.slug.clone(),
            created_at: campaign.created_at,
        });

        Ok(())
    }

    /// Records an interview session with a verified Solana user.
    pub fn record_user_interview(
        ctx: Context<RecordUserInterview>,
        interview_index: u8,
        interviewee: Pubkey,
        feedback_digest: [u8; 32],
        nps_score: u8,
        friction_severity: u8,
        willingness_to_pay_lamports: u64,
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let clock = Clock::get()?;

        require!(
            !campaign.is_milestone_completed,
            FounderSupportError::MilestoneAlreadyCompleted
        );
        require!(
            interview_index == campaign.interviews_completed + 1,
            FounderSupportError::InvalidInterviewSequence
        );
        require!(
            interview_index <= campaign.target_goal,
            FounderSupportError::InterviewLimitExceeded
        );
        require!(nps_score <= 10, FounderSupportError::InvalidNpsScore);
        require!(
            friction_severity >= 1 && friction_severity <= 5,
            FounderSupportError::InvalidFrictionScore
        );
        require!(
            interviewee != campaign.founder,
            FounderSupportError::SelfInterviewForbidden
        );

        let receipt = &mut ctx.accounts.interview_receipt;
        receipt.campaign = campaign.key();
        receipt.index = interview_index;
        receipt.interviewee = interviewee;
        receipt.feedback_digest = feedback_digest;
        receipt.nps_score = nps_score;
        receipt.friction_severity = friction_severity;
        receipt.willingness_to_pay_lamports = willingness_to_pay_lamports;
        receipt.timestamp = clock.unix_timestamp;
        receipt.bump = ctx.bumps.interview_receipt;

        campaign.interviews_completed += 1;
        campaign.updated_at = clock.unix_timestamp;

        emit!(InterviewLoggedEvent {
            campaign: campaign.key(),
            founder: campaign.founder,
            interview_index,
            interviewee,
            nps_score,
            friction_severity,
            timestamp: receipt.timestamp,
        });

        // Automatically complete milestone once 5 interviews are reached
        if campaign.interviews_completed == campaign.target_goal {
            campaign.is_milestone_completed = true;
            emit!(MilestoneCompletedEvent {
                campaign: campaign.key(),
                founder: campaign.founder,
                total_interviews: campaign.interviews_completed,
                completed_at: clock.unix_timestamp,
            });
        }

        Ok(())
    }

    /// Explicitly notarizes/closes the milestone and derives the verified certificate state.
    pub fn notarize_milestone_certificate(
        ctx: Context<NotarizeMilestoneCertificate>,
        executive_summary_hash: [u8; 32],
    ) -> Result<()> {
        let campaign = &ctx.accounts.campaign;
        require!(
            campaign.is_milestone_completed,
            FounderSupportError::MilestoneNotYetReached
        );

        let cert = &mut ctx.accounts.milestone_certificate;
        let clock = Clock::get()?;

        cert.campaign = campaign.key();
        cert.founder = campaign.founder;
        cert.executive_summary_hash = executive_summary_hash;
        cert.certified_at = clock.unix_timestamp;
        cert.total_interviews_verified = campaign.interviews_completed;
        cert.bump = ctx.bumps.milestone_certificate;

        emit!(CertificateIssuedEvent {
            campaign: campaign.key(),
            founder: campaign.founder,
            executive_summary_hash,
            certified_at: cert.certified_at,
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(slug: String)]
pub struct InitializeCampaign<'info> {
    #[account(
        init,
        payer = founder,
        space = 8 + CampaignState::INIT_SPACE,
        seeds = [b"campaign", founder.key().as_ref(), slug.as_bytes()],
        bump
    )]
    pub campaign: Account<'info, CampaignState>,

    #[account(mut)]
    pub founder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(interview_index: u8)]
pub struct RecordUserInterview<'info> {
    #[account(
        mut,
        has_one = founder @ FounderSupportError::UnauthorizedFounder,
    )]
    pub campaign: Account<'info, CampaignState>,

    #[account(
        init,
        payer = founder,
        space = 8 + InterviewReceipt::INIT_SPACE,
        seeds = [
            b"interview",
            campaign.key().as_ref(),
            &[interview_index]
        ],
        bump
    )]
    pub interview_receipt: Account<'info, InterviewReceipt>,

    #[account(mut)]
    pub founder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct NotarizeMilestoneCertificate<'info> {
    #[account(
        has_one = founder @ FounderSupportError::UnauthorizedFounder,
    )]
    pub campaign: Account<'info, CampaignState>,

    #[account(
        init,
        payer = founder,
        space = 8 + MilestoneCertificate::INIT_SPACE,
        seeds = [b"certificate", campaign.key().as_ref()],
        bump
    )]
    pub milestone_certificate: Account<'info, MilestoneCertificate>,

    #[account(mut)]
    pub founder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// -----------------------------------------------------------------------------
// DATA STRUCTURES
// -----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct CampaignState {
    pub founder: Pubkey,
    #[max_len(32)]
    pub slug: String,
    #[max_len(64)]
    pub project_name: String,
    #[max_len(64)]
    pub target_persona: String,
    pub interviews_completed: u8,
    pub target_goal: u8,
    pub is_milestone_completed: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct InterviewReceipt {
    pub campaign: Pubkey,
    pub index: u8,
    pub interviewee: Pubkey,
    pub feedback_digest: [u8; 32],
    pub nps_score: u8,
    pub friction_severity: u8,
    pub willingness_to_pay_lamports: u64,
    pub timestamp: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MilestoneCertificate {
    pub campaign: Pubkey,
    pub founder: Pubkey,
    pub executive_summary_hash: [u8; 32],
    pub certified_at: i64,
    pub total_interviews_verified: u8,
    pub bump: u8,
}

// -----------------------------------------------------------------------------
// EVENTS
// -----------------------------------------------------------------------------

#[event]
pub struct CampaignInitializedEvent {
    pub founder: Pubkey,
    pub slug: String,
    pub created_at: i64,
}

#[event]
pub struct InterviewLoggedEvent {
    pub campaign: Pubkey,
    pub founder: Pubkey,
    pub interview_index: u8,
    pub interviewee: Pubkey,
    pub nps_score: u8,
    pub friction_severity: u8,
    pub timestamp: i64,
}

#[event]
pub struct MilestoneCompletedEvent {
    pub campaign: Pubkey,
    pub founder: Pubkey,
    pub total_interviews: u8,
    pub completed_at: i64,
}

#[event]
pub struct CertificateIssuedEvent {
    pub campaign: Pubkey,
    pub founder: Pubkey,
    pub executive_summary_hash: [u8; 32],
    pub certified_at: i64,
}

// -----------------------------------------------------------------------------
// ERROR CODES
// -----------------------------------------------------------------------------

#[error_code]
pub enum FounderSupportError {
    #[msg("Campaign slug must be between 1 and 32 characters.")]
    InvalidSlugLength,
    #[msg("Provided text string exceeds the allowed length.")]
    StringTooLong,
    #[msg("Milestone has already been fulfilled.")]
    MilestoneAlreadyCompleted,
    #[msg("Invalid interview sequence. Interviews must be submitted sequentially.")]
    InvalidInterviewSequence,
    #[msg("Target interview quota exceeded for this campaign.")]
    InterviewLimitExceeded,
    #[msg("NPS score must be between 0 and 10.")]
    InvalidNpsScore,
    #[msg("Friction score must be between 1 (minor) and 5 (critical blocker).")]
    InvalidFrictionScore,
    #[msg("Founder cannot conduct an interview with their own address.")]
    SelfInterviewForbidden,
    #[msg("The signer is not authorized to modify this founder campaign.")]
    UnauthorizedFounder,
    #[msg("Cannot issue certificate before 5 verified interviews are completed.")]
    MilestoneNotYetReached,
}