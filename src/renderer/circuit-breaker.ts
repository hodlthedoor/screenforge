export enum CircuitState {
  Closed = 0,
  HalfOpen = 1,
  Open = 2,
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.Closed;
  private failures: number[] = []; // timestamps of failures
  private lastFailureTime = 0;
  private openedAt = 0;
  private probePending = false;

  constructor(
    private readonly threshold: number,
    private readonly failureWindowMs: number,
    private readonly cooldownMs: number
  ) {}

  canRequest(): boolean {
    this.updateState();

    if (this.state === CircuitState.Closed) {
      return true;
    }

    if (this.state === CircuitState.HalfOpen) {
      // Allow one probe request
      return !this.probePending;
    }

    // State is Open
    return false;
  }

  recordSuccess(): void {
    if (this.state === CircuitState.HalfOpen) {
      // Successful probe - close the circuit
      this.state = CircuitState.Closed;
      this.probePending = false;
    }

    // Reset failure tracking
    this.failures = [];
    this.lastFailureTime = 0;
  }

  recordFailure(): void {
    const now = Date.now();
    this.lastFailureTime = now;

    if (this.state === CircuitState.HalfOpen) {
      // Failed probe - reopen circuit
      this.state = CircuitState.Open;
      this.openedAt = now;
      this.probePending = false;
      return;
    }

    // Add failure and clean old ones outside window
    this.failures.push(now);
    this.failures = this.failures.filter(
      (timestamp) => now - timestamp < this.failureWindowMs
    );

    // Check if threshold reached
    if (this.failures.length >= this.threshold) {
      this.state = CircuitState.Open;
      this.openedAt = now;
    }
  }

  recordProbeAttempt(): void {
    if (this.state === CircuitState.HalfOpen) {
      this.probePending = true;
    }
  }

  getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  private updateState(): void {
    if (this.state === CircuitState.Open) {
      const now = Date.now();
      if (now - this.openedAt >= this.cooldownMs) {
        this.state = CircuitState.HalfOpen;
        this.probePending = false;
      }
    }
  }
}
