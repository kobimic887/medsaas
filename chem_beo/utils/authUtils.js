import jwt from 'jsonwebtoken';

// JWT authentication middleware
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

// Generate JWT token
export function generateToken(username) {
  return jwt.sign({ username }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
}

// Verify JWT token
export function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'secret');
  } catch (error) {
    return null;
  }
}

// Generate verification token for email
export function generateVerificationToken(username, email) {
  return jwt.sign({ username, email }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
}
