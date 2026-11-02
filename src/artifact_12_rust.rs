use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("Loop5X1111111111111111111111111111111111111");

#[program]
pub mod userloop {
    use super::*;

    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        campaign_id: u64,
        reward_per_user: u64,
        target_users: u32,
        metadata_uri: String,
    ) -> Result<()> {
        instructions::initialize_campaign::handler(ctx, campaign_id, reward_per_user, target_users, metadata_uri)
    }

    pub fn book_session(
        ctx: Context<BookSession>,
        session_id: [u8; 16],
        scheduled_timestamp: i64,
    ) -> Result<()> {
        instructions::book_session::handler(ctx, session_id, scheduled_timestamp)
    }

    pub fn attest_and_settle(
        ctx: Context<AttestAndSettle>,
        feedback_digest: [u8; 32],
    ) -> Result<()> {
        instructions::attest_and_settle::handler(ctx, feedback_digest)
    }

    pub fn close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
        instructions::close_campaign::handler(ctx)
    }
}