import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock nodemailer before any imports that use it
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-message-id' }),
      verify: vi.fn().mockResolvedValue(true),
    })),
  },
}));

// Mock ioredis for usage monitor tests
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisHget = vi.fn();
const mockRedisHset = vi.fn();
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
    hget: mockRedisHget,
    hset: mockRedisHset,
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
  })),
}));

import {
  renderWelcomeEmail,
  renderEmailVerification,
  renderPasswordReset,
  renderQuotaWarning,
  renderQuotaExceeded,
  renderPaymentFailed,
  renderSubscriptionChanged,
} from '../../src/email/templates.js';
import { sendEmail } from '../../src/email/index.js';
import { getWarningThreshold } from '../../src/email/usage-monitor.js';

describe('Email Templates', () => {
  describe('renderWelcomeEmail', () => {
    it('renders with correct subject, html, and text', () => {
      const result = renderWelcomeEmail({
        email: 'user@example.com',
        apiKeyPrefix: 'sf_test_abc',
        dashboardUrl: 'https://screenforge.dev/dashboard',
        docsUrl: 'https://screenforge.dev/docs',
      });

      expect(result.subject).toBe('Welcome to ScreenForge!');
      expect(result.html).toContain('user@example.com');
      expect(result.html).toContain('sf_test_abc');
      expect(result.html).toContain('https://screenforge.dev/dashboard');
      expect(result.html).toContain('https://screenforge.dev/docs');
      expect(result.text).toContain('user@example.com');
      expect(result.text).toContain('sf_test_abc');
    });
  });

  describe('renderEmailVerification', () => {
    it('renders verification link in html and text', () => {
      const result = renderEmailVerification({
        email: 'user@example.com',
        verifyUrl: 'https://screenforge.dev/auth/verify-email/abc123',
      });

      expect(result.subject).toContain('Verify');
      expect(result.html).toContain('https://screenforge.dev/auth/verify-email/abc123');
      expect(result.text).toContain('https://screenforge.dev/auth/verify-email/abc123');
    });
  });

  describe('renderPasswordReset', () => {
    it('renders reset link in html and text', () => {
      const result = renderPasswordReset({
        email: 'user@example.com',
        resetUrl: 'https://screenforge.dev/auth/reset-password/token123',
      });

      expect(result.subject).toContain('Reset');
      expect(result.html).toContain('https://screenforge.dev/auth/reset-password/token123');
      expect(result.text).toContain('https://screenforge.dev/auth/reset-password/token123');
    });
  });

  describe('renderQuotaWarning', () => {
    it('renders 80% warning with usage stats', () => {
      const result = renderQuotaWarning({
        email: 'user@example.com',
        currentUsage: 4000,
        monthlyQuota: 5000,
        percentage: 80,
        upgradeUrl: 'https://screenforge.dev/dashboard/billing',
      });

      expect(result.subject).toContain('80%');
      expect(result.html).toContain('4,000');
      expect(result.html).toContain('5,000');
      expect(result.html).toContain('80%');
      expect(result.html).toContain('https://screenforge.dev/dashboard/billing');
      expect(result.text).toContain('4,000');
    });

    it('renders 95% warning with usage stats', () => {
      const result = renderQuotaWarning({
        email: 'user@example.com',
        currentUsage: 4750,
        monthlyQuota: 5000,
        percentage: 95,
        upgradeUrl: 'https://screenforge.dev/dashboard/billing',
      });

      expect(result.subject).toContain('95%');
      expect(result.html).toContain('4,750');
      expect(result.html).toContain('95%');
    });
  });

  describe('renderQuotaExceeded', () => {
    it('renders exceeded notice with upgrade link', () => {
      const result = renderQuotaExceeded({
        email: 'user@example.com',
        currentUsage: 5100,
        monthlyQuota: 5000,
        upgradeUrl: 'https://screenforge.dev/dashboard/billing',
      });

      expect(result.subject).toContain('exceeded');
      expect(result.html).toContain('5,100');
      expect(result.html).toContain('5,000');
      expect(result.html).toContain('https://screenforge.dev/dashboard/billing');
      expect(result.text).toContain('exceeded');
    });
  });

  describe('renderPaymentFailed', () => {
    it('renders payment failure with billing portal link', () => {
      const result = renderPaymentFailed({
        email: 'user@example.com',
        billingUrl: 'https://screenforge.dev/v1/billing/portal',
      });

      expect(result.subject).toContain('Payment');
      expect(result.html).toContain('https://screenforge.dev/v1/billing/portal');
      expect(result.text).toContain('payment');
    });
  });

  describe('renderSubscriptionChanged', () => {
    it('renders upgrade confirmation', () => {
      const result = renderSubscriptionChanged({
        email: 'user@example.com',
        oldPlan: 'Starter',
        newPlan: 'Pro',
        dashboardUrl: 'https://screenforge.dev/dashboard/billing',
      });

      expect(result.subject).toContain('changed');
      expect(result.html).toContain('Starter');
      expect(result.html).toContain('Pro');
      expect(result.text).toContain('Starter');
      expect(result.text).toContain('Pro');
    });

    it('renders downgrade confirmation', () => {
      const result = renderSubscriptionChanged({
        email: 'user@example.com',
        oldPlan: 'Pro',
        newPlan: 'Starter',
        dashboardUrl: 'https://screenforge.dev/dashboard/billing',
      });

      expect(result.html).toContain('Pro');
      expect(result.html).toContain('Starter');
    });
  });

  describe('every template has subject, html, and text', () => {
    const templates = [
      { name: 'welcome', fn: () => renderWelcomeEmail({ email: 'a@b.com', apiKeyPrefix: 'sf_x', dashboardUrl: 'http://x', docsUrl: 'http://x' }) },
      { name: 'email-verification', fn: () => renderEmailVerification({ email: 'a@b.com', verifyUrl: 'http://x' }) },
      { name: 'password-reset', fn: () => renderPasswordReset({ email: 'a@b.com', resetUrl: 'http://x' }) },
      { name: 'quota-warning', fn: () => renderQuotaWarning({ email: 'a@b.com', currentUsage: 80, monthlyQuota: 100, percentage: 80, upgradeUrl: 'http://x' }) },
      { name: 'quota-exceeded', fn: () => renderQuotaExceeded({ email: 'a@b.com', currentUsage: 100, monthlyQuota: 100, upgradeUrl: 'http://x' }) },
      { name: 'payment-failed', fn: () => renderPaymentFailed({ email: 'a@b.com', billingUrl: 'http://x' }) },
      { name: 'subscription-changed', fn: () => renderSubscriptionChanged({ email: 'a@b.com', oldPlan: 'Free', newPlan: 'Pro', dashboardUrl: 'http://x' }) },
    ];

    for (const { name, fn } of templates) {
      it(`${name} template has subject, html, and text`, () => {
        const result = fn();
        expect(result.subject).toBeTruthy();
        expect(typeof result.subject).toBe('string');
        expect(result.html).toBeTruthy();
        expect(typeof result.html).toBe('string');
        expect(result.text).toBeTruthy();
        expect(typeof result.text).toBe('string');
      });
    }
  });
});

describe('Email Sender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips sending and logs warning when SMTP not configured', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
      text: 'Test',
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('smtp_not_configured');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('SMTP not configured'),
    );

    warnSpy.mockRestore();
  });

  it('sends email when SMTP is configured', async () => {
    const nodemailer = await import('nodemailer');
    const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
    vi.mocked(nodemailer.default.createTransport).mockReturnValue({
      sendMail: mockSendMail,
      verify: vi.fn().mockResolvedValue(true),
    } as unknown as ReturnType<typeof nodemailer.default.createTransport>);

    const result = await sendEmail(
      {
        to: 'user@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
        text: 'Hello',
      },
      {
        host: 'smtp.example.com',
        port: 587,
        user: 'apikey',
        pass: 'secret',
        from: 'noreply@screenforge.dev',
      },
    );

    expect(result.sent).toBe(true);
    expect(result.messageId).toBe('test-id');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
        text: 'Hello',
        from: 'noreply@screenforge.dev',
      }),
    );
  });
});

describe('Usage Monitor — Threshold Logic', () => {
  describe('getWarningThreshold', () => {
    it('returns null at 79% usage', () => {
      expect(getWarningThreshold(79, 100)).toBeNull();
    });

    it('returns 80 at exactly 80% usage', () => {
      expect(getWarningThreshold(80, 100)).toBe(80);
    });

    it('returns 80 at 85% usage (between 80 and 95)', () => {
      expect(getWarningThreshold(85, 100)).toBe(80);
    });

    it('returns 95 at exactly 95% usage', () => {
      expect(getWarningThreshold(95, 100)).toBe(95);
    });

    it('returns 95 at 99% usage', () => {
      expect(getWarningThreshold(99, 100)).toBe(95);
    });

    it('returns 100 at exactly 100% usage', () => {
      expect(getWarningThreshold(100, 100)).toBe(100);
    });

    it('returns 100 at over 100% usage', () => {
      expect(getWarningThreshold(120, 100)).toBe(100);
    });

    it('returns null for zero quota', () => {
      expect(getWarningThreshold(50, 0)).toBeNull();
    });
  });
});
