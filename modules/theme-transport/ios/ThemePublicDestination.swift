import Darwin
import Foundation

struct ThemePublicDestination {
  let host: String
  let requestTarget: String

  init(_ raw: String) throws {
    guard raw.utf8.count <= 8192, raw.utf8.allSatisfy({ (33...126).contains($0) }),
      !raw.contains("\\"),
      let url = URLComponents(string: raw), url.scheme?.lowercased() == "https",
      url.user == nil, url.password == nil, url.port == nil || url.port == 443,
      let host = url.host?.lowercased(), host.count <= 253, host.contains("."),
      !host.hasSuffix("."), !host.contains(":"), !host.contains("%")
    else { throw ThemeTransportError.destination }
    let labels = host.split(separator: ".", omittingEmptySubsequences: false)
    guard
      labels.allSatisfy({ label in
        !label.isEmpty && label.count <= 63 && label.first != "-" && label.last != "-"
          && label.utf8.allSatisfy({ (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }
          )
      }), labels.last!.utf8.contains(where: { (97...122).contains($0) }),
      !["localhost", "local", "internal", "home", "lan", "test", "invalid", "onion"].contains(
        String(labels.last!))
    else {
      throw ThemeTransportError.destination
    }
    self.host = host
    let path = url.percentEncodedPath.isEmpty ? "/" : url.percentEncodedPath
    requestTarget = path + (url.percentEncodedQuery.map { "?" + $0 } ?? "")
    guard requestTarget.hasPrefix("/"), requestTarget.utf8.allSatisfy({ (33...126).contains($0) })
    else { throw ThemeTransportError.destination }
  }

  var request: Data {
    Data(
      "GET \(requestTarget) HTTP/1.1\r\nHost: \(host)\r\nUser-Agent: Muqun-Theme-Import/1\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n"
        .utf8)
  }

  /// Conservative unicast allowlist. Translation, mapped, multicast, documentation,
  /// private, reserved and special-use ranges are rejected before socket creation.
  static func publicIPv4(_ bytes: [UInt8]) -> Bool {
    guard bytes.count == 4 else { return false }
    let a = bytes[0]
    let b = bytes[1]
    let c = bytes[2]
    if a == 0 || a == 10 || a == 127 || a >= 224 { return false }
    if a == 100 && (64...127).contains(b) { return false }
    if a == 169 && b == 254 || a == 172 && (16...31).contains(b) || a == 192 && b == 168 {
      return false
    }
    if a == 192 && (b == 0 || b == 2 || b == 88 && c == 99) { return false }
    if a == 198 && (b == 18 || b == 19 || b == 51 && c == 100) { return false }
    if a == 203 && b == 0 && c == 113 { return false }
    return true
  }

  static func publicIPv6(_ bytes: [UInt8]) -> Bool {
    guard bytes.count == 16 else { return false }
    // Accept only DNS-returned RFC 6052 well-known-prefix addresses whose
    // embedded destination is public. Never synthesize this prefix locally:
    // a network may use a different Pref64 and must supply its own DNS answer.
    let wellKnownPrefix: [UInt8] = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0]
    if bytes.starts(with: wellKnownPrefix) { return publicIPv4(Array(bytes.suffix(4))) }
    guard bytes[0] & 0xe0 == 0x20 else { return false }
    // 2001::/23 special assignments; 2001:db8::/32 docs; 2002::/16 6to4;
    // 3fff::/20 docs. Excluding transition spaces avoids embedded private IPv4.
    if bytes[0] == 0x20 && bytes[1] == 0x01
      && (bytes[2] < 2 || bytes[2] == 0x0d && bytes[3] == 0xb8)
    {
      return false
    }
    if bytes[0] == 0x20 && bytes[1] == 0x02 { return false }
    if bytes[0] == 0x3f && bytes[1] == 0xff && bytes[2] & 0xf0 == 0 { return false }
    return true
  }
}
