import nodemailer from 'nodemailer';

// Replace with your Mailtrap credentials
const transporter = nodemailer.createTransport({
  host: 'smtp.mailtrap.io',
  port: 2525,
  auth: {
    user: 'MAILTRAP_USER', // replace with your Mailtrap user
    pass: 'MAILTRAP_PASS'  // replace with your Mailtrap password
  }
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { username, password, email, organization } = req.body;
  if (!username || !password || !email || !organization) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // TODO: Add your MongoDB user creation logic here

  // Send welcome email
  try {
    await transporter.sendMail({
      from: '"Pyxis Discovery" <no-reply@pyxis-discovery.com>',
      to: email,
      subject: 'Welcome to Pyxis Discovery!',
      text: `Hi ${username},\n\nWelcome to Pyxis Discovery! We're excited to have you and ${organization} onboard.\n\nBest,\nThe Pyxis Team`,
      html: `<p>Hi <b>${username}</b>,</p><p>Welcome to Pyxis Discovery! We're excited to have you and <b>${organization}</b> onboard.</p><p>Best,<br/>The Pyxis Team</p>`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Signup succeeded but email failed to send.' });
  }
}
