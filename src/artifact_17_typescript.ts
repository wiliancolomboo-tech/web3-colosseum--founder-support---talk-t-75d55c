import axios from "axios";

export interface EmailProofPayload {
  toEmail: string;
  intervieweeWallet: string;
  founderWallet: string;
  slotNumber: number;
  txSignature: string;
  transcriptHashHex: string;
}

export async function sendInterviewProofEmail(
  apiKey: string,
  fromEmail: string,
  data: EmailProofPayload
): Promise<void> {
  if (!apiKey) {
    console.warn("[ResendService] RESEND_API_KEY missing; skipping email receipt.");
    return;
  }

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-bottom: 8px;">Colosseum Founder Support | Pulse-5 Attestation</h2>
      <p style="color: #475569; font-size: 14px;">Thank you for participating in a verified user discovery interview session.</p>
      
      <div style="background-color: #f8fafc; border-radius: 6px; padding: 16px; margin: 20px 0;">
        <p style="margin: 4px 0; font-size: 13px;"><strong>Session Slot:</strong> #${data.slotNumber} of 5</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Founder Wallet:</strong> <code>${data.founderWallet}</code></p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Interviewee Wallet:</strong> <code>${data.intervieweeWallet}</code></p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Transcript Digest (SHA-256):</strong></p>
        <code style="word-break: break-all; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${data.transcriptHashHex}</code>
      </div>

      <p style="font-size: 13px; color: #64748b;">
        Your micro-grant reward has been transferred directly via Solana escrow. 
      </p>

      <a href="https://explorer.solana.com/tx/${data.txSignature}?cluster=devnet" 
         style="display: inline-block; background-color: #4f46e5; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 13px;">
         Verify Transaction on Solana
      </a>
      
      <p style="font-size: 11px; color: #94a3b8; margin-top: 24px;">Colosseum Accelerator & Hackathon Founder Discovery Verification Engine</p>
    </div>
  `;

  try {
    await axios.post(
      "https://api.resend.com/emails",
      {
        from: fromEmail,
        to: [data.toEmail],
        subject: `[Pulse-5 Proof] Verified Founder Interview Attestation #${data.slotNumber}`,
        html: htmlContent,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`[ResendService] Sent cryptographically verifiable proof to ${data.toEmail}`);
  } catch (error: any) {
    console.error("[ResendService] Failed sending proof email:", error.response?.data || error.message);
  }
}