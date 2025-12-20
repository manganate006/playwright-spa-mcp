/**
 * SPA utilities module
 * Detection and waiting utilities for React, Vue, Angular, and generic SPAs
 */

/**
 * Wait for React to finish rendering
 * Works with React 16+ using fiber internals
 * @param {Page} page - Playwright page
 * @param {number} timeout - Timeout in ms (default: 5000)
 */
async function waitForReact(page, timeout = 5000) {
  await page.waitForFunction(() => {
    // Look for common React root elements
    const root = document.querySelector('[data-reactroot], #root, #__next, #app');
    if (!root) return true; // No React detected, continue

    // Check for React fiber (React 16+)
    const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) return true; // No fiber found, might be older React or not React

    // Check if React is in a pending state
    try {
      const fiber = root[fiberKey];
      // If there's no pending work, React is idle
      if (fiber?.memoizedState?.pending) {
        return false; // Still pending
      }
    } catch (e) {
      // Error accessing fiber, assume ready
    }

    return true;
  }, { timeout }).catch(() => {
    // Timeout is acceptable, we tried our best
  });
}

/**
 * Wait for Vue to finish updating
 * @param {Page} page - Playwright page
 * @param {number} timeout - Timeout in ms (default: 5000)
 */
async function waitForVue(page, timeout = 5000) {
  await page.waitForFunction(() => {
    // Check for Vue 3
    const app = document.querySelector('#app, [data-v-app]');
    if (app && app.__vue_app__) {
      // Vue 3 detected
      return true; // Vue 3 doesn't expose pending state easily
    }

    // Check for Vue 2
    if (app && app.__vue__) {
      const vm = app.__vue__;
      // Check if watcher queue is empty
      return !vm._watcher || !vm._watcher.dirty;
    }

    return true; // No Vue detected
  }, { timeout }).catch(() => {});
}

/**
 * Wait for Angular to stabilize
 * @param {Page} page - Playwright page
 * @param {number} timeout - Timeout in ms (default: 5000)
 */
async function waitForAngular(page, timeout = 5000) {
  await page.waitForFunction(() => {
    // Check for Angular
    const ngRoot = document.querySelector('[ng-version], [ng-app], app-root');
    if (!ngRoot) return true; // No Angular detected

    // Check for Zone.js stability (Angular uses this)
    if (window.getAllAngularTestabilities) {
      const testabilities = window.getAllAngularTestabilities();
      return testabilities.every(t => t.isStable());
    }

    // For older Angular or if testabilities not available
    if (window.angular && window.angular.element) {
      const injector = window.angular.element(ngRoot).injector();
      if (injector) {
        const $browser = injector.get('$browser');
        return $browser && $browser.outstandingRequestCount === 0;
      }
    }

    return true;
  }, { timeout }).catch(() => {});
}

/**
 * Wait for DOM mutations to stop (generic SPA idle detection)
 * @param {Page} page - Playwright page
 * @param {number} idleTime - Time without mutations to consider idle (default: 500ms)
 * @param {number} maxWait - Maximum wait time (default: 10000ms)
 */
async function waitForDomIdle(page, idleTime = 500, maxWait = 10000) {
  await page.evaluate(({ idleTime, maxWait }) => {
    return new Promise((resolve) => {
      let timer;
      let maxTimer;

      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          clearTimeout(maxTimer);
          observer.disconnect();
          resolve();
        }, idleTime);
      });

      // Start observing
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });

      // Initial idle timer (in case no mutations happen)
      timer = setTimeout(() => {
        clearTimeout(maxTimer);
        observer.disconnect();
        resolve();
      }, idleTime);

      // Maximum wait timer
      maxTimer = setTimeout(() => {
        clearTimeout(timer);
        observer.disconnect();
        resolve();
      }, maxWait);
    });
  }, { idleTime, maxWait });
}

/**
 * Wait for network to be idle (no pending requests)
 * @param {Page} page - Playwright page
 * @param {number} idleTime - Time without requests to consider idle (default: 500ms)
 */
async function waitForNetworkIdle(page, idleTime = 500) {
  await page.waitForLoadState('networkidle', { timeout: idleTime * 10 }).catch(() => {});
}

/**
 * Wait for SPA to stabilize based on framework
 * @param {Page} page - Playwright page
 * @param {string} mode - SPA mode: 'react', 'vue', 'angular', 'generic', 'auto'
 * @param {object} options - Additional options
 */
async function waitForSpaStable(page, mode = 'auto', options = {}) {
  const { timeout = 5000, idleTime = 500 } = options;

  switch (mode) {
    case 'react':
      await waitForReact(page, timeout);
      break;

    case 'vue':
      await waitForVue(page, timeout);
      break;

    case 'angular':
      await waitForAngular(page, timeout);
      break;

    case 'generic':
      await waitForDomIdle(page, idleTime, timeout);
      break;

    case 'auto':
    default:
      // Try to detect framework and wait accordingly
      const framework = await detectFramework(page);
      if (framework === 'react') {
        await waitForReact(page, timeout);
      } else if (framework === 'vue') {
        await waitForVue(page, timeout);
      } else if (framework === 'angular') {
        await waitForAngular(page, timeout);
      } else {
        await waitForDomIdle(page, idleTime, timeout);
      }
      break;
  }

  // Always wait for network idle as well
  await waitForNetworkIdle(page, idleTime);
}

/**
 * Detect which SPA framework is being used
 * @param {Page} page - Playwright page
 * @returns {Promise<string>} Framework name or 'unknown'
 */
async function detectFramework(page) {
  return page.evaluate(() => {
    // Check for React
    if (document.querySelector('[data-reactroot]') ||
        document.querySelector('#root')?.__reactFiber$) {
      return 'react';
    }

    // Check for Next.js (React-based)
    if (document.querySelector('#__next')) {
      return 'react';
    }

    // Check for Vue
    if (document.querySelector('[data-v-app]') ||
        document.querySelector('#app')?.__vue__ ||
        document.querySelector('#app')?.__vue_app__) {
      return 'vue';
    }

    // Check for Angular
    if (document.querySelector('[ng-version]') ||
        document.querySelector('app-root') ||
        window.getAllAngularTestabilities) {
      return 'angular';
    }

    return 'unknown';
  });
}

/**
 * Type text realistically with delays between keystrokes
 * Properly triggers React/Vue/Angular input handlers
 * @param {Page} page - Playwright page
 * @param {string} selector - Element selector
 * @param {string} text - Text to type
 * @param {object} options - Typing options
 */
async function typeRealistic(page, selector, text, options = {}) {
  const { delay = 50, clearFirst = true, triggerBlur = true } = options;

  // Focus the element
  await page.focus(selector);

  // Clear existing content if requested
  if (clearFirst) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.value = '';
        // Trigger input event to notify React/Vue
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, selector);
  }

  // Type character by character
  for (const char of text) {
    await page.keyboard.type(char);
    if (delay > 0) {
      await page.waitForTimeout(delay);
    }
  }

  // Trigger blur to finalize React/Vue state updates
  if (triggerBlur) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      }
    }, selector);
  }
}

/**
 * Fill input with React/Vue compatible events
 * @param {Page} page - Playwright page
 * @param {string} selector - Element selector
 * @param {string} value - Value to fill
 */
async function fillWithEvents(page, selector, value) {
  await page.evaluate(({ selector, value }) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);

    // Set value directly
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    // Dispatch events in order
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value });
}

module.exports = {
  waitForReact,
  waitForVue,
  waitForAngular,
  waitForDomIdle,
  waitForNetworkIdle,
  waitForSpaStable,
  detectFramework,
  typeRealistic,
  fillWithEvents
};
