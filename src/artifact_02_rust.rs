use anchor_lang::prelude::*;

declare_id!("FndrSupp11111111111111111111111111111111111");

pub const TARGET_INTERVIEW_COUNT: u8 = 5;
pub const MAX_CATEGORY_LEN: usize = 32;

#[program]
pub mod founder_support {
    use super::*;

    /// Initializes a new Founder Support Discovery Campaign.
    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        project_name: String,
    ) -> Result<()> {
        require!(project_name.len() <= 64, FounderSupportError::ProjectNameTooLong);
        require!(!project_name.is_empty(), FounderSupportError::EmptyProjectName);

        let campaign = &mut ctx.accounts.campaign;
        campaign.founder = ctx.accounts.founder.key();
        campaign.project_name = project_name;
        campaign.interview_count = 0;
        campaign.target_count = TARGET_INTERVIEW_COUNT;
        campaign.is_completed = false;
        campaign.bump = ctx.bumps.campaign;
        campaign.created_at = Clock::get()?.unix_timestamp;

        emit!(CampaignInitializedEvent {
            founder: campaign.founder,
            project_name: campaign.project_name.clone(),
            created_at: campaign.created_at,
        });

        Ok(())
    }

    /// Records a verified user interview attestation.
    pub fn record_interview(
        ctx: Context<RecordInterview>,
        interviewee: Pubkey,
        nps_score: u8,
        sentiment_score: i8,
        problem_category: String,
        transcript_hash: [u8; 32],
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;

        require!(!campaign.is_completed, FounderSupportError::CampaignAlreadyCompleted);
        require!(campaign.interview_count < campaign.target_count, FounderSupportError::TargetCountReached);
        require!(nps_score <= 10, FounderSupportError::InvalidNpsScore);
        require!(
            sentiment_score >= -100 && sentiment_score <= 100,
            FounderSupportError::InvalidSentimentScore
        );
        require!(
            problem_category.len() <= MAX_CATEGORY_LEN,
            FounderSupportError::CategoryTooLong
        );
        require!(interviewee != campaign.founder, FounderSupportError::CannotInterviewSelf);

        let interview_index = campaign.interview_count;
        let attestation = &mut ctx.accounts.interview_attestation;
        let current_time = Clock::get()?.unix_timestamp;

        attestation.campaign = campaign.key();
        attestation.index = interview_index;
        attestation.interviewee = interviewee;
        attestation.nps_score = nps_score;
        attestation.sentiment_score = sentiment_score;
        attestation.problem_category = problem_category.clone();
        attestation.transcript_hash = transcript_hash;
        attestation.recorded_at = current_time;
        attestation.bump = ctx.bumps.interview_attestation;

        campaign.interview_count = campaign.interview_count.checked_add(1).unwrap();

        emit!(InterviewRecordedEvent {
            campaign: campaign.key(),
            index: interview_index,
            interviewee,
            nps_score,
            sentiment_score,
            problem_category,
            recorded_at: current_time,
        });

        if campaign.interview_count == campaign.target_count {
            campaign.is_completed = true;
            emit!(CampaignCompletedEvent {
                campaign: campaign.key(),
                founder: campaign.founder,
                total_interviews: campaign.interview_count,
                completed_at: current_time,
            });
        }

        Ok(())
    }

    /// Explicitly verify and close the campaign milestone.
    pub fn finalize_campaign(ctx: Context<FinalizeCampaign>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        require!(
            campaign.interview_count >= campaign.target_count,
            FounderSupportError::ThresholdNotMet
        );
        campaign.is_completed = true;
        Ok(())
    }
}

// ----------------------------------------------------------------------------
// Account Structs
// ----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(project_name: String)]
pub struct InitializeCampaign<'info> {
    #[account(
        init,
        payer = founder,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [b"campaign", founder.key().as_ref()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(mut)]
    pub founder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordInterview<'info> {
    #[account(
        mut,
        seeds = [b"campaign", founder.key().as_ref()],
        bump = campaign.bump,
        has_one = founder @ FounderSupportError::UnauthorizedFounder
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init,
        payer = founder,
        space = 8 + InterviewAttestation::INIT_SPACE,
        seeds = [
            b"interview",
            campaign.key().as_ref(),
            &campaign.interview_count.to_le_bytes()
        ],
        bump
    )]
    pub interview_attestation: Account<'info, InterviewAttestation>,

    #[account(mut)]
    pub founder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeCampaign<'info> {
    #[account(
        mut,
        seeds = [b"campaign", founder.key().as_ref()],
        bump = campaign.bump,
        has_one = founder @ FounderSupportError::UnauthorizedFounder
    )]
    pub campaign: Account<'info, Campaign>,

    pub founder: Signer<'info>,
}

// ----------------------------------------------------------------------------
// State Data Definitions
// ----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub founder: Pubkey,
    #[max_len(64)]
    pub project_name: String,
    pub interview_count: u8,
    pub target_count: u8,
    pub is_completed: bool,
    pub bump: u8,
    pub created_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct InterviewAttestation {
    pub campaign: Pubkey,
    pub index: u8,
    pub interviewee: Pubkey,
    pub nps_score: u8,
    pub sentiment_score: i8,
    #[max_len(32)]
    pub problem_category: String,
    pub transcript_hash: [u8; 32],
    pub recorded_at: i64,
    pub bump: u8,
}

// ----------------------------------------------------------------------------
// Events
// ----------------------------------------------------------------------------

#[event]
pub struct CampaignInitializedEvent {
    pub founder: Pubkey,
    pub project_name: String,
    pub created_at: i64,
}

#[event]
pub struct InterviewRecordedEvent {
    pub campaign: Pubkey,
    pub index: u8,
    pub interviewee: Pubkey,
    pub nps_score: u8,
    pub sentiment_score: i8,
    pub problem_category: String,
    pub recorded_at: i64,
}

#[event]
pub struct CampaignCompletedEvent {
    pub campaign: Pubkey,
    pub founder: Pubkey,
    pub total_interviews: u8,
    pub completed_at: i64,
}

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

#[error_code]
pub enum FounderSupportError {
    #[msg("Project name exceeds maximum length of 64 characters.")]
    ProjectNameTooLong,
    #[msg("Project name cannot be empty.")]
    EmptyProjectName,
    #[msg("Campaign is already finalized and completed.")]
    CampaignAlreadyCompleted,
    #[msg("Campaign has already recorded the target of 5 interviews.")]
    TargetCountReached,
    #[msg("NPS score must be between 0 and 10.")]
    InvalidNpsScore,
    #[msg("Sentiment score must be between -100 and +100.")]
    InvalidSentimentScore,
    #[msg("Problem category string exceeds 32 bytes.")]
    CategoryTooLong,
    #[msg("Founder cannot interview themselves.")]
    CannotInterviewSelf,
    #[msg("Threshold not met: Must complete at least 5 interviews.")]
    ThresholdNotMet,
    #[msg("Signer is not authorized to modify this campaign.")]
    UnauthorizedFounder,
}