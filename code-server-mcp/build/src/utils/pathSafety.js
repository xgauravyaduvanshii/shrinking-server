import path from "node:path";
import { promises as fs } from "node:fs";
import { ToolError } from "./errors.js";
export async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
export function matchesGlobLike(value, pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i").test(value);
}
export function ensureWithinAllowedRoots(targetPath, roots) {
    const normalized = path.resolve(targetPath);
    const allowed = roots.some((root) => {
        const resolvedRoot = path.resolve(root);
        return normalized === resolvedRoot || normalized.startsWith(`${resolvedRoot}${path.sep}`);
    });
    if (!allowed) {
        throw new ToolError(`Path is outside allowed roots: ${normalized}`, "PATH_NOT_ALLOWED");
    }
}
