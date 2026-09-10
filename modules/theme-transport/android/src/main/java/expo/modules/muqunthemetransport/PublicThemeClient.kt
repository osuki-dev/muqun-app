package expo.modules.muqunthemetransport

import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.net.Proxy
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.Semaphore

internal class PublicThemeClient {
  private val requests = ThemeRequests()
  // Keep permits until callbacks finish, even after cancellation. A platform
  // DNS resolver can ignore interruption; it must not create unbounded work.
  private val permits = Semaphore(2)
  private val deadlines = ScheduledThreadPoolExecutor(1).apply { removeOnCancelPolicy = true }
  private val client = OkHttpClient.Builder()
    .proxy(Proxy.NO_PROXY)
    .cookieJar(CookieJar.NO_COOKIES)
    .cache(null)
    .followRedirects(false)
    .followSslRedirects(false)
    .retryOnConnectionFailure(false)
    .connectionPool(ConnectionPool(0, 1, TimeUnit.SECONDS))
    .dns(object : Dns {
      // OkHttp connects to these InetAddresses, retaining the TLS hostname.
      override fun lookup(hostname: String) =
        PublicThemePolicy.checkedAddresses(Dns.SYSTEM.lookup(hostname))
    })
    .callTimeout(30, TimeUnit.SECONDS)
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .build().apply {
      dispatcher.maxRequests = 2
      dispatcher.maxRequestsPerHost = 2
    }

  fun get(id: String, url: String, maxBytes: Int, success: (Map<String, Any>) -> Unit, failure: () -> Unit) {
    val fail = { runCatching { failure() }; Unit }
    if (!permits.tryAcquire()) { fail(); return }
    val call: Call
    try {
      PublicThemePolicy.host(url)
      require(maxBytes in 1..PublicThemePolicy.MAX_BYTES)
      call = client.newCall(Request.Builder().url(url).header("Cache-Control", "no-store")
        .header("Accept-Encoding", "identity").get().build())
      requests.register(id) { call.cancel(); fail() }
    } catch (_: Exception) { permits.release(); fail(); return }
    val timer = try {
      deadlines.schedule({ requests.cancel(id) }, 30, TimeUnit.SECONDS)
    } catch (_: Exception) { requests.cancel(id); permits.release(); return }
    try { call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        timer.cancel(false)
        if (requests.finish(id)) fail()
        permits.release()
      }
      override fun onResponse(call: Call, response: Response) {
        try {
          response.use {
            val result = readThemeResponse(response, maxBytes) { call.isCanceled() }
            if (requests.finish(id)) runCatching { success(result) }
          }
        } catch (_: Exception) {
          call.cancel()
          if (requests.finish(id)) fail()
        } finally { timer.cancel(false); permits.release() }
      }
    }) } catch (_: Exception) {
      timer.cancel(false)
      requests.cancel(id)
      permits.release()
    }
  }

  fun cancel(id: String) = requests.cancel(id)
  fun close() {
    requests.close()
    client.dispatcher.cancelAll()
    deadlines.shutdownNow()
    client.dispatcher.executorService.shutdownNow()
    client.connectionPool.evictAll()
  }
}

internal fun readThemeResponse(response: Response, maxBytes: Int, canceled: () -> Boolean): Map<String, Any> {
  check(response.headers.byteCount() <= PublicThemePolicy.MAX_HEADERS)
  val location = response.header("Location")
  val contentType = response.header("Content-Type")
  check(location == null || location.length <= 2048)
  check(contentType == null || contentType.length <= 256)
  // Expo SDK 57 decodes this reserved string prefix as an internal native value
  // token, including inside Promise maps. Never bridge attacker-supplied tokens.
  check(location?.startsWith("__expo_dynamic_extension__#") != true)
  check(contentType?.startsWith("__expo_dynamic_extension__#") != true)
  // Identity is requested explicitly. Reject unsolicited compression rather
  // than allocating an unbounded decoded response or returning compressed bytes.
  val encoding = response.header("Content-Encoding")
  check(encoding == null || encoding.equals("identity", true))
  val body = response.body ?: throw IOException()
  check(body.contentLength() <= maxBytes)
  val bytes = PublicThemePolicy.readBounded(body.byteStream(), maxBytes, canceled)
  val result = mutableMapOf<String, Any>("status" to response.code, "bytes" to bytes)
  if (location != null) result["location"] = location
  if (contentType != null) result["contentType"] = contentType
  return result
}
