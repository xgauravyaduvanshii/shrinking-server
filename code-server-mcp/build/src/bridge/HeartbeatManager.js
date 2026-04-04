import fetch from "node-fetch";
export class HeartbeatManager {
    serverUrl;
    getCookie;
    onSessionExpired;
    interval = null;
    lastSuccess = null;
    consecutiveFailures = 0;
    startedAt = Date.now();
    constructor(serverUrl, getCookie, onSessionExpired) {
        this.serverUrl = serverUrl;
        this.getCookie = getCookie;
        this.onSessionExpired = onSessionExpired;
    }
    start(intervalMs = 30_000) {
        if (this.interval) {
            return;
        }
        const beat = async () => {
            try {
                const cookie = await this.getCookie();
                const response = await fetch(new URL("/healthz", this.serverUrl), {
                    headers: cookie ? { cookie } : {},
                });
                if (!response.ok) {
                    throw new Error(`Healthz returned ${response.status}`);
                }
                this.lastSuccess = new Date();
                this.consecutiveFailures = 0;
            }
            catch {
                this.consecutiveFailures += 1;
                if (this.consecutiveFailures >= 2) {
                    await this.onSessionExpired();
                    this.consecutiveFailures = 0;
                }
            }
        };
        void beat();
        this.interval = setInterval(() => {
            void beat();
        }, intervalMs);
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
    getStatus() {
        return {
            healthy: this.consecutiveFailures === 0,
            lastSuccess: this.lastSuccess,
            consecutiveFailures: this.consecutiveFailures,
            uptime: Date.now() - this.startedAt,
        };
    }
}
