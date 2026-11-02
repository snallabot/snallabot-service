import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../config", () => ({
  DEPLOYMENT_URL: "https://snallabot.me",
}))
vi.mock("../dashboard/ea_client", () => ({
  Stage: { PRESEASON: 0, SEASON: 1 },
}))
vi.mock("../db/madden_db", () => ({
  default: { appendEvents: vi.fn(), updateLeagueExportStatus: vi.fn() },
  MaddenEvents: {},
  idWeeklyEvents: vi.fn(),
}))
vi.mock("../db/madden_hash_storage", () => ({
  default: { readTree: vi.fn(), writeTree: vi.fn() },
  createTwoLayer: vi.fn(),
  findDifferences: vi.fn(),
}))
vi.mock("../file_handlers", () => ({
  default: { writeFile: vi.fn() },
  defaultSerializer: vi.fn(),
}))
vi.mock("../debug/metrics", () => ({
  maddenHashEventChanged: { inc: vi.fn() },
  maddenHashEventsTotal: { inc: vi.fn() },
}))

import {
  createDestination,
  SnallabotExportDestination,
  normalizeHost,
} from "./exporter"

describe("createDestination", () => {
  describe("routes to SnallabotExportDestination", () => {
    it.each([
      ["exact deployment url", "https://snallabot.me"],
      ["www subdomain", "https://www.snallabot.me"],
      ["trailing slash", "https://snallabot.me/"],
      ["www with trailing slash", "https://www.snallabot.me/"],
      ["uppercase host", "https://SnallaBot.ME"],
      ["uppercase www", "https://WWW.Snallabot.me"],
      ["with a path", "https://snallabot.me/export/madden"],
      ["with a query string", "https://snallabot.me/?foo=bar"],
      ["surrounding whitespace", "  https://snallabot.me  "],
      ["http instead of https", "http://snallabot.me"],
    ])("%s", (_label, url) => {
      expect(createDestination(url)).toBe(SnallabotExportDestination)
    })
  })

  describe("routes to MaddenUrlDestination", () => {
    it.each([
      ["a different domain", "https://example.com"],
      ["a different TLD", "https://snallabot.com"],
      ["a lookalike suffix", "https://snallabot.me.evil.com"],
      ["a lookalike prefix", "https://notsnallabot.me"],
      ["a different subdomain", "https://api.snallabot.me"],
      ["a different port", "https://snallabot.me:8443"],
      ["our domain in the query string", "https://evil.com/?r=https://snallabot.me"],
      ["our domain in the path", "https://evil.com/https://snallabot.me"],
      ["our domain in userinfo", "https://snallabot.me@evil.com"],
    ])("%s", (_label, url) => {
      expect(createDestination(url)).not.toBe(SnallabotExportDestination)
    })

    it.each([
      ["an empty string", ""],
      ["a bare hostname with no protocol", "snallabot.me"],
      ["garbage", "not a url"],
    ])("falls back without throwing for invalid input: %s", (_label, url) => {
      expect(() => createDestination(url)).not.toThrow()
      expect(createDestination(url)).not.toBe(SnallabotExportDestination)
    })
  })

  describe("the returned MaddenUrlDestination targets the original url", () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
      fetchMock.mockReset()
      fetchMock.mockResolvedValue({ ok: true })
      vi.stubGlobal("fetch", fetchMock)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it("posts to the given url, not a normalized one", async () => {
      const dest = createDestination("https://Example.com/Some/Path")
      await dest.leagueTeams("xbox", "123", {} as any)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://Example.com/Some/Path/xbox/123/leagueteams"
      )
    })

    it("strips a trailing slash from the base url", async () => {
      const dest = createDestination("https://example.com/")
      await dest.standings("xbox", "123", {} as any)
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://example.com/xbox/123/standings"
      )
    })

    it("does not send lookalike urls to Snallabot's database", async () => {
      const dest = createDestination("https://snallabot.me.evil.com")
      await dest.leagueTeams("xbox", "123", {} as any)
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://snallabot.me.evil.com/xbox/123/leagueteams"
      )
    })
  })
})

describe("normalizeHost", () => {
  it("treats www and bare domains as the same host", () => {
    expect(normalizeHost("https://www.snallabot.me")).toBe(
      normalizeHost("https://snallabot.me")
    )
  })

  it.each([
    ["https://snallabot.me", "snallabot.me"],
    ["https://www.snallabot.me", "snallabot.me"],
    ["https://WWW.SnallaBot.ME/path?x=1", "snallabot.me"],
    ["  https://snallabot.me  ", "snallabot.me"],
    ["http://localhost:3000", "localhost:3000"],
    ["https://snallabot.me:8443", "snallabot.me:8443"],
    ["https://snallabot.me@evil.com", "evil.com"],
  ])("normalizes %s to %s", (url, expected) => {
    expect(normalizeHost(url)).toBe(expected)
  })

  it.each([
    ["an empty string", ""],
    ["a bare hostname", "snallabot.me"],
    ["garbage", "not a url"],
  ])("returns null for %s", (_label, url) => {
    expect(normalizeHost(url)).toBeNull()
  })
})
