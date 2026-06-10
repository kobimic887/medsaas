// Email templates — branded per company (signup) with platform fallback

import { DEFAULT_BRAND_PALETTE, normalizeBrandPalette } from './companyBranding.js';

function resolveBrandName(companyName, platformName = 'MedSaaS') {
  const company = typeof companyName === 'string' ? companyName.trim() : '';
  return company || platformName;
}

// Resolve a four-field brand palette from the caller-supplied options.
// The template must NEVER throw because of branding: a malformed palette
// (e.g. normalizeBrandPalette throwing on a present-but-bad hex) fails open
// to DEFAULT_BRAND_PALETTE so every rendered colour is a valid #RRGGBB string.
function resolveBrandPalette(rawPalette) {
  try {
    return normalizeBrandPalette(rawPalette || {});
  } catch {
    return DEFAULT_BRAND_PALETTE;
  }
}

// Inline-style builders. Brand colours are emitted as inline `style="..."`
// attributes (never CSS classes or variables) so they survive email-client
// CSS stripping.
function headerStyle(brand) {
  return `background: linear-gradient(135deg, ${brand.primary} 0%, ${brand.accent} 100%); color: #ffffff; padding: 40px 30px; text-align: center;`;
}

function primaryButtonStyle(brand) {
  return `display: inline-block; background: linear-gradient(135deg, ${brand.primary} 0%, ${brand.dark} 100%); color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 20px 0; text-align: center;`;
}

function accentTextStyle(brand) {
  return `color: ${brand.accent};`;
}

function titleStyle(brand) {
  return `font-size: 24px; color: ${brand.accent}; margin-bottom: 20px; font-weight: 600;`;
}

export function generateVerificationEmailHTML(username, verificationUrl, options = {}) {
  const {
    companyName = '',
    platformName = 'MedSaaS',
    websiteUrl = '',
    signInUrl = '',
    palette,
  } = options;
  const brandName = resolveBrandName(companyName, platformName);
  const website = websiteUrl || signInUrl || '#';
  const brand = resolveBrandPalette(palette);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email - ${brandName}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f8f9fa;
        }
        
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .header {
            color: white;
            padding: 40px 30px;
            text-align: center;
        }

        .logo {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 10px;
            letter-spacing: 1px;
        }

        .tagline {
            font-size: 14px;
            opacity: 0.9;
            font-style: italic;
        }
        
        .content {
            padding: 40px 30px;
        }
        
        .welcome-title {
            font-size: 24px;
            margin-bottom: 20px;
            font-weight: 600;
        }

        .welcome-text {
            font-size: 16px;
            color: #4b5563;
            margin-bottom: 30px;
            line-height: 1.7;
        }
        
        .verify-button {
            display: inline-block;
            color: white;
            padding: 16px 32px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
            text-align: center;
            transition: all 0.3s ease;
        }

        .features {
            background-color: #f1f5f9;
            padding: 25px;
            border-radius: 8px;
            margin: 30px 0;
        }
        
        .features h3 {
            font-size: 18px;
            margin-bottom: 15px;
        }
        
        .feature-list {
            list-style: none;
            padding: 0;
        }
        
        .feature-list li {
            padding: 8px 0;
            color: #4b5563;
            position: relative;
            padding-left: 25px;
        }
        
        .feature-list li:before {
            content: "✓";
            position: absolute;
            left: 0;
            color: #10b981;
            font-weight: bold;
        }
        
        .security-note {
            background-color: #fef3c7;
            border: 1px solid #f59e0b;
            border-radius: 6px;
            padding: 15px;
            margin: 25px 0;
            font-size: 14px;
            color: #92400e;
        }
        
        .alt-link {
            margin-top: 25px;
            padding: 15px;
            background-color: #f8fafc;
            border-radius: 6px;
            font-size: 14px;
            color: #64748b;
            word-break: break-all;
        }
        
        .footer {
            background-color: #1f2937;
            color: #d1d5db;
            padding: 30px;
            text-align: center;
        }
        
        .footer-content {
            margin-bottom: 20px;
        }
        
        .company-info {
            font-size: 14px;
            line-height: 1.6;
            margin-bottom: 15px;
        }
        
        .social-links {
            margin: 20px 0;
        }
        
        .social-links a {
            color: #9ca3af;
            text-decoration: none;
            margin: 0 10px;
            font-size: 14px;
        }
        
        .copyright {
            font-size: 12px;
            color: #6b7280;
            border-top: 1px solid #374151;
            padding-top: 20px;
        }
        
        @media (max-width: 600px) {
            .email-container {
                margin: 0;
                border-radius: 0;
            }
            
            .header, .content, .footer {
                padding: 25px 20px;
            }
            
            .welcome-title {
                font-size: 20px;
            }
            
            .verify-button {
                display: block;
                text-align: center;
                margin: 25px 0;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <!-- Header -->
        <div class="header" style="${headerStyle(brand)}">
            <div class="logo">${brandName.toUpperCase()}</div>
            <div class="tagline">Unlocking the potential of macrocyclic chemistry</div>
        </div>

        <!-- Main Content -->
        <div class="content">
            <h1 class="welcome-title" style="${titleStyle(brand)}">Welcome to ${brandName}, ${username}!</h1>

            <p class="welcome-text">
                Thank you for joining our platform dedicated to advancing drug discovery through innovative macrocyclic chemistry.
                To complete your registration and start exploring our compound libraries and research tools, please verify your email address.
            </p>

            <div style="text-align: center;">
                <a href="${verificationUrl}" class="verify-button" style="${primaryButtonStyle(brand)}">Verify Your Email Address</a>
            </div>

            <div class="features">
                <h3 style="${accentTextStyle(brand)}">What you'll get access to:</h3>
                <ul class="feature-list">
                    <li>Comprehensive molecular compound database and pricing</li>
                    <li>Advanced molecular docking simulations</li>
                    <li>Virtual screening tools for challenging drug targets</li>
                    <li>Custom synthesis and compound library services</li>
                    <li>Project management and collaboration tools</li>
                </ul>
            </div>
            
            <div class="security-note">
                <strong>Security Note:</strong> This verification link will expire in 24 hours for your security. 
                If you didn't create this account, please ignore this email.
            </div>
            
            <div class="alt-link">
                <strong>Can't click the button?</strong> Copy and paste this link into your browser:<br>
                <span style="${accentTextStyle(brand)}">${verificationUrl}</span>
            </div>
        </div>
        
        <!-- Footer -->
        <div class="footer">
            <div class="footer-content">
                <div class="company-info">
                    <strong>${brandName}</strong><br>
                    Matrix Innovation Center<br>
                    Science Park 408, 1098XH Amsterdam<br>
                    The Netherlands
                </div>
                
                <div class="social-links">
                    <a href="${website}">Open platform</a>
                </div>
            </div>
            
            <div class="copyright">
                © ${new Date().getFullYear()} ${brandName} - All Rights Reserved<br>
                Create future medicines by unlocking the potential of macrocyclic chemistry
            </div>
        </div>
    </div>
</body>
</html>`;
}

export function generateWelcomeEmailHTML(username, options = {}) {
  const {
    companyName = '',
    platformName = 'MedSaaS',
    signInUrl = '#',
    palette,
  } = options;
  const brandName = resolveBrandName(companyName, platformName);
  const brand = resolveBrandPalette(palette);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to ${brandName}</title>
    <style>
        /* Reuse the same styles as verification email */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f8f9fa;
        }
        
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .header {
            color: white;
            padding: 40px 30px;
            text-align: center;
        }

        .logo {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 10px;
            letter-spacing: 1px;
        }

        .content {
            padding: 40px 30px;
        }

        .success-title {
            font-size: 24px;
            margin-bottom: 20px;
            font-weight: 600;
        }

        .cta-button {
            display: inline-block;
            color: white;
            padding: 16px 32px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header" style="${headerStyle(brand)}">
            <div class="logo">${brandName.toUpperCase()}</div>
            <div>Welcome aboard!</div>
        </div>

        <div class="content">
            <h1 class="success-title" style="${titleStyle(brand)}">Email Verified Successfully!</h1>

            <p>Hello ${username},</p>

            <p>Your email has been verified and your account is now active. You can now access all features of the ${brandName} workspace.</p>

            <div style="text-align: center;">
                <a href="${signInUrl}" class="cta-button" style="${primaryButtonStyle(brand)}">Sign In to Your Account</a>
            </div>
        </div>
    </div>
</body>
</html>`;
}

export function generatePasswordResetEmailHTML(username, resetUrl, options = {}) {
  const { companyName = '', platformName = 'MedSaaS', palette } = options;
  const brandName = resolveBrandName(companyName, platformName);
  const brand = resolveBrandPalette(palette);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password - ${brandName}</title>
    <style>
        /* Similar styles with red/orange theme for security */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f8f9fa;
        }
        
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .header {
            color: white;
            padding: 40px 30px;
            text-align: center;
        }

        .logo {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 10px;
            letter-spacing: 1px;
        }

        .content {
            padding: 40px 30px;
        }

        .reset-button {
            display: inline-block;
            color: white;
            padding: 16px 32px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header" style="${headerStyle(brand)}">
            <div class="logo">${brandName.toUpperCase()}</div>
            <div>Password Reset Request</div>
        </div>

        <div class="content">
            <h1 style="${accentTextStyle(brand)}">Reset Your Password</h1>

            <p>Hello ${username},</p>

            <p>We received a request to reset your password. Click the button below to set a new password:</p>

            <div style="text-align: center;">
                <a href="${resetUrl}" class="reset-button" style="${primaryButtonStyle(brand)}">Reset Password</a>
            </div>
            
            <p><strong>This link will expire in 1 hour for security reasons.</strong></p>
            
            <p>If you didn't request this password reset, please ignore this email and your password will remain unchanged.</p>
        </div>
    </div>
</body>
</html>`;
}

export function generateInviteEmailHTML(options = {}) {
  const {
    invitee = '',
    inviter = '',
    companyName = '',
    role = 'member',
    passwordLine = '',
    signInUrl = '#',
    platformName = 'MedSaaS',
    palette,
  } = options;
  const brandName = resolveBrandName(companyName, platformName);
  const brand = resolveBrandPalette(palette);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>You're invited to ${brandName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f8f9fa;
        }
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .header {
            color: white;
            padding: 40px 30px;
            text-align: center;
        }
        .logo {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 10px;
            letter-spacing: 1px;
        }
        .content { padding: 40px 30px; }
        .invite-title {
            font-size: 24px;
            margin-bottom: 20px;
            font-weight: 600;
        }
        .invite-button {
            display: inline-block;
            color: white;
            padding: 16px 32px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
            text-align: center;
        }
        .invite-meta {
            background-color: #f8fafc;
            border-radius: 6px;
            padding: 15px;
            margin: 25px 0;
            font-size: 14px;
            color: #475569;
            word-break: break-word;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header" style="${headerStyle(brand)}">
            <div class="logo">${brandName.toUpperCase()}</div>
            <div>You're invited</div>
        </div>

        <div class="content">
            <h1 class="invite-title" style="${titleStyle(brand)}">Join ${brandName}, ${invitee}!</h1>

            <p>${inviter} invited you to join ${brandName} on ${platformName} as a <strong>${role}</strong>.</p>

            <div style="text-align: center;">
                <a href="${signInUrl}" class="invite-button" style="${primaryButtonStyle(brand)}">Sign In to Your Account</a>
            </div>

            <div class="invite-meta">
                <strong>Getting started:</strong> ${passwordLine}<br>
                Sign in at <span style="${accentTextStyle(brand)}">${signInUrl}</span>
            </div>
        </div>
    </div>
</body>
</html>`;
}
