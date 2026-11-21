import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

export function devSigningEnvironment(
  args: string[],
  platform: string,
  identities: string,
  environment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  if (platform !== "darwin" || args[0] !== "dev") return environment
  const matches = [
    ...identities.matchAll(
      /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"Developer ID Application: /gm
    ),
  ]
  const identity =
    environment.MANNA_DEV_SIGNING_IDENTITY ||
    (matches.length === 1 ? matches[0][1] : undefined)
  if (!identity) return environment
  return {
    ...environment,
    MANNA_DEV_SIGNING_IDENTITY: identity,
    CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER:
      environment.CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER ||
      "sh ../scripts/run-signed-dev.sh",
    CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER:
      environment.CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER ||
      "sh ../scripts/run-signed-dev.sh",
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const identities =
    process.platform === "darwin" &&
    args[0] === "dev" &&
    !process.env.MANNA_DEV_SIGNING_IDENTITY
      ? spawnSync(
          "/usr/bin/security",
          ["find-identity", "-v", "-p", "codesigning"],
          { encoding: "utf8" }
        ).stdout || ""
      : ""
  const environment = devSigningEnvironment(
    args,
    process.platform,
    identities,
    process.env
  )
  const result = spawnSync(
    process.execPath,
    [
      resolve(import.meta.dirname, "../node_modules/@tauri-apps/cli/tauri.js"),
      ...args,
    ],
    { env: environment, stdio: "inherit" }
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
