use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::UserLoopError;

#[derive(Accounts)]
pub struct CloseCampaign<'info> {
    #[account(mut)]
    pub founder: Signer<'info>,

    #[account(
        mut,
        has_one = founder @ UserLoopError::UnauthorizedFounder,
        has_one = vault,
        close = founder
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
        constraint = founder_token_account.owner == founder.key(),
        constraint = founder_token_account.mint == campaign.reward_mint,
    )]
    pub founder_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CloseCampaign>) -> Result<()> {
    let campaign = &ctx.accounts.campaign;
    let remaining_amount = ctx.accounts.vault.amount;

    let campaign_key = campaign.key();
    let seeds = &[
        VAULT_SEED,
        campaign_key.as_ref(),
        &[campaign.vault_bump],
    ];
    let signer = &[&seeds[..]];

    if remaining_amount > 0 {
        let cpi_transfer = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.founder_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_transfer,
            signer,
        );
        token::transfer(cpi_transfer_ctx, remaining_amount)?;
    }

    let cpi_close = CloseAccount {
        account: ctx.accounts.vault.to_account_info(),
        destination: ctx.accounts.founder.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };
    let cpi_close_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_close,
        signer,
    );
    token::close_account(cpi_close_ctx)?;

    msg!("Campaign closed successfully. Remaining escrow refunded to founder.");
    Ok(())
}