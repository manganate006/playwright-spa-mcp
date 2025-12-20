/**
 * Chain executor module
 * Executes a series of actions in sequence
 */

const { actions, getTimestampedPath } = require('./actions');
const { waitForDomIdle, waitForSpaStable, typeRealistic } = require('./spa-utils');
const { httpActions } = require('./http-actions');

/**
 * Special chain-only actions
 */
const chainActions = {
  /**
   * Wait for a specified number of milliseconds
   */
  async wait(page, args) {
    const ms = args.ms || args.value || 1000;
    await page.waitForTimeout(ms);
    return { success: true, action: 'wait', ms };
  },

  /**
   * Wait for an element to appear
   */
  async 'wait-for'(page, args) {
    const selector = args.selector;
    const timeout = args.timeout || 30000;

    if (!selector) {
      throw new Error('selector is required for wait-for action');
    }

    await page.waitForSelector(selector, { timeout });
    return { success: true, action: 'wait-for', selector };
  },

  /**
   * Wait for DOM to become idle (no mutations)
   */
  async 'wait-for-idle'(page, args) {
    const idleTime = args.ms || args.idleTime || 500;
    const maxWait = args.maxWait || 10000;

    await waitForDomIdle(page, idleTime, maxWait);
    return { success: true, action: 'wait-for-idle', idleTime };
  },

  /**
   * Wait for SPA framework to stabilize
   */
  async 'wait-for-spa'(page, args) {
    const mode = args.spaMode || args.mode || 'auto';
    const timeout = args.timeout || 5000;

    await waitForSpaStable(page, mode, { timeout });
    return { success: true, action: 'wait-for-spa', mode };
  },

  /**
   * Type text realistically with delays
   */
  async 'type-realistic'(page, args) {
    if (!args.selector) {
      throw new Error('selector is required for type-realistic action');
    }
    if (!args.value) {
      throw new Error('value is required for type-realistic action');
    }

    const delay = args.typingDelay || args.delay || 50;
    const clearFirst = args.clearFirst !== false;

    await typeRealistic(page, args.selector, args.value, {
      delay,
      clearFirst,
      triggerBlur: true
    });

    // Wait for SPA to process if spa mode is set
    if (args.spaMode) {
      await waitForSpaStable(page, args.spaMode);
    }

    const filename = getTimestampedPath('after-type-realistic');
    await page.screenshot({ path: filename });

    return {
      success: true,
      file: filename,
      action: 'type-realistic',
      selector: args.selector
    };
  },

  /**
   * Clear an input field
   */
  async clear(page, args) {
    if (!args.selector) {
      throw new Error('selector is required for clear action');
    }

    await page.fill(args.selector, '');
    return { success: true, action: 'clear', selector: args.selector };
  },

  /**
   * Press a key or key combination
   */
  async press(page, args) {
    const key = args.key || args.value;
    if (!key) {
      throw new Error('key is required for press action');
    }

    if (args.selector) {
      await page.press(args.selector, key);
    } else {
      await page.keyboard.press(key);
    }

    return { success: true, action: 'press', key };
  },

  /**
   * Focus an element
   */
  async focus(page, args) {
    if (!args.selector) {
      throw new Error('selector is required for focus action');
    }

    await page.focus(args.selector);
    return { success: true, action: 'focus', selector: args.selector };
  },

  /**
   * Blur the currently focused element
   */
  async blur(page, args) {
    await page.evaluate(() => {
      if (document.activeElement) {
        document.activeElement.blur();
      }
    });
    return { success: true, action: 'blur' };
  }
};

/**
 * Get action handler (from chain actions, regular actions, or HTTP actions)
 */
function getActionHandler(actionName) {
  return chainActions[actionName] || actions[actionName] || httpActions[actionName];
}

/**
 * Execute a chain of actions
 * @param {Page} page - Playwright page
 * @param {Array} chain - Array of action objects
 * @param {object} globalArgs - Global arguments to merge with each action
 * @param {object} options - Execution options
 * @returns {object} Execution result with all step results
 */
async function executeChain(page, chain, globalArgs = {}, options = {}) {
  const {
    stopOnError = true,
    consoleLogs = [],
    debugLog = () => {}
  } = options;

  const results = [];
  let lastScreenshot = null;

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const actionName = step.action;

    debugLog(`Executing step ${i + 1}/${chain.length}: ${actionName}`);

    try {
      // Merge global args with step-specific args
      // Step args take precedence
      const args = {
        ...globalArgs,
        ...step,
        // Ensure numeric values are parsed
        timeout: parseInt(step.timeout || globalArgs.timeout) || 30000,
        typingDelay: parseInt(step.typingDelay || step.delay || globalArgs.typingDelay) || 50
      };

      // Get action handler
      const handler = getActionHandler(actionName);
      if (!handler) {
        throw new Error(`Unknown action: ${actionName}`);
      }

      // Execute action
      const result = await handler(page, args, consoleLogs);

      // Track last screenshot for reference
      if (result.file) {
        lastScreenshot = result.file;
      }

      results.push({
        step: i,
        action: actionName,
        ...result
      });

      debugLog(`Step ${i + 1} completed successfully`);

    } catch (error) {
      debugLog(`Step ${i + 1} failed: ${error.message}`);

      // Take error screenshot
      let errorScreenshot = null;
      try {
        errorScreenshot = getTimestampedPath('error');
        await page.screenshot({ path: errorScreenshot });
      } catch (e) {
        // Ignore screenshot error
      }

      const errorResult = {
        success: false,
        failedAt: i,
        failedAction: actionName,
        error: error.message,
        errorScreenshot,
        completedSteps: results,
        currentUrl: page.url()
      };

      if (consoleLogs.length > 0) {
        errorResult.consoleLogs = consoleLogs;
      }

      if (stopOnError) {
        return errorResult;
      }

      // Continue execution but record error
      results.push({
        step: i,
        action: actionName,
        success: false,
        error: error.message
      });
    }
  }

  // All steps completed successfully
  const successResult = {
    success: true,
    results,
    totalSteps: chain.length,
    currentUrl: page.url()
  };

  if (lastScreenshot) {
    successResult.lastScreenshot = lastScreenshot;
  }

  if (consoleLogs.length > 0) {
    successResult.consoleLogs = consoleLogs;
  }

  return successResult;
}

/**
 * Parse chain from JSON string or file
 * @param {string} chainInput - JSON string or file path
 * @returns {Array} Parsed chain array
 */
function parseChain(chainInput) {
  if (!chainInput) {
    throw new Error('Chain input is required');
  }

  // Try to parse as JSON directly
  try {
    return JSON.parse(chainInput);
  } catch (e) {
    throw new Error(`Invalid chain JSON: ${e.message}`);
  }
}

/**
 * Validate chain structure
 * @param {Array} chain - Chain to validate
 * @returns {object} Validation result
 */
function validateChain(chain) {
  if (!Array.isArray(chain)) {
    return { valid: false, error: 'Chain must be an array' };
  }

  if (chain.length === 0) {
    return { valid: false, error: 'Chain cannot be empty' };
  }

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];

    if (!step.action) {
      return {
        valid: false,
        error: `Step ${i} is missing required 'action' property`
      };
    }

    const handler = getActionHandler(step.action);
    if (!handler) {
      return {
        valid: false,
        error: `Step ${i} has unknown action: ${step.action}`
      };
    }
  }

  return { valid: true };
}

/**
 * List all available actions (regular + chain-only + HTTP)
 */
function listAvailableActions() {
  return {
    regular: Object.keys(actions),
    chainOnly: Object.keys(chainActions),
    http: Object.keys(httpActions),
    all: [...new Set([...Object.keys(actions), ...Object.keys(chainActions), ...Object.keys(httpActions)])]
  };
}

module.exports = {
  executeChain,
  parseChain,
  validateChain,
  getActionHandler,
  listAvailableActions,
  chainActions
};
