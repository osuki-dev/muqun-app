package expo.modules.muqunthemetransport

import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test

class PublicThemeClientTest {
  private fun response() = Response.Builder()
    .request(Request.Builder().url("https://example.org/theme.json").build())
    .protocol(Protocol.HTTP_1_1).code(200).message("OK")
    .body(byteArrayOf(1, 2).toResponseBody())

  @Test fun returnsRedirectMetadataWithoutFollowingIt() {
    response().code(302).header("Location", "https://127.0.0.1/private").build().use {
      val result = readThemeResponse(it, 2) { false }
      assertEquals(302, result["status"])
      assertEquals("https://127.0.0.1/private", result["location"])
      assertArrayEquals(byteArrayOf(1, 2), result["bytes"] as ByteArray)
    }
  }

  @Test fun rejectsCompressionAndExcessHeadersAndBodies() {
    for (entry in listOf("Content-Encoding" to "gzip", "Location" to "a".repeat(2049),
      "Content-Type" to "a".repeat(257), "X-Large" to "a".repeat(17000))) {
      response().header(entry.first, entry.second).build().use {
        assertThrows(Exception::class.java) { readThemeResponse(it, 2) { false } }
      }
    }
    response().build().use {
      assertThrows(Exception::class.java) { readThemeResponse(it, 1) { false } }
    }
  }

  @Test fun earlyCancellationAndUnsafeUrlsNeverEnqueueNetworkWork() {
    val client = PublicThemeClient()
    var failed = 0
    try {
      client.cancel("early")
      client.get("early", "https://example.org/theme.json", 100, { fail("Canceled request succeeded") }, { failed++ })
      client.get("private", "https://127.0.0.1/theme.json", 100, { fail("Private request succeeded") }, { failed++ })
      assertEquals(2, failed)
    } finally { client.close() }
  }

  @Test fun rejectsExpoBridgeTokensInUntrustedResponseHeaders() {
    for (name in listOf("Location", "Content-Type")) {
      response().header(name, "__expo_dynamic_extension__#0").build().use {
        assertThrows(Exception::class.java) { readThemeResponse(it, 2) { false } }
      }
    }
  }
}
