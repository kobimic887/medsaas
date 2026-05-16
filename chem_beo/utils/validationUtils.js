// Password validation utilities
export function validatePassword(password) {
  const passwordPolicy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
  return passwordPolicy.test(password);
}

// Email validation
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Required fields validation
export function validateRequiredFields(data, requiredFields) {
  const missing = [];
  for (const field of requiredFields) {
    if (!data[field]) {
      missing.push(field);
    }
  }
  return missing.length === 0 ? null : missing;
}

// Sanitize input data
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.trim().replace(/[<>]/g, '');
}

// Generate random key/ID
export function generateRandomKey(length = 12) {
  return Array.from({ length }, () =>
    Math.random().toString(36).charAt(2)
  ).join('');
}
