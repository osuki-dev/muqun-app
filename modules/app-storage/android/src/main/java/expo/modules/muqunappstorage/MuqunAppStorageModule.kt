package expo.modules.muqunappstorage

import android.app.usage.StorageStatsManager
import android.system.Os
import android.system.OsConstants
import android.os.Process
import android.os.storage.StorageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
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
    AsyncFunction("getDataDirectorySizes") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      val sizes = mutableMapOf<String, Double>()
      val linkedFiles = mutableSetOf<Pair<Long, Long>>()
      for (entry in context.filesDir.listFiles().orEmpty()) {
        val key = when {
          entry.name == "bundle-store" || entry.name == "hot-updater-instances" -> "updates"
          entry.isDirectory -> "files/" + entry.name
          else -> "files"
        }
        val bytes = allocatedBytes(entry, linkedFiles)
        if (bytes > 0) sizes[key] = (sizes[key] ?: 0.0) + bytes
      }
      val excluded = setOf(context.filesDir.name, context.cacheDir.name, context.codeCacheDir.name, "lib")
      for (entry in context.dataDir.listFiles().orEmpty()) {
        if (entry.name in excluded) continue
        val stat = runCatching { Os.lstat(entry.path) }.getOrNull() ?: continue
        if (!OsConstants.S_ISDIR(stat.st_mode)) continue
        val bytes = allocatedBytes(entry, linkedFiles)
        if (bytes > 0) sizes["private/" + entry.name] = bytes.toDouble()
      }
      sizes
    }
  }

  // lstat keeps symlinks out of the walk and counts allocated blocks for sparse files.
  private fun allocatedBytes(file: File, linkedFiles: MutableSet<Pair<Long, Long>>): Long {
    val stat = runCatching { Os.lstat(file.path) }.getOrNull() ?: return 0
    if (OsConstants.S_ISREG(stat.st_mode)) {
      if (stat.st_nlink > 1 && !linkedFiles.add(stat.st_dev to stat.st_ino)) return 0
      return stat.st_blocks * 512L
    }
    if (!OsConstants.S_ISDIR(stat.st_mode)) return 0
    return file.listFiles().orEmpty().sumOf { allocatedBytes(it, linkedFiles) }
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
