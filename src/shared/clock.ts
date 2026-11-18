interface ClockSample {
  rtt: number;
  offset: number;
}

/**
 * NTP-style server clock offset. Uses the median of the lowest-RTT samples in a
 * sliding window, which rejects Wi-Fi power-save spikes.
 */
export class ClockEstimator {
  private samples: ClockSample[] = [];
  offset = 0;

  constructor(
    private readonly window = 30,
    private readonly best = 5,
  ) {}

  get sampleCount(): number {
    return this.samples.length;
  }

  /** Offset error is bounded by minRtt / 2. */
  get minRtt(): number {
    return this.samples.reduce((m, s) => Math.min(m, s.rtt), Infinity);
  }

  /** t0: client send, ts: server reply, t1: client receive. */
  add(t0: number, ts: number, t1: number): void {
    const rtt = t1 - t0;
    if (rtt < 0) return;
    this.samples.push({ rtt, offset: ts - (t0 + t1) / 2 });
    if (this.samples.length > this.window) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, this.best);
    const offsets = sorted.map((s) => s.offset).sort((a, b) => a - b);
    this.offset = offsets[Math.floor(offsets.length / 2)]!;
  }

  toServer(localMs: number): number {
    return localMs + this.offset;
  }
}

export const nowMs = (): number => performance.timeOrigin + performance.now();
