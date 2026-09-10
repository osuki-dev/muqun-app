package expo.modules.muqunthemetransport

/** Synchronous registration/cancel, including cancellation before Expo dispatch.
 * A saturated tombstone set fails closed rather than forgetting a cancellation. */
internal class ThemeRequests {
  private val active = mutableMapOf<String, () -> Unit>()
  private val canceled = mutableSetOf<String>()
  private var closed = false

  @Synchronized fun register(id: String, cancel: () -> Unit) {
    require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")))
    check(!closed && !canceled.remove(id) && !active.containsKey(id) && active.size < 2)
    active[id] = cancel
  }

  @Synchronized fun finish(id: String): Boolean = active.remove(id) != null

  fun cancel(id: String) {
    val action = synchronized(this) {
      if (closed) return
      val found = active.remove(id)
      if (found == null) {
        if (canceled.size >= 256) { close(); return }
        if (id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) canceled.add(id)
      }
      found
    }
    action?.let { runCatching { it() } }
  }

  @Synchronized fun close() {
    closed = true
    val actions = active.values.toList()
    active.clear()
    canceled.clear()
    actions.forEach { runCatching { it() } }
  }
}
