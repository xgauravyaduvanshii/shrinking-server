import { logger } from "@coder/logger"
import { promises as fs } from "fs"
import path from "path"
import { vsRootPath } from "./constants"

export const getDefaultSettingsPath = (): string =>
  path.join(vsRootPath, "extensions", "islands-dark", "defaults", "code-server.json")

export const getUserSettingsPath = (userDataDir: string): string => path.join(userDataDir, "User", "settings.json")

export const provisionDefaultSettings = async (
  userDataDir: string,
  defaultsPath = getDefaultSettingsPath(),
): Promise<boolean> => {
  const settingsPath = getUserSettingsPath(userDataDir)
  await fs.mkdir(path.dirname(settingsPath), { recursive: true })

  try {
    await fs.access(settingsPath)
    return false
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      throw error
    }
  }

  let defaults = ""
  try {
    defaults = await fs.readFile(defaultsPath, "utf8")
  } catch (error: any) {
    if (error.code === "ENOENT") {
      logger.warn(`Skipping Islands Dark defaults because ${defaultsPath} was not found`)
      return false
    }
    throw error
  }
  try {
    await fs.writeFile(settingsPath, defaults, { flag: "wx" })
    logger.info(`Wrote Islands Dark default settings to ${settingsPath}`)
    return true
  } catch (error: any) {
    if (error.code === "EEXIST") {
      return false
    }
    throw error
  }
}
