import Darwin
import Foundation

@main
enum TransportChecks {
  private static var checks = 0
  static func require(_ condition: Bool, _ label: String) {
    checks += 1
    if !condition { fatalError("Transport check failed: \(label)") }
  }
  static func rejects(_ label: String, _ body: () throws -> Void) {
    checks += 1
    do {
      try body()
      fatalError("Transport check did not reject: \(label)")
    } catch {}
  }
  static func parse(_ value: String, maximum: Int = 1000) throws -> ThemeHTTPResponse? {
    try ThemeHTTPParser(maximumBytes: maximum).append(Data(value.utf8), eof: true)
  }
  static func main() throws {
    if CommandLine.arguments.contains("--tls-negative-checks") {
      // Public certificate fixtures documented by https://badssl.com/; never local/LAN targets.
      for host in ["wrong.host.badssl.com", "expired.badssl.com", "self-signed.badssl.com"] {
        do {
          _ = try ThemePinnedRequest().get(
            ThemePublicDestination("https://\(host)/"), maximumBytes: 256 * 1024)
          fatalError("Invalid TLS certificate accepted")
        } catch ThemeTransportError.tls { checks += 1 }
      }
      print("Public invalid-certificate fixtures: \(checks) TLS rejections passed")
      return
    }
    if CommandLine.arguments.contains("--public-check") {
      let response = try ThemePinnedRequest().get(
        ThemePublicDestination("https://example.com/"), maximumBytes: 256 * 1024)
      require(response.status == 200, "public TLS status")
      require(!response.bytes.isEmpty, "public TLS body")
      print("Public TLS fixture: status=\(response.status), bytes=\(response.bytes.count)")
      return
    }
    let destination = try ThemePublicDestination(
      "https://raw.githubusercontent.com/owner/repo/file.json?q=a%20b#ignored")
    require(destination.host == "raw.githubusercontent.com", "hostname")
    require(destination.requestTarget == "/owner/repo/file.json?q=a%20b", "encoded target")
    let request = String(data: destination.request, encoding: .utf8)!
    require(request.contains("Accept-Encoding: identity"), "no compression")
    require(
      !request.contains("Cookie:") && !request.contains("Authorization:"), "no ambient credentials")
    for url in [
      "http://example.com/x", "https://name:secret@example.com/x", "https://example.com:444/x",
      "https://127.0.0.1/x", "https://[::1]/x", "https://localhost/x", "https://machine.local/x",
      "https://example.com./x", "https://a..com/x", "https://example.com\\@private/x",
      "https://example.com/\r\nInjected: yes", "https://0x7f000001/x", "https://a.invalid/x",
    ] {
      rejects("URL policy") { _ = try ThemePublicDestination(url) }
    }
    for bytes: [UInt8] in [
      [0, 0, 0, 0], [10, 0, 0, 1], [127, 0, 0, 1], [100, 64, 0, 1], [100, 127, 255, 255],
      [169, 254, 1, 1], [172, 16, 0, 1], [172, 31, 255, 255], [192, 168, 1, 1], [192, 0, 0, 1],
      [192, 2, 0, 1], [198, 18, 0, 1], [198, 51, 100, 1], [203, 0, 113, 1], [224, 0, 0, 1],
      [255, 255, 255, 255],
    ] {
      require(!ThemePublicDestination.publicIPv4(bytes), "nonpublic IPv4")
    }
    for bytes: [UInt8] in [
      [1, 1, 1, 1], [8, 8, 8, 8], [100, 63, 255, 255], [100, 128, 0, 0], [172, 15, 255, 255],
      [172, 32, 0, 0],
    ] {
      require(ThemePublicDestination.publicIPv4(bytes), "public IPv4")
    }
    for string in [
      "::", "::1", "::ffff:8.8.8.8", "64:ff9b::7f00:1", "fe80::1", "fc00::1", "ff02::1",
      "2001:db8::1", "2002:7f00:1::1", "3fff::1",
    ] {
      var address = in6_addr()
      require(inet_pton(AF_INET6, string, &address) == 1, "IPv6 fixture")
      require(
        !withUnsafeBytes(of: address) { ThemePublicDestination.publicIPv6(Array($0)) },
        "nonpublic IPv6")
    }
    var ipv6 = in6_addr()
    require(inet_pton(AF_INET6, "2606:4700:4700::1111", &ipv6) == 1, "public IPv6 fixture")
    require(
      withUnsafeBytes(of: ipv6) { ThemePublicDestination.publicIPv6(Array($0)) }, "public IPv6")
    try checkNAT64AndDNSBatches()

    let fixed = "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Type: text/plain\r\n\r\nhello"
    require(try parse(fixed)?.bytes == Data("hello".utf8), "fixed response")
    for split in 0...fixed.utf8.count {
      let parser = try ThemeHTTPParser(maximumBytes: 5)
      let data = Data(fixed.utf8)
      let first = try parser.append(data.prefix(split))
      let answer = try first ?? parser.append(data.dropFirst(split), eof: true)
      require(answer?.bytes == Data("hello".utf8), "every boundary fixed response")
    }
    let chunked =
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nhe\r\n3\r\nllo\r\n0\r\nDigest: ignored\r\n\r\n"
    for split in 0...chunked.utf8.count {
      let parser = try ThemeHTTPParser(maximumBytes: 5)
      let data = Data(chunked.utf8)
      let first = try parser.append(data.prefix(split))
      let answer = try first ?? parser.append(data.dropFirst(split), eof: true)
      require(answer?.bytes == Data("hello".utf8), "every boundary chunked response")
    }
    let oneByteParser = try ThemeHTTPParser(maximumBytes: 5)
    var oneByteResult: ThemeHTTPResponse?
    for byte in chunked.utf8 { oneByteResult = try oneByteParser.append(Data([byte])) }
    require(oneByteResult?.bytes == Data("hello".utf8), "one-byte chunks")
    require(
      try parse("HTTP/1.0 200 OK\r\n\r\nhello")?.bytes == Data("hello".utf8), "close-delimited")
    require(
      try parse(
        "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/private\r\nContent-Length: 0\r\n\r\n")?
        .location == "http://127.0.0.1/private", "redirect returned without contact")
    require(try parse("HTTP/1.1 204 No Content\r\n\r\n")?.bytes.isEmpty == true, "bodyless")
    for wire in [
      "HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nhello",
      "HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nhello",
      "HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n",
      "HTTP/1.1 200 OK\r\nContent-Length: 99999999999999999999999999\r\n\r\n",
      "HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\nx",
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 0\r\n\r\n",
      "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\ncompressed",
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n",
      "HTTP/1.1 200 OK\r\n Location: hidden\r\n\r\n",
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabcXX0\r\n\r\n",
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1;ext=a\r\nx\r\n0\r\n\r\n",
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nLocation: hidden\r\n\r\n",
      "HTTP/1.1 101 Switching Protocols\r\n\r\n",
      "HTTP/2 200 OK\r\n\r\n",
      "HTTP/1.1 302 Found\r\nLocation: __expo_dynamic_extension__#1\r\nContent-Length: 0\r\n\r\n",
      "HTTP/1.1 200 OK\r\nContent-Type: __expo_dynamic_extension__#2\r\nContent-Length: 0\r\n\r\n",
    ] { rejects("malformed HTTP") { _ = try parse(wire) } }
    rejects("body budget") { _ = try parse(fixed, maximum: 4) }
    rejects("chunk budget") { _ = try parse(chunked, maximum: 4) }
    rejects("close body budget") { _ = try parse("HTTP/1.0 200 OK\r\n\r\nhello", maximum: 4) }
    rejects("header budget") {
      _ = try parse("HTTP/1.1 200 OK\r\nX: " + String(repeating: "a", count: 33000))
    }
    rejects("maximum bound") { _ = try ThemeHTTPParser(maximumBytes: 25 * 1024 * 1024 + 1) }

    // These service checks never initiate DNS or a connection.
    let service = ThemeTransportService()
    service.cancel("cancel-before-get")
    var rejected = false
    service.get("cancel-before-get", url: "https://example.com/a", maximumBytes: 1) { result in
      if case .failure = result { rejected = true }
    }
    require(rejected, "cancel before queued get")
    for id in 0...1024 { service.cancel("cancel-\(id)") }
    rejected = false
    service.get("after-overflow", url: "https://example.com/a", maximumBytes: 1) { result in
      if case .failure = result { rejected = true }
    }
    require(rejected, "tombstone overflow fails closed")
    let destroyed = ThemeTransportService()
    destroyed.destroy()
    rejected = false
    destroyed.get("after-destroy", url: "https://example.com/a", maximumBytes: 1) { result in
      if case .failure = result { rejected = true }
    }
    require(rejected, "module destroy fails closed")
    #if THEME_TRANSPORT_TESTING
      try checkBlockedOperations()
    #endif
    print("Theme transport: \(checks) checks passed (no network requests)")
  }

  static func ipv6Bytes(_ value: String) -> [UInt8] {
    var address = in6_addr()
    require(inet_pton(AF_INET6, value, &address) == 1, "IPv6 test vector")
    return withUnsafeBytes(of: address) { Array($0) }
  }

  static func checkNAT64AndDNSBatches() throws {
    let prefix: [UInt8] = [0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0]
    for v4: [UInt8] in [[8, 8, 8, 8], [1, 1, 1, 1], [100, 63, 255, 255], [172, 32, 0, 1]] {
      require(ThemePublicDestination.publicIPv6(prefix + v4), "public embedded NAT64 destination")
    }
    for v4: [UInt8] in [
      [0, 0, 0, 0], [10, 0, 0, 1], [127, 0, 0, 1], [100, 64, 0, 1], [169, 254, 1, 1],
      [172, 16, 0, 1], [192, 168, 0, 1], [192, 0, 0, 170], [192, 0, 2, 1], [198, 18, 0, 1],
      [198, 51, 100, 1], [203, 0, 113, 1], [224, 0, 0, 1], [255, 255, 255, 255],
    ] {
      require(
        !ThemePublicDestination.publicIPv6(prefix + v4), "nonpublic embedded NAT64 destination")
    }
    require(
      !ThemePublicDestination.publicIPv6(ipv6Bytes("64:ff9b:1::808:808")),
      "local-use translation prefix is not a blanket exemption")
    require(
      !ThemePublicDestination.publicIPv6(ipv6Bytes("::ffff:8.8.8.8")),
      "mapped IPv4 remains rejected")
    let publicV6 = ipv6Bytes("2606:4700:4700::1111")
    let privateV6 = ipv6Bytes("fd00::1")
    for preferred: ThemeDNSAnswers.Family in [.ipv4, .ipv6] {
      for privateFirst in [false, true] {
        let answers = ThemeDNSAnswers(preferred: preferred)
        if privateFirst { answers.add(privateV6, family: .ipv6, moreComing: false) }
        answers.add([8, 8, 8, 8], family: .ipv4, moreComing: false)
        if !privateFirst {
          require(answers.result == nil, "public A waits for AAAA")
          answers.add(privateV6, family: .ipv6, moreComing: false)
        }
        rejects("mixed private AAAA never hidden by public A") { _ = try answers.result!.get() }
        let reverse = ThemeDNSAnswers(preferred: preferred)
        reverse.add(publicV6, family: .ipv6, moreComing: false)
        require(reverse.result == nil, "public AAAA waits for A")
        reverse.add([127, 0, 0, 1], family: .ipv4, moreComing: false)
        rejects("mixed private A never hidden by public AAAA") { _ = try reverse.result!.get() }
      }
    }
    let batch = ThemeDNSAnswers(preferred: .ipv4)
    batch.empty(.ipv6)
    batch.add([8, 8, 8, 8], family: .ipv4, moreComing: true)
    require(batch.result == nil, "wait for rest of A batch")
    batch.add([10, 0, 0, 1], family: .ipv4, moreComing: false)
    rejects("later private record in same batch") { _ = try batch.result!.get() }
    let dns64 = ThemeDNSAnswers(preferred: .ipv6)
    dns64.empty(.ipv4)
    dns64.add(prefix + [8, 8, 8, 8], family: .ipv6, moreComing: false)
    let socket = try dns64.result!.get()
    require(
      socket[socket.startIndex + 1] == sa_family_t(AF_INET6),
      "DNS64-only answer creates IPv6 socket")
    require(
      socket.subdata(in: 8..<24) == Data(prefix + [8, 8, 8, 8]),
      "DNS64 destination bytes remain pinned unchanged")
    require(socket.suffix(4) == Data([0, 0, 0, 0]), "IPv6 socket scope remains zero")
    let empty = ThemeDNSAnswers(preferred: .ipv6)
    empty.empty(.ipv4)
    empty.empty(.ipv6)
    rejects("both families empty") { _ = try empty.result!.get() }
    let many = ThemeDNSAnswers(preferred: .ipv4)
    for _ in 0...64 { many.add([8, 8, 8, 8], family: .ipv4, moreComing: true) }
    rejects("DNS record count bounded") { _ = try many.result!.get() }
  }

  #if THEME_TRANSPORT_TESTING
    private final class Results {
      let lock = NSLock()
      var values: [String] = []
      let signal = DispatchSemaphore(value: 0)
      func append(_ result: Result<ThemeHTTPResponse, Error>) {
        lock.lock()
        switch result {
        case .success: values.append("success")
        case .failure(let error): values.append(String(describing: error))
        }
        lock.unlock()
        signal.signal()
      }
      func snapshot() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return values
      }
    }
    static func checkBlockedOperations() throws {
      // Simulate a blocked trust daemon without contacting any host. A late success
      // must neither settle twice nor make timeout/cancelled data observable.
      for action in ["cancel", "destroy", "timeout"] {
        let started = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        let returned = DispatchSemaphore(value: 0)
        let results = Results()
        let service = ThemeTransportService(testTimeout: action == "timeout" ? 0.05 : 30) {
          _, _, _ in
          started.signal()
          _ = release.wait(timeout: .now() + 2)
          returned.signal()
          return ThemeHTTPResponse(status: 200, location: nil, contentType: nil, bytes: Data([1]))
        }
        service.get(
          "blocked", url: "https://example.com/", maximumBytes: 1, completion: results.append)
        require(started.wait(timeout: .now() + 1) == .success, "worker started")
        if action == "cancel" { service.cancel("blocked") }
        if action == "destroy" { service.destroy() }
        require(results.signal.wait(timeout: .now() + 1) == .success, "blocked operation settled")
        require(
          results.snapshot() == [action == "timeout" ? "timeout" : "cancelled"],
          "correct settlement")
        release.signal()
        require(returned.wait(timeout: .now() + 1) == .success, "late operation released")
        require(
          results.signal.wait(timeout: .now() + .milliseconds(50)) == .timedOut,
          "exactly once settlement")
      }
      let started = DispatchSemaphore(value: 0)
      let release = DispatchSemaphore(value: 0)
      let results = Results()
      let service = ThemeTransportService(testTimeout: 0.05) { _, _, _ in
        started.signal()
        _ = release.wait(timeout: .now() + 2)
        return ThemeHTTPResponse(status: 200, location: nil, contentType: nil, bytes: Data())
      }
      for id in ["one", "two"] {
        service.get(id, url: "https://example.com/", maximumBytes: 0, completion: results.append)
      }
      for _ in 0..<2 {
        require(started.wait(timeout: .now() + 1) == .success, "bounded worker started")
      }
      for _ in 0..<2 {
        require(results.signal.wait(timeout: .now() + 1) == .success, "bounded worker timed out")
      }
      let refused = Results()
      service.get("third", url: "https://example.com/", maximumBytes: 0, completion: refused.append)
      require(refused.snapshot() == ["unavailable"], "timed out OS workers retain slots")
      release.signal()
      release.signal()
    }
  #endif
}
