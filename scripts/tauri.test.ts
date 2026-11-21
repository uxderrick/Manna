import { expect, it } from "vitest"
import { devSigningEnvironment } from "./tauri"
const identities =
  '  1) 1234567890ABCDEF1234567890ABCDEF12345678 "Developer ID Application: Test Person (TESTTEAM)"\n 1 valid identities found'
it("uses a stable signing identity only for Mac development launches", () => {
  const env = devSigningEnvironment(["dev"], "darwin", identities, {
    PATH: "/usr/bin",
  })
  expect(env.MANNA_DEV_SIGNING_IDENTITY).toBe(
    "1234567890ABCDEF1234567890ABCDEF12345678"
  )
  expect(env.CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER).toBe(
    "sh ../scripts/run-signed-dev.sh"
  )
  expect(env.CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER).toBe(
    "sh ../scripts/run-signed-dev.sh"
  )
})
it("leaves release builds and Windows development unchanged", () => {
  const env = { PATH: "/usr/bin" }
  expect(devSigningEnvironment(["build"], "darwin", identities, env)).toEqual(
    env
  )
  expect(devSigningEnvironment(["dev"], "win32", identities, env)).toEqual(env)
})
it("does not guess an identity when none or several certificates are available", () => {
  const env = { PATH: "/usr/bin" }
  expect(devSigningEnvironment(["dev"], "darwin", "", env)).toEqual(env)
  expect(
    devSigningEnvironment(
      ["dev"],
      "darwin",
      identities +
        '\n 2) A234567890ABCDEF1234567890ABCDEF12345678 "Developer ID Application: Another (OTHER)"',
      env
    )
  ).toEqual(env)
})
it("keeps an explicit signing identity and existing custom runner", () => {
  const env = devSigningEnvironment(["dev"], "darwin", "", {
    MANNA_DEV_SIGNING_IDENTITY: "chosen",
    CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER: "custom-runner",
  })
  expect(env.MANNA_DEV_SIGNING_IDENTITY).toBe("chosen")
  expect(env.CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER).toBe("custom-runner")
})
