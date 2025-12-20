/**
 * Retry utility module
 * Provides retry logic with configurable attempts and delay
 */

/**
 * Execute a function with retry logic
 * @param {Function} fn - Async function to execute
 * @param {object} options - Retry options
 * @param {number} options.retries - Number of retry attempts (default: 0)
 * @param {number} options.delay - Delay between retries in ms (default: 1000)
 * @param {Function} options.onRetry - Callback called before each retry (attempt, error)
 * @param {Function} options.shouldRetry - Function to determine if error should trigger retry
 * @returns {Promise<any>} Result of the function
 */
async function withRetry(fn, options = {}) {
  const {
    retries = 0,
    delay = 1000,
    onRetry = null,
    shouldRetry = null
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (shouldRetry && !shouldRetry(error)) {
        throw error; // Don't retry this error type
      }

      if (attempt < retries) {
        // Call onRetry callback if provided
        if (onRetry) {
          onRetry(attempt + 1, error, retries);
        }

        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Create a retry wrapper with preset options
 * @param {object} defaultOptions - Default retry options
 * @returns {Function} Configured retry function
 */
function createRetrier(defaultOptions) {
  return (fn, options = {}) => withRetry(fn, { ...defaultOptions, ...options });
}

/**
 * Common shouldRetry predicates
 */
const retryPredicates = {
  // Retry on timeout errors
  onTimeout: (error) => error.message.includes('Timeout') || error.message.includes('timeout'),

  // Retry on navigation errors
  onNavigation: (error) => error.message.includes('Navigation') || error.message.includes('navigation'),

  // Retry on element not found
  onElementNotFound: (error) => error.message.includes('not found') || error.message.includes('No element'),

  // Retry on network errors
  onNetwork: (error) => error.message.includes('net::') || error.message.includes('Network'),

  // Combine multiple predicates with OR
  any: (...predicates) => (error) => predicates.some(p => p(error)),

  // Combine multiple predicates with AND
  all: (...predicates) => (error) => predicates.every(p => p(error))
};

module.exports = {
  withRetry,
  createRetrier,
  retryPredicates
};
