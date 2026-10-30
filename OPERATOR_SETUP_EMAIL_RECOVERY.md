# SmartAssets Email Verification & Password Recovery: Operator Setup Guide

This guide details the exact steps required for the operator to activate live transactional email delivery in Supabase Auth, connect turboSMTP, configure OTP email templates, and secure redirect allowlists.

---

## 1. Email Provider Identification & Credentials

The existing credentials in the server `.env` file under `#--SERVER SMTP API KEYS`:
- `CONSUMER_KEY` (20-character hex)
- `CONSUMER_SECRET` (20-character base64/alphanumeric)

belong to **turboSMTP** (`serversmtp.com`), an enterprise transactional email relay provider.

### Official turboSMTP Configuration Requirements
- **SMTP Server / Host**: `pro.turbo-smtp.com`
- **Port**:
  - `587` (STARTTLS / TLS — **Recommended**)
  - `465` (SSL)
  - `25` or `2525` (Alternative unencrypted/STARTTLS)
- **Authentication**: Required (AUTH PLAIN / LOGIN)
- **SMTP Username**: Your `CONSUMER_KEY` (e.g. `9771120019918281...`)
- **SMTP Password**: Your `CONSUMER_SECRET` (e.g. `vK3G...`)
- **Sender Address**: Must be an email address using your verified domain (e.g. `noreply@smartassets.co.za` or `support@smartassets.io`).
- **Sender Name**: `SmartAssets Security` or `SmartAssets`

> **Security Mandate**: Never place `CONSUMER_KEY` or `CONSUMER_SECRET` into client Expo code, mobile bundles, or git repositories. They are configured strictly within Supabase Auth dashboard settings or backend server environment.

---

## 2. Supabase Auth Dashboard Configuration

Log in to the [Supabase Dashboard](https://supabase.com/dashboard), select your project (`SUPERBASE_PROJECT_ID`), and navigate to **Project Settings** → **Authentication**.

### Step 2.1: Enable Email Confirmations
1. Under **Authentication** → **Email Auth**:
   - Turn **ON** `Enable Email Signup`.
   - Turn **ON** `Confirm email`.
     *(Prevents accounts from being marked confirmed upon registration without verifying an emailed OTP code).*
   - Turn **OFF** `Secure email change` (or leave default if email modifications require re-confirmation).
   - Set **OTP Expiry** to `600` seconds (10 minutes).
   - Set **Max Frequency (Resend rate limit)** to `60` seconds.

### Step 2.2: Configure Custom SMTP Relay (turboSMTP)
1. In **Authentication** → **SMTP Settings**:
   - Toggle **Enable Custom SMTP** to **ON**.
   - **Sender Email**: Set to your verified sender (e.g. `noreply@smartassets.co.za`).
   - **Sender Name**: `SmartAssets`
   - **Host**: `pro.turbo-smtp.com`
   - **Port Number**: `587`
   - **Minimum TLS Version**: `TLSv1.2`
   - **User**: Enter your `CONSUMER_KEY`.
   - **Password**: Enter your `CONSUMER_SECRET`.
2. Click **Save Changes**.
3. Send a test email from the Supabase test utility to ensure turboSMTP accepts the relay credentials.

---

## 3. Email Templates Setup (6-Digit OTP Code)

In **Authentication** → **Email Templates**, update the templates to supply the numeric OTP code (`{{ .Token }}`) so users can enter it directly in the app screens.

### 3.1: Confirm Signup Template
- **Template**: **Confirm signup**
- **Subject**: `Verify your SmartAssets email address: {{ .Token }}`
- **Body Content** (HTML):
```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; background: #0F172A; color: #FFFFFF; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h1 style="color: #00C2FF; font-size: 26px; font-weight: 800; margin: 0; letter-spacing: 0.5px;">SMARTASSETS</h1>
    <p style="color: #94A3B8; font-size: 14px; margin-top: 6px;">Secure Physical & Digital Asset Investment</p>
  </div>
  <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 24px; text-align: center;">
    <h2 style="font-size: 20px; font-weight: 700; margin-top: 0; color: #FFFFFF;">Confirm Your Email</h2>
    <p style="color: #CBD5E1; font-size: 14px; line-height: 1.6;">
      Enter the 6-digit verification code below in the SmartAssets app to confirm your email and activate your account:
    </p>
    <div style="margin: 28px 0; padding: 18px 24px; background: #0A0F1D; border: 1px solid #00C2FF; border-radius: 10px; display: inline-block;">
      <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #00C2FF;">{{ .Token }}</span>
    </div>
    <p style="color: #64748B; font-size: 12px; margin-bottom: 0;">
      This code expires in 10 minutes. If you did not create a SmartAssets account, please disregard this email.
    </p>
  </div>
</div>
```

### 3.2: Reset Password / Recovery Template (In-App Code Only — No Links)
- **Template Location in Supabase**: **Authentication** → **Email Templates** → **Reset password**
- **Subject**: `Your SmartAssets recovery code: {{ .Token }}`
- **Logo Asset Used**: `https://smartassets.onrender.com/logo-mark.png` (Public HTTPS, zero shadows, responsive)
- **HTML Message Body Content**:
```html
<!DOCTYPE html>
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
</html>
```

- **Plain Text Fallback**:
```text
SmartAssets Password Recovery

We received a request to reset your SmartAssets account password.

Your 6-digit recovery code is:
{{ .Token }}

Enter this code in the SmartAssets app on your device to set a new password.

This single-use code expires in 10 minutes.

If you did not request this password reset, you can safely ignore this email. Your account remains secure and no changes were made.

© SmartAssets • Secure Physical & Digital Asset Investment
```

---

## 4. Redirect URL Allowlist Setup

In **Authentication** → **URL Configuration**:
1. **Site URL**: `https://smartassets.onrender.com`
2. **Redirect URLs** (Add each as an exact entry):
   - `smartassets://reset-password`
   - `https://smartassets.onrender.com`
   - `https://smartassets.onrender.com/`
   - `https://smartassets.onrender.com/reset-password`
   - `http://localhost:3000` (Local dev web)
   - `http://localhost:8081` (Expo local web)

*(Unsafe wildcard redirects such as `https://*` or prefix-matching are blocked by backend allowlist enforcement).*

---

## 5. Domain Deliverability: SPF, DKIM, DMARC

To prevent transactional emails from landing in spam or being rejected by Gmail/Outlook, configure the following DNS records for your sender domain (e.g. `smartassets.co.za`):

1. **SPF Record (TXT)**:
   Ensure `include:turbo-smtp.com` is in your domain's SPF record:
   ```txt
   v=spf1 include:turbo-smtp.com ~all
   ```
2. **DKIM Record (CNAME / TXT)**:
   In your turboSMTP dashboard (**Settings** → **DKIM Validation**), copy your designated DKIM selector and key, and add the CNAME / TXT record in your DNS provider (e.g. Cloudflare / Namecheap / AWS Route53).
3. **DMARC Record (TXT)**:
   Add a DMARC policy record at `_dmarc.yourdomain.com`:
   ```txt
   v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@yourdomain.com; pct=100
   ```

---

## 6. End-to-End Operator Verification Procedure

Once you have configured Custom SMTP in the Supabase Dashboard:

1. **Test Registration Verification**:
   - Open the SmartAssets app or web client.
   - Register a new account with your personal test email address.
   - Verify that the app transitions to `VerifyEmailScreen`.
   - Check your inbox for the 6-digit confirmation code.
   - Enter the 6-digit code in the app.
   - Verify that the account is finalized and you can sign in.
2. **Test Password Recovery**:
   - On the Sign In screen, tap **Forgot Password?**.
   - Enter the registered email and tap **Send Recovery Code**.
   - Check your inbox for the recovery email containing the 6-digit code.
   - Enter the 6-digit code on `VerifyRecoveryCodeScreen`.
   - Verify that the app transitions to `ResetPasswordScreen`.
   - Enter your new password and submit.
   - Confirm you can sign in with your updated password.
