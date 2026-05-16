const nodemailer = require('nodemailer');
require('dotenv').config();

console.log('Email credentials:');
console.log('USER:', process.env.EMAIL_USER);
console.log('PASS:', process.env.EMAIL_PASS ? '***SET***' : 'NOT SET');

// Official Titan Mail settings from their documentation
const config = {
  name: 'Titan Mail Official Settings',
  host: 'smtp.titan.email',
  port: 465,
  secure: true, // SSL/TLS for port 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  }
};

async function testConfig() {
  try {
    console.log(`\nTesting: ${config.name}`);
    console.log(`Host: ${config.host}, Port: ${config.port}, Secure: ${config.secure}`);
    
    const transporter = nodemailer.createTransport(config);
    
    console.log('Attempting to verify connection...');
    await transporter.verify();
    console.log(`✅ SUCCESS: ${config.name}`);
    
    // Test sending a simple email
    console.log('\nTesting actual email send...');
    const testEmail = {
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_USER, // Send to self for testing
      subject: 'Test Email from Node.js',
      text: 'This is a test email sent from the email client application.',
      html: '<h2>Test Email</h2><p>This is a test email sent from the email client application.</p>'
    };
    
    const result = await transporter.sendMail(testEmail);
    console.log('✅ EMAIL SENT SUCCESSFULLY!');
    console.log('Message ID:', result.messageId);
    
  } catch (error) {
    console.log(`❌ FAILED: ${config.name}`);
    console.log('Error:', error.message);
    
    if (error.message.includes('authentication failed')) {
      console.log('\n� TROUBLESHOOTING TIPS:');
      console.log('1. Check if "Third-party email access" is enabled in your Titan account');
      console.log('2. Disable Two-Factor Authentication if enabled');
      console.log('3. Verify your email address and password are correct');
      console.log('4. Check Titan Mail documentation: https://support.titan.email/hc/en-us/articles/25005307786905');
    }
  }
}

testConfig();
