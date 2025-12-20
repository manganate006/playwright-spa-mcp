/**
 * Session management module
 * Handles saving and loading session state (cookies, localStorage)
 */

const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = '/opt/playwright-tools/sessions';

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

/**
 * Load session data from file
 * @param {BrowserContext} context - Playwright browser context
 * @param {string} sessionId - Session identifier
 * @returns {object|null} Session data or null if not found
 */
async function loadSession(context, sessionId) {
  const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (fs.existsSync(sessionFile)) {
    try {
      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      if (sessionData.cookies) {
        await context.addCookies(sessionData.cookies);
      }
      return sessionData;
    } catch (e) {
      // Invalid session file, return null
      return null;
    }
  }
  return null;
}

/**
 * Save session data to file
 * @param {BrowserContext} context - Playwright browser context
 * @param {Page} page - Playwright page
 * @param {string} sessionId - Session identifier
 * @param {string} currentUrl - Current page URL
 */
async function saveSession(context, page, sessionId, currentUrl) {
  const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.json`);
  const cookies = await context.cookies();

  // Get localStorage from page
  let localStorage = {};
  try {
    localStorage = await page.evaluate(() => {
      const items = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        items[key] = window.localStorage.getItem(key);
      }
      return items;
    });
  } catch (e) {
    // Page might not have localStorage access
  }

  fs.writeFileSync(sessionFile, JSON.stringify({
    cookies,
    localStorage,
    lastUrl: currentUrl,
    savedAt: Date.now()
  }, null, 2));
}

/**
 * Restore localStorage to page
 * @param {Page} page - Playwright page
 * @param {object} localStorageData - localStorage key-value pairs
 */
async function restoreLocalStorage(page, localStorageData) {
  if (localStorageData && Object.keys(localStorageData).length > 0) {
    await page.evaluate((items) => {
      for (const [key, value] of Object.entries(items)) {
        window.localStorage.setItem(key, value);
      }
    }, localStorageData);
  }
}

/**
 * Get session file path
 * @param {string} sessionId - Session identifier
 * @returns {string} Full path to session file
 */
function getSessionPath(sessionId) {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

/**
 * Delete session file
 * @param {string} sessionId - Session identifier
 */
function deleteSession(sessionId) {
  const sessionFile = getSessionPath(sessionId);
  if (fs.existsSync(sessionFile)) {
    fs.unlinkSync(sessionFile);
  }
}

/**
 * List all sessions
 * @returns {string[]} Array of session IDs
 */
function listSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    return [];
  }
  return fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

module.exports = {
  loadSession,
  saveSession,
  restoreLocalStorage,
  getSessionPath,
  deleteSession,
  listSessions,
  SESSIONS_DIR
};
