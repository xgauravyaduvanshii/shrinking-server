import { promises as fs } from "fs"
import path from "path"
import { getUserSettingsPath, provisionDefaultSettings } from "../../../src/node/defaultSettings"
import { tmpdir } from "../../utils/helpers"

describe("defaultSettings", () => {
  it("writes Islands Dark settings for a fresh profile", async () => {
    const userDataDir = await tmpdir("islands-default-settings-fresh")
    const defaultsPath = path.join(userDataDir, "defaults.json")
    const settings = JSON.stringify({ "workbench.colorTheme": "Islands Dark" }, null, 2)

    await fs.writeFile(defaultsPath, settings)

    const wroteDefaults = await provisionDefaultSettings(userDataDir, defaultsPath)
    const written = await fs.readFile(getUserSettingsPath(userDataDir), "utf8")

    expect(wroteDefaults).toBe(true)
    expect(written).toBe(settings)
  })

  it("does not overwrite existing user settings", async () => {
    const userDataDir = await tmpdir("islands-default-settings-existing")
    const defaultsPath = path.join(userDataDir, "defaults.json")
    const settingsPath = getUserSettingsPath(userDataDir)
    const existing = JSON.stringify({ "workbench.colorTheme": "Quiet Light" }, null, 2)

    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(defaultsPath, JSON.stringify({ "workbench.colorTheme": "Islands Dark" }, null, 2))
    await fs.writeFile(settingsPath, existing)

    const wroteDefaults = await provisionDefaultSettings(userDataDir, defaultsPath)
    const written = await fs.readFile(settingsPath, "utf8")

    expect(wroteDefaults).toBe(false)
    expect(written).toBe(existing)
  })
})
