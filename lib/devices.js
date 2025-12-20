/**
 * Device Emulation module
 * Provides access to Playwright's device descriptors for emulation
 */

const { devices } = require('playwright');

/**
 * Get a device descriptor by name
 * @param {string} name - Device name (e.g., "iPhone 15", "Pixel 7")
 * @returns {object|null} Device descriptor or null if not found
 */
function getDevice(name) {
  return devices[name] || null;
}

/**
 * List all available device names
 * @returns {string[]} Array of device names
 */
function listDevices() {
  return Object.keys(devices);
}

/**
 * Search devices by name pattern
 * @param {string} pattern - Search pattern (case-insensitive)
 * @returns {string[]} Matching device names
 */
function searchDevices(pattern) {
  const regex = new RegExp(pattern, 'i');
  return Object.keys(devices).filter(name => regex.test(name));
}

/**
 * Get devices grouped by category
 * @returns {object} Devices grouped by type
 */
function getDevicesByCategory() {
  const categories = {
    iphone: [],
    ipad: [],
    pixel: [],
    galaxy: [],
    desktop: [],
    other: []
  };

  for (const name of Object.keys(devices)) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('iphone')) {
      categories.iphone.push(name);
    } else if (lowerName.includes('ipad')) {
      categories.ipad.push(name);
    } else if (lowerName.includes('pixel')) {
      categories.pixel.push(name);
    } else if (lowerName.includes('galaxy')) {
      categories.galaxy.push(name);
    } else if (lowerName.includes('desktop')) {
      categories.desktop.push(name);
    } else {
      categories.other.push(name);
    }
  }

  return categories;
}

/**
 * Common device shortcuts
 */
const DEVICE_SHORTCUTS = {
  // iPhones
  'iphone': 'iPhone 15',
  'iphone-pro': 'iPhone 15 Pro',
  'iphone-pro-max': 'iPhone 15 Pro Max',
  'iphone-se': 'iPhone SE',
  'iphone-14': 'iPhone 14',
  'iphone-13': 'iPhone 13',
  'iphone-12': 'iPhone 12',

  // iPads
  'ipad': 'iPad (gen 7)',
  'ipad-pro': 'iPad Pro 11',
  'ipad-mini': 'iPad Mini',

  // Android
  'pixel': 'Pixel 7',
  'pixel-pro': 'Pixel 7 Pro',
  'galaxy': 'Galaxy S9+',
  'galaxy-tab': 'Galaxy Tab S4',

  // Desktop
  'desktop': 'Desktop Chrome',
  'desktop-hd': 'Desktop Chrome HiDPI',
  'desktop-firefox': 'Desktop Firefox',
  'desktop-safari': 'Desktop Safari',
  'desktop-edge': 'Desktop Edge'
};

/**
 * Resolve device name (supports shortcuts)
 * @param {string} nameOrShortcut - Device name or shortcut
 * @returns {object|null} Device descriptor
 */
function resolveDevice(nameOrShortcut) {
  // First check if it's a shortcut
  const resolvedName = DEVICE_SHORTCUTS[nameOrShortcut.toLowerCase()] || nameOrShortcut;
  return getDevice(resolvedName);
}

/**
 * Get device info with additional metadata
 * @param {string} name - Device name
 * @returns {object|null} Device info with metadata
 */
function getDeviceInfo(name) {
  const device = getDevice(name);
  if (!device) return null;

  return {
    name,
    viewport: device.viewport,
    userAgent: device.userAgent,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    defaultBrowserType: device.defaultBrowserType
  };
}

module.exports = {
  devices,
  getDevice,
  listDevices,
  searchDevices,
  getDevicesByCategory,
  resolveDevice,
  getDeviceInfo,
  DEVICE_SHORTCUTS
};
