// Email debugging utilities

export function validateEmailCredentials() {
  const issues = [];
  
  if (!process.env.EMAIL_USER) {
    issues.push('EMAIL_USER environment variable is not set');
  } else {
    if (!process.env.EMAIL_USER.includes('@')) {
      issues.push('EMAIL_USER should be a full email address (e.g., user@domain.com)');
    }
  }
  
  if (!process.env.EMAIL_PASS) {
    issues.push('EMAIL_PASS environment variable is not set');
  } else {
    if (process.env.EMAIL_PASS.length < 6) {
      issues.push('EMAIL_PASS seems too short (should be your full password)');
    }
  }
  
  return {
    valid: issues.length === 0,
    issues,
    credentials: {
      user: process.env.EMAIL_USER ? `${process.env.EMAIL_USER.substring(0, 3)}***@${process.env.EMAIL_USER.split('@')[1] || 'domain'}` : 'NOT SET',
      passLength: process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 0
    }
  };
}

export function getTitanMailHelp() {
  return {
    message: 'Titan Mail SMTP Setup Help',
    steps: [
      '1. Log into your Titan Mail account at https://mail.titan.email/',
      '2. Verify your email address and password work for webmail login',
      '3. Check if your account has SMTP/IMAP access enabled',
      '4. Use your full email address as EMAIL_USER (e.g., user@yourdomain.com)',
      '5. Use your account password as EMAIL_PASS (not an app password)',
      '6. Make sure your domain is properly configured with Titan Mail'
    ],
    commonIssues: [
      'Using incorrect email format (should include @domain.com)',
      'Using old password after recent change',
      'Account not fully activated with Titan Mail',
      'Domain not properly configured with Titan Mail DNS',
      'SMTP access disabled for the account'
    ],
    supportedSettings: [
      'SMTP Server: smtp.titan.email',
      'Ports: 587 (STARTTLS), 465 (SSL), 25 (basic)',
      'Authentication: Required',
      'Security: STARTTLS or SSL/TLS'
    ]
  };
}
