// ─── Production Email Templates for Supabase Auth ──────────────────────────────
// Strictly code-only OTP templates: no clickable confirmation links, no tokens in URLs.
// Uses verified public HTTPS logo URL without shadows.

const PUBLIC_LOGO_URL = 'https://smartassets.onrender.com/logo-mark.png';

const RECOVERY_EMAIL_TEMPLATE = {
  subject: 'Your SmartAssets recovery code: {{ .Token }}',
  logoUrl: PUBLIC_LOGO_URL,
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>SmartAssets Password Recovery</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0B1120; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #0B1120; width: 100%; margin: 0; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #111C33; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 16px; overflow: hidden; margin: 0 auto;">
          <!-- Header / Logo -->
          <tr>
            <td align="center" style="padding: 36px 24px 16px 24px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 0; margin: 0;">
                    <img src="https://smartassets.onrender.com/logo-mark.png" alt="SmartAssets" width="64" height="64" style="display: block; width: 64px; height: 64px; border: 0; outline: none; margin: 0 auto; -ms-interpolation-mode: bicubic;" />
                  </td>
                </tr>
              </table>
              <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 700; margin: 18px 0 0 0; letter-spacing: -0.3px;">SmartAssets</h1>
              <p style="color: #64748B; font-size: 13px; font-weight: 500; margin: 4px 0 0 0;">Password Recovery</p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 8px 32px 28px 32px; text-align: center;">
              <p style="color: #E2E8F0; font-size: 15px; line-height: 22px; margin: 0 0 20px 0;">
                We received a request to reset your SmartAssets account password. Enter this temporary 6-digit recovery code in the app to continue:
              </p>

              <!-- OTP Code Display Box -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 24px auto;">
                <tr>
                  <td align="center" style="background-color: #0A0F1D; border: 1.5px solid #00C2FF; border-radius: 12px; padding: 16px 28px;">
                    <span style="font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #00C2FF; display: block; line-height: 1;">{{ .Token }}</span>
                  </td>
                </tr>
              </table>

              <p style="color: #94A3B8; font-size: 13px; line-height: 19px; margin: 0 0 16px 0;">
                This single-use code expires in <strong>10 minutes</strong>. Enter it on the recovery screen in the SmartAssets app.
              </p>

              <div style="height: 1px; background-color: rgba(255, 255, 255, 0.08); margin: 24px 0;"></div>

              <p style="color: #64748B; font-size: 12px; line-height: 18px; margin: 0;">
                If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged and your account is secure.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0E172A; padding: 18px 24px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.06);">
              <p style="color: #475569; font-size: 11px; margin: 0; line-height: 16px;">
                &copy; SmartAssets • Secure Physical & Digital Asset Investment
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  plainText: `SmartAssets Password Recovery

We received a request to reset your SmartAssets account password.

Your 6-digit recovery code is:
{{ .Token }}

Enter this code in the SmartAssets app on your device to set a new password.

This single-use code expires in 10 minutes.

If you did not request this password reset, you can safely ignore this email. Your account remains secure and no changes were made.

© SmartAssets • Secure Physical & Digital Asset Investment`,
};

const CONFIRM_SIGNUP_EMAIL_TEMPLATE = {
  subject: 'Verify your SmartAssets email address: {{ .Token }}',
  logoUrl: PUBLIC_LOGO_URL,
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SmartAssets Email Verification</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0B1120; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #0B1120; width: 100%; margin: 0; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #111C33; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 16px; overflow: hidden; margin: 0 auto;">
          <tr>
            <td align="center" style="padding: 36px 24px 16px 24px;">
              <img src="https://smartassets.onrender.com/logo-mark.png" alt="SmartAssets" width="64" height="64" style="display: block; width: 64px; height: 64px; border: 0; outline: none; margin: 0 auto;" />
              <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 700; margin: 18px 0 0 0;">SmartAssets</h1>
              <p style="color: #64748B; font-size: 13px; font-weight: 500; margin: 4px 0 0 0;">Email Verification</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 32px 28px 32px; text-align: center;">
              <p style="color: #E2E8F0; font-size: 15px; line-height: 22px; margin: 0 0 20px 0;">
                Enter the 6-digit verification code below in the SmartAssets app to confirm your email and activate your account:
              </p>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 24px auto;">
                <tr>
                  <td align="center" style="background-color: #0A0F1D; border: 1.5px solid #00C2FF; border-radius: 12px; padding: 16px 28px;">
                    <span style="font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #00C2FF; display: block; line-height: 1;">{{ .Token }}</span>
                  </td>
                </tr>
              </table>
              <p style="color: #94A3B8; font-size: 13px; line-height: 19px; margin: 0 0 16px 0;">
                This code expires in <strong>10 minutes</strong>.
              </p>
              <div style="height: 1px; background-color: rgba(255, 255, 255, 0.08); margin: 24px 0;"></div>
              <p style="color: #64748B; font-size: 12px; line-height: 18px; margin: 0;">
                If you did not create an account with SmartAssets, you can safely disregard this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #0E172A; padding: 18px 24px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.06);">
              <p style="color: #475569; font-size: 11px; margin: 0; line-height: 16px;">
                &copy; SmartAssets • Secure Physical & Digital Asset Investment
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  plainText: `SmartAssets Email Verification

Enter the 6-digit verification code below in the SmartAssets app to confirm your email and activate your account:

{{ .Token }}

This code expires in 10 minutes.

If you did not create an account with SmartAssets, you can safely disregard this email.

© SmartAssets • Secure Physical & Digital Asset Investment`,
};

module.exports = {
  PUBLIC_LOGO_URL,
  RECOVERY_EMAIL_TEMPLATE,
  CONFIRM_SIGNUP_EMAIL_TEMPLATE,
};
