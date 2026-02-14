import { devices } from 'playwright';

export interface DevicePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent: string;
}

// Map of curated device presets sourced from Playwright's built-in devices
// API-safe IDs (kebab-case) map to canonical device names
const DEVICE_MAP: Record<string, string> = {
  'iphone-14-pro': 'iPhone 14 Pro',
  'iphone-15-pro': 'iPhone 15 Pro',
  'ipad-air': 'iPad (gen 11)', // Closest match in Playwright
  'pixel-8': 'Pixel 7', // Closest match in Playwright (Pixel 8 not available)
  'galaxy-s24': 'Galaxy S24',
  'macbook-pro-14': 'Desktop Chrome HiDPI',
  'desktop-1080p': 'Desktop Chrome',
  'desktop-4k': 'Desktop Chrome', // We'll override viewport for 4K
};

const DEVICE_PRESETS = new Map<string, DevicePreset>();

// Initialize device presets from Playwright devices
for (const [id, playwrightName] of Object.entries(DEVICE_MAP)) {
  const pwDevice = devices[playwrightName];
  if (!pwDevice) {
    throw new Error(`Playwright device not found: ${playwrightName}`);
  }

  const viewport = pwDevice.viewport;
  if (!viewport) {
    throw new Error(`Device ${playwrightName} has no viewport`);
  }

  let preset: DevicePreset = {
    id,
    name: id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: pwDevice.deviceScaleFactor ?? 1,
    isMobile: pwDevice.isMobile ?? false,
    hasTouch: pwDevice.hasTouch ?? false,
    userAgent: pwDevice.userAgent,
  };

  // Override for 4K desktop
  if (id === 'desktop-4k') {
    preset = {
      ...preset,
      name: 'Desktop 4K',
      width: 3840,
      height: 2160,
    };
  }

  DEVICE_PRESETS.set(id, preset);
}

export function getDevicePreset(id: string): DevicePreset | undefined {
  return DEVICE_PRESETS.get(id);
}

export function listDevicePresets(): DevicePreset[] {
  return Array.from(DEVICE_PRESETS.values());
}
