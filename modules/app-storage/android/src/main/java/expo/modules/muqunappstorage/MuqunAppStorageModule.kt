package expo.modules.muqunappstorage

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

/** Process-wide, so a JavaScript reload in the same process does not claim it again. */
private val launchClaimed = AtomicBoolean(false)

class MuqunAppStorageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MuqunAppStorage")
    Constant("contractVersion") { 1 }
    // True once per process: native caches that open lazily are still closed.
    Function("claimProcessLaunch") { launchClaimed.compareAndSet(false, true) }
  }
}
