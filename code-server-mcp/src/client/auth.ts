import { CookieJar } from "tough-cookie"
import fetch, { Headers } from "node-fetch"
import { logger } from "../utils/logger.js"

export class CodeServerAuth {
  private readonly jar = new CookieJar()

  constructor(
    private readonly baseUrl: string,
    private readonly password?: string,
    private readonly token?: string,
  ) {}

  private withToken(url: URL): URL {
    if (this.token) {
      url.searchParams.set("tkn", this.token)
    }
    return url
  }

  async login(): Promise<string> {
    if (this.token) {
      return `token:${this.token}`
    }
    if (!this.password) {
      logger.info("Using unauthenticated code-server session", { baseUrl: this.baseUrl })
      return ""
    }

    const loginUrl = this.withToken(new URL("/login", this.baseUrl))
    const body = new URLSearchParams({ password: this.password })
    const response = await fetch(loginUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    })

    const setCookie = response.headers.raw()["set-cookie"] ?? []
    for (const cookie of setCookie) {
      await this.jar.setCookie(cookie, this.baseUrl)
    }

    if (response.status >= 400) {
      throw new Error(`Failed to login to code-server: HTTP ${response.status}`)
    }

    const cookieString = await this.jar.getCookieString(this.baseUrl)
    logger.info("Authenticated against code-server", { baseUrl: this.baseUrl, hasCookie: Boolean(cookieString) })
    return cookieString
  }

  async validateSession(): Promise<boolean> {
    const headers = await this.getAuthHeaders()
    const url = this.withToken(new URL("/healthz", this.baseUrl))
    const response = await fetch(url, { headers })
    return response.ok
  }

  async refreshIfNeeded(): Promise<void> {
    const valid = await this.validateSession().catch(() => false)
    if (!valid) {
      await this.login()
    }
  }

  async getAuthHeaders(): Promise<Headers> {
    const headers = new Headers()
    const cookie = await this.getCookieString()
    if (cookie) {
      headers.set("cookie", cookie)
    }
    return headers
  }

  async getCookieString(): Promise<string> {
    return this.jar.getCookieString(this.baseUrl)
  }

  buildUrl(resourcePath: string): URL {
    return this.withToken(new URL(resourcePath, this.baseUrl))
  }
}
