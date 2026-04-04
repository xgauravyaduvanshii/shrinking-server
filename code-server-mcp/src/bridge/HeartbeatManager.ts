import fetch from "node-fetch"

export class HeartbeatManager {
  private interval: NodeJS.Timeout | null = null
  private lastSuccess: Date | null = null
  private consecutiveFailures = 0
  private startedAt = Date.now()

  constructor(
    private readonly serverUrl: string,
    private readonly getCookie: () => Promise<string> | string,
    private readonly onSessionExpired: () => Promise<void>,
  ) {}

  start(intervalMs = 30_000): void {
    if (this.interval) {
      return
    }
    const beat = async () => {
      try {
        const cookie = await this.getCookie()
        const response = await fetch(new URL("/healthz", this.serverUrl), {
          headers: cookie ? { cookie } : {},
        })
        if (!response.ok) {
          throw new Error(`Healthz returned ${response.status}`)
        }
        this.lastSuccess = new Date()
        this.consecutiveFailures = 0
      } catch {
        this.consecutiveFailures += 1
        if (this.consecutiveFailures >= 2) {
          await this.onSessionExpired()
          this.consecutiveFailures = 0
        }
      }
    }

    void beat()
    this.interval = setInterval(() => {
      void beat()
    }, intervalMs)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  getStatus(): { healthy: boolean; lastSuccess: Date | null; consecutiveFailures: number; uptime: number } {
    return {
      healthy: this.consecutiveFailures === 0,
      lastSuccess: this.lastSuccess,
      consecutiveFailures: this.consecutiveFailures,
      uptime: Date.now() - this.startedAt,
    }
  }
}
