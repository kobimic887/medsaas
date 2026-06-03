// Email templates for ChemBench

export function generateVerificationEmailHTML(username, verificationUrl) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email - ChemBench</title>
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
            background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
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
            color: #1e3a8a;
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
            background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);
            color: white;
            padding: 16px 32px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
            text-align: center;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }
        
        .verify-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
        }
        
        .features {
            background-color: #f1f5f9;
            padding: 25px;
            border-radius: 8px;
            margin: 30px 0;
        }
        
        .features h3 {
            color: #1e3a8a;
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
        <div class="header">
            <div class="logo">CHEMBENCH</div>
            <div class="tagline">Unlocking the potential of macrocyclic chemistry</div>
        </div>
        
        <!-- Main Content -->
        <div class="content">
            <h1 class="welcome-title">Welcome to ChemBench, ${username}!</h1>
            
            <p class="welcome-text">
                Thank you for joining our platform dedicated to advancing drug discovery through innovative macrocyclic chemistry. 
                To complete your registration and start exploring our compound libraries and research tools, please verify your email address.
            </p>
            
            <div style="text-align: center;">
                <a href="${verificationUrl}" class="verify-button">Verify Your Email Address</a>
            </div>
            
            <div class="features">
                <h3>What you'll get access to:</h3>
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
                <span style="color: #3b82f6;">${verificationUrl}</span>
            </div>
        </div>
        
        <!-- Footer -->
        <div class="footer">
            <div class="footer-content">
                <div class="company-info">
                    <strong>ChemBench</strong><br>
                    Matrix Innovation Center<br>
                    Science Park 408, 1098XH Amsterdam<br>
                    The Netherlands
                </div>
                
                <div class="social-links">
                    <a href="https://www.chembench.com/">Website</a>
                    <a href="https://www.chembench.com/contact/">Contact</a>
                    <a href="https://www.chembench.com/insights/">Insights</a>
                </div>
            </div>
            
            <div class="copyright">
                © 2025 ChemBench - All Rights Reserved<br>
                Create future medicines by unlocking the potential of macrocyclic chemistry
            </div>
        </div>
    </div>
</body>
</html>`;
}

export function generateWelcomeEmailHTML(username) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to ChemBench</title>
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
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
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
            color: #059669;
            margin-bottom: 20px;
            font-weight: 600;
        }
        
        .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, #10b981 0%, #047857 100%);
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
        <div class="header">
            <div class="logo">CHEMBENCH</div>
            <div>Welcome aboard!</div>
        </div>
        
        <div class="content">
            <h1 class="success-title">Email Verified Successfully!</h1>
            
            <p>Hello ${username},</p>
            
            <p>Your email has been verified and your account is now active. You can now access all features of the ChemBench platform.</p>
            
            <div style="text-align: center;">
                <a href="https://app.chembench.com/auth/sign-in" class="cta-button">Sign In to Your Account</a>
            </div>
        </div>
    </div>
</body>
</html>`;
}

export function generatePasswordResetEmailHTML(username, resetUrl) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password - ChemBench</title>
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
            background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
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
            background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
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
        <div class="header">
            <div class="logo">CHEMBENCH</div>
            <div>Password Reset Request</div>
        </div>
        
        <div class="content">
            <h1>Reset Your Password</h1>
            
            <p>Hello ${username},</p>
            
            <p>We received a request to reset your password. Click the button below to set a new password:</p>
            
            <div style="text-align: center;">
                <a href="${resetUrl}" class="reset-button">Reset Password</a>
            </div>
            
            <p><strong>This link will expire in 1 hour for security reasons.</strong></p>
            
            <p>If you didn't request this password reset, please ignore this email and your password will remain unchanged.</p>
        </div>
    </div>
</body>
</html>`;
}
