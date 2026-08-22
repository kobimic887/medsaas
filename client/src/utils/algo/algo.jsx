/**
 * Utility functions for currency conversion and geolocation
 */

const EXTERNAL_LOOKUP_TIMEOUT_MS = 5000;
let exchangeRatePromise = null;
let userCountryPromise = null;

/**
 * Fetches the current USD to EUR exchange rate
 * @returns {Promise<number>} The exchange rate (EUR/USD)
 */
export const fetchExchangeRate = async () => {
  if (exchangeRatePromise) return exchangeRatePromise;

  exchangeRatePromise = (async () => {
  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      signal: AbortSignal.timeout(EXTERNAL_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Exchange-rate service returned HTTP ${response.status}`);
    const data = await response.json();
    const rate = Number(data?.rates?.EUR);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Exchange-rate service returned an invalid EUR rate');
    return rate;
  } catch (error) {
    console.warn('Using fallback USD/EUR exchange rate:', error);
    // Fallback to approximate rate if API fails
    return 0.92; // Approximate USD to EUR rate as fallback
  }
  })();

  return exchangeRatePromise;
};

/**
 * Fetches the user's country based on their IP address
 * @returns {Promise<string>} The country code (e.g., 'US', 'DE', 'FR')
 */
export const fetchUserCountry = async () => {
  if (userCountryPromise) return userCountryPromise;

  userCountryPromise = (async () => {
  try {
    const response = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(EXTERNAL_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Location service returned HTTP ${response.status}`);
    const data = await response.json();
    const countryCode = typeof data?.country_code === 'string' ? data.country_code.toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('Location service returned an invalid country code');
    return countryCode;
  } catch (error) {
    console.warn('Using default country for currency display:', error);
    return 'US'; // Default to US if API fails
  }
  })();

  return userCountryPromise;
};

/**
 * Checks if the user is in a Eurozone country
 * @param {string} countryCode - The ISO country code
 * @returns {boolean} True if the country uses EUR
 */
export const isEurozoneCountry = (countryCode) => {
  const eurozoneCountries = [
    'AT', 'BE', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT',
    'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES', 'HR'
  ];
  return eurozoneCountries.includes(countryCode);
};

/**
 * Converts USD price to EUR based on user's IP location and current exchange rate
 * @param {number} priceUSD - Price in US dollars
 * @param {string} userCountry - Optional country code (will auto-detect if not provided)
 * @param {number} exchangeRate - Optional exchange rate (will fetch if not provided)
 * @returns {Promise<{priceEUR: number, currency: string, exchangeRate: number}>}
 */
export const convertPriceToEuro = async (priceUSD, userCountry = null, exchangeRate = null) => {
  try {
    // Get user's country if not provided
    const country = userCountry || await fetchUserCountry();
    
    // Check if user is in Eurozone
    const shouldShowEuro = isEurozoneCountry(country);
    
    if (!shouldShowEuro) {
      // Return original price in USD if not in Eurozone
      return {
        priceEUR: priceUSD,
        currency: 'USD',
        exchangeRate: 1,
        country: country
      };
    }
    
    // Get exchange rate if not provided
    const rate = exchangeRate || await fetchExchangeRate();
    
    // Convert USD to EUR
    const priceEUR = priceUSD * rate;
    
    return {
      priceEUR: parseFloat(priceEUR.toFixed(2)),
      currency: 'EUR',
      exchangeRate: rate,
      country: country
    };
  } catch (error) {
    console.error('Error converting price:', error);
    // Return original price in case of error
    return {
      priceEUR: priceUSD,
      currency: 'USD',
      exchangeRate: 1,
      country: 'US'
    };
  }
};

/**
 * Formats price with currency symbol
 * @param {number} price - The price value
 * @param {string} currency - Currency code ('USD' or 'EUR')
 * @returns {string} Formatted price string
 */
export const formatPrice = (price, currency = 'USD') => {
  const symbol = currency === 'EUR' ? '€' : '$';
  return `${symbol}${price.toFixed(2)}`;
};
