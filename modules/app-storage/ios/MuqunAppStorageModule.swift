import ExpoModulesCore
import os

/// Process-wide, so a JavaScript reload in the same process does not claim it again.
private let launchClaim = OSAllocatedUnfairLock(initialState: false)

public class MuqunAppStorageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MuqunAppStorage")

    Constants(["contractVersion": 1])

    // True once per process: native caches that open lazily are still closed.
    Function("claimProcessLaunch") { () -> Bool in
      launchClaim.withLock { claimed in
        if claimed { return false }
        claimed = true
        return true
      }
    }

    // iOS has no per-app storage figures; the JavaScript side measures the cache.
    AsyncFunction("getStorageStats") { () -> [String: Double]? in nil }
  }
}
