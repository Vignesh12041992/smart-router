import { spawn } from "child_process";
import { createRequire } from "module";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

/**
 * Laya (and its ~280 MB onnxruntime) is NOT a normal dependency, so installing smart-router stays tiny.
 * `smart-router download` installs it into this folder on demand.
 */
export const LAYA_HOME = process.env.SMART_ROUTER_HOME
  ? path.resolve(process.env.SMART_ROUTER_HOME)
  : path.join(os.homedir(), ".smart-router");

const LAYA_PKG = "@receptron/laya@^0.1.2";

/** Loads the Laya package from the normal module path or from LAYA_HOME. Throws if it is not installed. */
export async function importLaya(): Promise<any> {
  try {
    return await import("@receptron/laya" as string);
  } catch {
    const req = createRequire(path.join(LAYA_HOME, "package.json"));
    let entry: string;
    try {
      entry = req.resolve("@receptron/laya");
    } catch {
      throw new Error("Laya is not installed. Run: smart-router download");
    }
    return import(pathToFileURL(entry).href);
  }
}

/** Installs the Laya package into LAYA_HOME using npm. */
export async function installLaya(log: (msg: string) => void): Promise<void> {
  mkdirSync(LAYA_HOME, { recursive: true });
  const pkgJson = path.join(LAYA_HOME, "package.json");
  if (!existsSync(pkgJson)) writeFileSync(pkgJson, JSON.stringify({ name: "smart-router-laya", private: true }, null, 2));

  log(`Installing ${LAYA_PKG} into ${LAYA_HOME} ...`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npm, ["install", "--no-audit", "--no-fund", LAYA_PKG], {
      cwd: LAYA_HOME,
      stdio: ["ignore", "inherit", "inherit"],
      shell: process.platform === "win32"
    });
    child.on("error", reject);
    child.on("close", code => (code === 0 ? resolve() : reject(new Error(`npm install exited with code ${code}`))));
  });
}
