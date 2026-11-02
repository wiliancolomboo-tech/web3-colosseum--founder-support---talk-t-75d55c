use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(session_id: [u8; 16])]
pub struct BookSession<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,

    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init,
        payer = participant,
        space = InterviewSession::LEN,
        seeds = [SESSION_SEED, campaign.key().as_ref(), session_id.as_ref()],
        bump
    )]
    pub session: Account<'info, InterviewSession>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<BookSession>,
    session_id: [u8; 16],
    scheduled_timestamp: i64,
) -> Result<()> {
    let session = &mut ctx.accounts.session;
    session.campaign = ctx.accounts.campaign.key();
    session.participant = ctx.accounts.participant.key();
    session.session_id = session_id;
    session.scheduled_timestamp = scheduled_timestamp;
    session.status = SessionStatus::Booked;
    session.feedback_digest = [0u8; 32];
    session.bump = ctx.bumps.session;

    msg!("Interview Session Registered. ID: {:?}, Participant: {}", session_id, ctx.accounts.participant.key());
    Ok(())
}