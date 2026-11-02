import { Resend } from 'resend';

export class EnterpriseNotifier {
  constructor(slackWebhookUrl, resendApiKey) {
    this.slackWebhookUrl = slackWebhookUrl;
    this.resend = resendApiKey ? new Resend(resendApiKey) : null;
  }

  async notifySlackMilestone(founderPubkey, track, interviewCount, explorerUrl) {
    if (!this.slackWebhookUrl) {
      console.warn('[Integrations] No SLACK_WEBHOOK_URL set. Skipping Slack notification.');
      return;
    }

    const payload = {
      text: `🚀 *Colosseum Founder Support Milestone Unlocked!*`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🏆 Founder Milestone: Talk to 5 Users Completed!"
          }
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Founder:* \`${founderPubkey}\`` },
            { type: "mrkdwn", text: `*Track:* ${track}` },
            { type: "mrkdwn", text: `*Interviews Verified:* ${interviewCount} / 5` },
            { type: "mrkdwn", text: `*Status:* Ready for EIR Mentorship Review` }
          ]
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "View on Solana Explorer" },
              url: explorerUrl
            }
          ]
        }
      ]
    };

    try {
      const response = await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Slack webhook error: ${response.statusText}`);
      }
      console.log('[Integrations] Successfully posted milestone update to Slack.');
    } catch (err) {
      console.error('[Integrations] Failed to send Slack alert:', err.message);
    }
  }

  async sendUserInterviewPerk(userEmail, userPubkey, founderPubkey, interviewIndex) {
    if (!this.resend) {
      console.warn('[Integrations] Resend API key missing. Skipping perk email.');
      return;
    }

    try {
      await this.resend.emails.send({
        from: 'Colosseum Founder Discovery <onboarding@resend.dev>',
        to: userEmail,
        subject: 'Thank You for Helping Build the Future of Solana!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #6366f1;">Customer Discovery Verification Receipt</h2>
            <p>Hi there,</p>
            <p>You recently completed an official 1-on-1 customer discovery interview with Founder <code>${founderPubkey}</code>.</p>
            <p>Your session has been cryptographically recorded on Solana as Interview <strong>#${interviewIndex + 1}</strong> of the 5-user milestone.</p>
            <div style="background-color: #f9fafb; padding: 15px; border-radius: 4px; margin: 20px 0;">
              <p style="margin: 0; font-size: 13px; color: #4b5563;">Attestation Signer: <code>${userPubkey}</code></p>
            </div>
            <p>As a thank you, your wallet has been prioritized for exclusive alpha testing and future ecosystem airdrop rewards.</p>
            <p style="margin-top: 30px; font-size: 12px; color: #9ca3af;">Secured by Colosseum Proof-of-Discovery Protocol.</p>
          </div>
        `
      });
      console.log(`[Integrations] Dispatched verified reward email to ${userEmail}`);
    } catch (err) {
      console.error('[Integrations] Failed to disburse Resend email:', err.message);
    }
  }
}