package expo.modules.muqunthemetransport

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.URI
import java.net.UnknownHostException

internal object PublicThemePolicy {
  const val MAX_BYTES = 25 * 1024 * 1024
  const val MAX_HEADERS = 16 * 1024

  fun host(input: String): String {
    require(input.length <= 2048 && input.none { it <= ' ' || it == '\\' || it == '\u007f' })
    val uri = URI(input)
    val host = uri.host?.lowercase() ?: throw IllegalArgumentException()
    require(uri.scheme == "https" && uri.rawUserInfo == null && uri.rawFragment == null)
    require(uri.port == -1 || uri.port == 443)
    require(host.length <= 253 && host.contains('.') && host.matches(Regex("[a-z0-9.-]+")))
    require(host.split('.').all { it.matches(Regex("[a-z0-9](?:[a-z0-9-]*[a-z0-9])?")) })
    require(!host.matches(Regex("[0-9.]+")))
    require(!Regex("(?:^|\\.)(localhost|local|internal|home|lan|onion|invalid|test)$").containsMatchIn(host))
    return host
  }

  fun isPublic(address: InetAddress): Boolean = isPublicBytes(address.address)

  fun checkedAddresses(addresses: List<InetAddress>): List<InetAddress> {
    if (addresses.isEmpty() || addresses.any { !isPublic(it) })
      throw UnknownHostException("Theme destination is not public")
    return addresses.toList()
  }

  fun isPublicBytes(raw: ByteArray): Boolean {
    val b = raw.map { it.toInt() and 255 }
    if (b.size == 4) {
      val a = b[0]; val c = b[1]; val d = b[2]
      return !(a == 0 || a == 10 || a == 127 || a >= 224 ||
        (a == 100 && c in 64..127) || (a == 169 && c == 254) ||
        (a == 172 && c in 16..31) || (a == 192 && c == 168) ||
        (a == 192 && c == 0 && (d == 0 || d == 2)) ||
        (a == 192 && c == 88 && d == 99) || (a == 198 && c in 18..19) ||
        (a == 198 && c == 51 && d == 100) || (a == 203 && c == 0 && d == 113))
    }
    if (b.size != 16) return false
    // RFC 6052 well-known NAT64 prefix only. Validate the translated destination
    // with exactly the IPv4 policy; a public-looking IPv6 wrapper is not enough.
    if (b[0] == 0 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b &&
      (4..11).all { b[it] == 0 }) return isPublicBytes(raw.copyOfRange(12, 16))
    if (b[0] and 0xe0 != 0x20) return false
    // Global-unicast only: excludes mapped/compatible, local-use NAT64, ULA, link local,
    // multicast and unallocated space. Also exclude transition/special/documentation ranges.
    if (b[0] == 0x20 && b[1] == 1 && b[2] < 2) return false // 2001::/23
    if (b[0] == 0x20 && b[1] == 1 && b[2] == 0x0d && b[3] == 0xb8) return false
    if (b[0] == 0x20 && b[1] == 2) return false // 6to4
    if (b[0] == 0x3f && b[1] == 0xff && b[2] and 0xf0 == 0) return false
    return true
  }

  fun readBounded(input: InputStream, maxBytes: Int, canceled: () -> Boolean): ByteArray {
    require(maxBytes in 1..MAX_BYTES)
    val output = ByteArrayOutputStream(minOf(maxBytes, 8192))
    val buffer = ByteArray(8192)
    while (true) {
      check(!canceled())
      val count = input.read(buffer, 0, minOf(buffer.size, maxBytes - output.size() + 1))
      if (count < 0) break
      check(count <= maxBytes - output.size())
      output.write(buffer, 0, count)
    }
    check(!canceled())
    return output.toByteArray()
  }
}
