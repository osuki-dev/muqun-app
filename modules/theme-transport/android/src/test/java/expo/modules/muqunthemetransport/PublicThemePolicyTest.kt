package expo.modules.muqunthemetransport

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.net.InetAddress

class PublicThemePolicyTest {
  @Test fun rejectsNonPublicAddresses() {
    for (ip in listOf("0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
      "172.16.0.1", "192.168.0.1", "192.0.0.9", "192.0.2.1", "192.88.99.1",
      "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
      "::1", "::", "fe80::1", "fc00::1", "ff02::1", "64:ff9b:1::808:808",
      "2001:db8::1", "2001::1", "2002:808:808::1", "3fff::1"))
      assertFalse(ip, PublicThemePolicy.isPublic(InetAddress.getByName(ip)))
    val mapped = ByteArray(16); mapped[10] = -1; mapped[11] = -1; mapped[12] = 8
    assertFalse(PublicThemePolicy.isPublicBytes(mapped))
  }

  @Test fun allowsOrdinaryPublicAddresses() {
    for (ip in listOf("8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"))
      assertTrue(PublicThemePolicy.isPublic(InetAddress.getByName(ip)))
  }

  @Test fun mixedDnsAnswersFailBeforeAnyConnection() {
    val public = InetAddress.getByName("8.8.8.8")
    val private = InetAddress.getByName("127.0.0.1")
    assertThrows(Exception::class.java) { PublicThemePolicy.checkedAddresses(listOf(public, private)) }
    assertThrows(Exception::class.java) { PublicThemePolicy.checkedAddresses(emptyList()) }
    assertEquals(listOf(public), PublicThemePolicy.checkedAddresses(listOf(public)))
    val privateV6 = InetAddress.getByName("fd00::1")
    for (answers in listOf(listOf(public, privateV6), listOf(privateV6, public)))
      assertThrows(Exception::class.java) { PublicThemePolicy.checkedAddresses(answers) }
  }

  @Test fun nat64ChecksEveryEmbeddedIpv4Destination() {
    for (ip in listOf("64:ff9b::808:808", "64:ff9b::101:101"))
      assertTrue(ip, PublicThemePolicy.isPublic(InetAddress.getByName(ip)))
    for (ip in listOf("0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
      "172.16.0.1", "192.168.0.1", "192.0.0.9", "192.0.2.1", "192.88.99.1",
      "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255")) {
      val translated = ByteArray(16)
      translated[1] = 0x64; translated[2] = -1; translated[3] = 0x9b.toByte()
      InetAddress.getByName(ip).address.copyInto(translated, 12)
      assertFalse(ip, PublicThemePolicy.isPublicBytes(translated))
      val unsafe = InetAddress.getByAddress(translated)
      val safe = InetAddress.getByName("64:ff9b::808:808")
      for (answers in listOf(listOf(safe, unsafe), listOf(unsafe, safe)))
        assertThrows(Exception::class.java) { PublicThemePolicy.checkedAddresses(answers) }
    }
    for (ip in listOf("64:ff9b:1::808:808", "64:ff9b:0:0:0:1:808:808", "64:ff9a::808:808"))
      assertFalse(ip, PublicThemePolicy.isPublic(InetAddress.getByName(ip)))
  }

  @Test fun rejectsUnsafeRoutingBeforeDns() {
    assertEquals("example.org", PublicThemePolicy.host("https://example.org/theme.json"))
    for (url in listOf("http://example.org/a", "https://user:pass@example.org/a", "https://example.org:444/a",
      "https://127.0.0.1/a", "https://[::1]/a", "https://localhost/a", "https://x.internal/a",
      "https://example.org\\@127.0.0.1/a", "https://example.org/a#b", "https://example.org/a\n"))
      assertThrows(Exception::class.java) { PublicThemePolicy.host(url) }
  }

  @Test fun boundsActualBytesAndCancellation() {
    assertArrayEquals(byteArrayOf(1, 2), PublicThemePolicy.readBounded(ByteArrayInputStream(byteArrayOf(1, 2)), 2) { false })
    assertThrows(Exception::class.java) { PublicThemePolicy.readBounded(ByteArrayInputStream(ByteArray(3)), 2) { false } }
    assertThrows(Exception::class.java) { PublicThemePolicy.readBounded(ByteArrayInputStream(ByteArray(1)), 1) { true } }
    assertThrows(Exception::class.java) { PublicThemePolicy.readBounded(ByteArrayInputStream(ByteArray(0)), PublicThemePolicy.MAX_BYTES + 1) { false } }
  }

  @Test fun tracksEarlyCancelCompletionAndDestroy() {
    val requests = ThemeRequests()
    requests.cancel("early")
    assertThrows(Exception::class.java) { requests.register("early") {} }
    var canceled = 0
    requests.register("one") { canceled++ }
    requests.register("two") { canceled++ }
    assertThrows(Exception::class.java) { requests.register("three") {} }
    requests.cancel("one")
    assertFalse(requests.finish("one"))
    assertEquals(1, canceled)
    requests.close()
    assertEquals(2, canceled)
    assertThrows(Exception::class.java) { requests.register("closed") {} }
  }

  @Test fun saturatedEarlyCancellationFailsClosed() {
    val requests = ThemeRequests()
    repeat(257) { requests.cancel("early$it") }
    assertThrows(Exception::class.java) { requests.register("new") {} }
  }
}
