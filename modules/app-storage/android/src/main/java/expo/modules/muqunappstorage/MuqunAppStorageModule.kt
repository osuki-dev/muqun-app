package expo.modules.muqunappstorage

import android.app.usage.StorageStatsManager
import android.os.Process
import android.os.storage.StorageManager
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
    // The figures Android's own Storage screen shows for this app. Querying
    // one's own package needs no permission (API 26+, the app's minimum).
    AsyncFunction("getStorageStats") { readStorageStats() }
  }

  private fun readStorageStats(): Map<String, Double>? {
    val context = appContext.reactContext ?: return null
    return try {
      val manager = context.getSystemService(StorageStatsManager::class.java)
      val stats = manager.queryStatsForPackage(
        StorageManager.UUID_DEFAULT,
        context.packageName,
        Process.myUserHandle()
      )
      mapOf(
        "appBytes" to stats.appBytes.toDouble(),
        // Android reports data including cache; its Storage screen does not.
        "dataBytes" to (stats.dataBytes - stats.cacheBytes).coerceAtLeast(0L).toDouble(),
        "cacheBytes" to stats.cacheBytes.toDouble()
      )
    } catch (error: Exception) {
      null
    }
  }
}
