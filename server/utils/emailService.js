import nodemailer from 'nodemailer';

// Helper function to send email using Titan configs
export async function sendTitanEmail({ name, subject, message, recipientEmail, htmlContent = null }) {
  // Check if email credentials are set
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS environment variables must be set');
  }

  const configs = [
    {
      name: 'Titan STARTTLS 587 (Recommended)',
      host: 'server028.yourhosting.nl',
      port: 587,
      secure: false,
      requireTLS: true,
      tls: { 
        rejectUnauthorized: false,
        ciphers: 'SSLv3'
      },
      authMethod: 'PLAIN'
    },
    {
      name: 'Titan SSL 465',
      host: 'smtp.titan.email', 
      port: 465,
      secure: true,
      tls: { 
        rejectUnauthorized: false,
        servername: 'smtp.titan.email'
      },
      authMethod: 'PLAIN'
    },
    {
      name: 'Titan Alternative Port 25',
      host: 'smtp.titan.email',
      port: 25,
      secure: false,
      ignoreTLS: false,
      tls: { rejectUnauthorized: false },
      authMethod: 'PLAIN'
    },
    {
      name: 'Titan Basic 587',
      host: 'smtp.titan.email',
      port: 587,
      secure: false,
      ignoreTLS: false,
      authMethod: 'PLAIN'
    }
  ];

  for (let config of configs) {
    try {
      console.log(`Trying email config: ${config.name}`);
      console.log(`Host: ${config.host}, Port: ${config.port}, Secure: ${config.secure}`);
      console.log(`Email User: ${process.env.EMAIL_USER ? process.env.EMAIL_USER.substring(0, 3) + '***' : 'NOT SET'}`);
      
      const transporter = nodemailer.createTransport({
        ...config,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
        debug: true, // Enable debug logging
        logger: true // Enable logging
      });

      // Test the connection first
      await transporter.verify();
      console.log(`✓ Connection verified for ${config.name}`);

      const mailOptions = {
        from: process.env.EMAIL_FROM || `"${process.env.PLATFORM_NAME || 'MedSaaS'}" <${process.env.EMAIL_USER}>`,
        to: recipientEmail,
        subject: subject,
        text: message,
        html: htmlContent || `<div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>${subject}</h2>
          <p>${message.replace(/\n/g, '<br>')}</p>
          <hr>
          <p><small>Sent from ${process.env.PLATFORM_NAME || 'MedSaaS'}</small></p>
        </div>`
      };

      await transporter.sendMail(mailOptions);
      console.log(`✓ Email sent successfully using: ${config.name}`);
      return;
    } catch (error) {
      console.error(`✗ ${config.name} failed:`, error.message);
      if (error.responseCode === 535) {
        console.error(`  Authentication failed - check your email credentials`);
      }
      continue;
    }
  }

  throw new Error('All email configurations failed');
}

// Test email configuration function
export async function testEmailConfiguration() {
  // Check if email credentials are set
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return {
      success: false,
      error: 'EMAIL_USER and EMAIL_PASS environment variables must be set',
      details: 'Please check your .env file'
    };
  }

  console.log(`Testing email with user: ${process.env.EMAIL_USER}`);

  const configs = [
    {
      name: 'Titan STARTTLS 587 (Recommended)',
      host: 'smtp.titan.email',
      port: 587,
      secure: false,
      requireTLS: true,
      tls: { 
        rejectUnauthorized: false,
        ciphers: 'SSLv3'
      },
      authMethod: 'PLAIN'
    },
    {
      name: 'Titan SSL 465',
      host: 'smtp.titan.email', 
      port: 465,
      secure: true,
      tls: { 
        rejectUnauthorized: false,
        servername: 'smtp.titan.email'
      },
      authMethod: 'PLAIN'
    },
    {
      name: 'Titan Alternative Port 25',
      host: 'smtp.titan.email',
      port: 25,
      secure: false,
      ignoreTLS: false,
      tls: { rejectUnauthorized: false },
      authMethod: 'PLAIN'
    },
    {
      name: 'Titan Basic 587',
      host: 'smtp.titan.email',
      port: 587,
      secure: false,
      ignoreTLS: false,
      authMethod: 'PLAIN'
    }
  ];

  for (let config of configs) {
    try {
      console.log(`Testing config: ${config.name}`);
      console.log(`Host: ${config.host}, Port: ${config.port}, Secure: ${config.secure}`);
      
      const transporter = nodemailer.createTransport({
        ...config,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
        debug: true,
        logger: true
      });

      await transporter.verify();
      console.log(`✓ Email configuration verified: ${config.name}`);
      return { 
        success: true, 
        message: `Email configuration working with: ${config.name}`,
        config: config.name,
        host: config.host,
        port: config.port
      };
    } catch (error) {
      console.error(`✗ ${config.name} failed:`, error.message);
      if (error.responseCode === 535) {
        console.error(`  → Authentication failed - check your Titan Mail credentials`);
        console.error(`  → Make sure you're using the correct email and password`);
        console.error(`  → Try logging into Titan Mail webmail to verify credentials`);
      }
    }
  }

  return { 
    success: false, 
    error: 'All email configurations failed',
    details: 'Please check your Titan Mail credentials and settings'
  };
}
