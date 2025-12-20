/**
 * Session Manager module
 * Manages browser sessions for the daemon process
 */

const { chromium } = require('playwright');
const { executeChain } = require('./chain-executor');

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Session Manager class
 * Manages multiple browser sessions with automatic cleanup
 */
class SessionManager {
  /**
   * Create a new session manager
   * @param {object} options - Manager options
   */
  constructor(options = {}) {
    this.sessions = new Map();
    this.idleTimeout = options.idleTimeout || 300000; // 5 minutes default
    this.maxSessions = options.maxSessions || 10;
    this.defaultTimeout = options.defaultTimeout || 30000;
    this.debugLog = options.debugLog || (() => {});

    // Start idle cleanup interval
    this.cleanupInterval = setInterval(
      () => this.cleanupIdleSessions(),
      60000 // Check every minute
    );
  }

  /**
   * Get or create a session
   * @param {string} sessionId - Session identifier
   * @param {object} options - Session options
   * @returns {Promise<object>} Session object
   */
  async getOrCreate(sessionId, options = {}) {
    // Return existing session if available
    if (this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      session.lastActivity = Date.now();
      this.debugLog(`Reusing existing session: ${sessionId}`);
      return session;
    }

    // Check max sessions limit
    if (this.sessions.size >= this.maxSessions) {
      // Close oldest idle session
      await this.closeOldestSession();
    }

    this.debugLog(`Creating new session: ${sessionId}`);

    // Create new browser and context
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const viewport = options.viewport || DEFAULT_VIEWPORT;
    const context = await browser.newContext({
      viewport,
      userAgent: DEFAULT_USER_AGENT
    });

    const page = await context.newPage();
    page.setDefaultTimeout(options.timeout || this.defaultTimeout);

    // Setup console log capture
    const consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location()
      });
    });

    page.on('pageerror', error => {
      consoleLogs.push({
        type: 'pageerror',
        text: error.message,
        stack: error.stack
      });
    });

    const session = {
      id: sessionId,
      browser,
      context,
      page,
      consoleLogs,
      currentUrl: null,
      created: Date.now(),
      lastActivity: Date.now()
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Execute actions on a session
   * @param {string} sessionId - Session identifier
   * @param {Array} actions - Actions to execute
   * @param {object} options - Execution options
   * @returns {Promise<object>} Execution result
   */
  async execute(sessionId, actions, options = {}) {
    const session = await this.getOrCreate(sessionId, options);
    const { page, consoleLogs } = session;

    // Clear previous console logs
    consoleLogs.length = 0;

    // Handle navigation
    if (options.url && !options.noNavigate) {
      const currentUrl = page.url();

      // Only navigate if URL is different
      if (currentUrl !== options.url && currentUrl !== options.url + '/') {
        this.debugLog(`Navigating to: ${options.url}`);
        try {
          await page.goto(options.url, {
            waitUntil: 'networkidle',
            timeout: options.timeout || this.defaultTimeout
          });
        } catch (e) {
          // If networkidle times out, try with load
          if (e.message.includes('Timeout')) {
            await page.goto(options.url, {
              waitUntil: 'load',
              timeout: options.timeout || this.defaultTimeout
            });
          } else {
            throw e;
          }
        }
        session.currentUrl = options.url;
      } else {
        this.debugLog(`Already at URL: ${currentUrl}`);
      }
    }

    // Execute the action chain
    const result = await executeChain(page, actions, {
      spaMode: options.spaMode,
      waitForIdle: options.waitForIdle,
      timeout: options.timeout || this.defaultTimeout,
      typingDelay: options.typingDelay
    }, {
      consoleLogs,
      debugLog: this.debugLog
    });

    // Update session state
    session.lastActivity = Date.now();
    session.currentUrl = page.url();

    return {
      ...result,
      sessionInfo: {
        id: sessionId,
        currentUrl: session.currentUrl,
        created: session.created,
        lastActivity: session.lastActivity
      }
    };
  }

  /**
   * Close a specific session
   * @param {string} sessionId - Session to close
   */
  async closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.debugLog(`Closing session: ${sessionId}`);
      try {
        await session.browser.close();
      } catch (e) {
        // Browser might already be closed
      }
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Close the oldest session
   */
  async closeOldestSession() {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [id, session] of this.sessions) {
      if (session.lastActivity < oldestTime) {
        oldestTime = session.lastActivity;
        oldest = id;
      }
    }

    if (oldest) {
      await this.closeSession(oldest);
    }
  }

  /**
   * Cleanup idle sessions
   */
  async cleanupIdleSessions() {
    const now = Date.now();
    const sessionsToClose = [];

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.idleTimeout) {
        sessionsToClose.push(id);
      }
    }

    for (const id of sessionsToClose) {
      this.debugLog(`Closing idle session: ${id}`);
      await this.closeSession(id);
    }
  }

  /**
   * Get session info
   * @param {string} sessionId - Session to get info for
   * @returns {object|null} Session info or null
   */
  getSessionInfo(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      currentUrl: session.currentUrl,
      created: session.created,
      lastActivity: session.lastActivity,
      age: Date.now() - session.created,
      idle: Date.now() - session.lastActivity
    };
  }

  /**
   * List all sessions
   * @returns {Array} Session info array
   */
  listSessions() {
    const sessions = [];
    for (const [id] of this.sessions) {
      sessions.push(this.getSessionInfo(id));
    }
    return sessions;
  }

  /**
   * Get manager status
   * @returns {object} Status info
   */
  getStatus() {
    return {
      activeSessions: this.sessions.size,
      maxSessions: this.maxSessions,
      idleTimeout: this.idleTimeout,
      sessions: this.listSessions()
    };
  }

  /**
   * Close all sessions and cleanup
   */
  async closeAll() {
    clearInterval(this.cleanupInterval);

    const closePromises = [];
    for (const [id] of this.sessions) {
      closePromises.push(this.closeSession(id));
    }

    await Promise.all(closePromises);
    this.sessions.clear();
  }
}

module.exports = { SessionManager };
