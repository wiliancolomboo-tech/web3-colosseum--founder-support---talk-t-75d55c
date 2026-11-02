use anchor_lang::prelude::*;

pub const CAMPAIGN_SEED: &[u8] = b"campaign";
pub const SESSION_SEED: &[u8] = b"session";
pub const VAULT_SEED: &[u8] = b"vault";

#[account]
pub struct Campaign {
    pub founder: Pubkey,          // 32
    pub reward_mint: Pubkey,      // 32
    pub vault: Pubkey,            // 32
    pub reward_per_user: u64,     // 8
    pub target_users: u32,        // 4
    pub completed_users: u32,     // 4
    pub bump: u8,                 // 1
    pub vault_bump: u8,           // 1
    pub metadata_uri: String,     // 4 + 128 max
}

impl Campaign {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 4 + 4 + 1 + 1 + (4 + 128);
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Booked,
    Completed,
    Refunded,
}

#[account]
pub struct InterviewSession {
    pub campaign: Pubkey,         // 32
    pub participant: Pubkey,      // 32
    pub session_id: [u8; 16],     // 16 (UUID v4 / unique external ID)
    pub scheduled_timestamp: i64, // 8
    pub status: SessionStatus,    // 1
    pub feedback_digest: [u8; 32],// 32 (SHA256 of verified transcript/feedback)
    pub bump: u8,                 // 1
}

impl InterviewSession {
    pub const LEN: usize = 8 + 32 + 32 + 16 + 8 + 1 + 32 + 1;
}

#[account]
pub struct MilestoneProof {
    pub campaign: Pubkey,         // 32
    pub founder: Pubkey,          // 32
    pub achieved_at: i64,         // 8
    pub total_verified_users: u32,// 4
    pub bump: u8,                 // 1
}

impl MilestoneProof {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 4 + 1;
}