import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitState } from '../../src/renderer/circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('starts in closed state', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);
    expect(breaker.getState()).toBe(CircuitState.Closed);
    expect(breaker.canRequest()).toBe(true);
  });

  it('remains closed after successful requests', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);
    breaker.recordSuccess();
    breaker.recordSuccess();
    expect(breaker.getState()).toBe(CircuitState.Closed);
    expect(breaker.canRequest()).toBe(true);
  });

  it('remains closed with failures below threshold', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.Closed);
    expect(breaker.canRequest()).toBe(true);
  });

  it('opens circuit when failures reach threshold', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.Open);
    expect(breaker.canRequest()).toBe(false);
  });

  it('resets failure count on success', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.Closed);
  });

  it('ignores failures outside the time window', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);
    breaker.recordFailure();
    breaker.recordFailure();

    // Advance time beyond failure window
    vi.advanceTimersByTime(61_000);

    breaker.recordFailure();
    // Should only count the recent failure, circuit stays closed
    expect(breaker.getState()).toBe(CircuitState.Closed);
  });

  it('transitions to half-open after cooldown period', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);

    // Open the circuit
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.Open);

    // Advance time to end of cooldown
    vi.advanceTimersByTime(30_000);

    expect(breaker.getState()).toBe(CircuitState.HalfOpen);
    expect(breaker.canRequest()).toBe(true);
  });

  it('rejects requests while circuit is open before cooldown', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.canRequest()).toBe(false);

    // Advance time partway through cooldown
    vi.advanceTimersByTime(15_000);
    expect(breaker.canRequest()).toBe(false);
  });

  it('closes circuit on successful probe in half-open state', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);

    // Open the circuit
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    // Wait for half-open
    vi.advanceTimersByTime(30_000);
    expect(breaker.getState()).toBe(CircuitState.HalfOpen);

    // Successful probe closes circuit
    breaker.recordSuccess();
    expect(breaker.getState()).toBe(CircuitState.Closed);
    expect(breaker.canRequest()).toBe(true);
  });

  it('reopens circuit on failed probe in half-open state', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);

    // Open the circuit
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    // Wait for half-open
    vi.advanceTimersByTime(30_000);
    expect(breaker.getState()).toBe(CircuitState.HalfOpen);

    // Failed probe reopens circuit
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.Open);
    expect(breaker.canRequest()).toBe(false);
  });

  it('allows only one probe request in half-open state', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);

    // Open the circuit
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    // Wait for half-open
    vi.advanceTimersByTime(30_000);
    expect(breaker.getState()).toBe(CircuitState.HalfOpen);
    expect(breaker.canRequest()).toBe(true);

    // Mark that we're probing
    breaker.recordProbeAttempt();

    // Further requests should be rejected until probe completes
    expect(breaker.canRequest()).toBe(false);
  });

  it('handles rapid consecutive failures', () => {
    const breaker = new CircuitBreaker(5, 60_000, 30_000);

    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }

    expect(breaker.getState()).toBe(CircuitState.Open);
  });

  it('returns numeric state for metrics', () => {
    const breaker = new CircuitBreaker(3, 60_000, 30_000);

    expect(breaker.getState()).toBe(0); // Closed

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(2); // Open

    vi.advanceTimersByTime(30_000);
    expect(breaker.getState()).toBe(1); // HalfOpen
  });
});
