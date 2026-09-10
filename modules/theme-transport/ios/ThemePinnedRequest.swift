import Darwin
import Foundation
import Security
import dnssd

/// A socket created from one already-validated sockaddr. SecureTransport wraps that
/// socket directly: no URL loading system, proxy selection, HTTP auth or cookie jar.
/// Deprecated SecureTransport remains available on the iOS 16.4 minimum; replacing
/// it must preserve hard destination pinning, not a "prefer no proxy" fallback.
final class ThemePinnedRequest {
  private let lock = NSLock()
  private var cancelled = false
  private var socketFD: Int32 = -1
  private let deadline = DispatchTime.now().uptimeNanoseconds + 30_000_000_000
  private var wantsRead = false
  private var wantsWrite = false

  func cancel() {
    lock.lock()
    cancelled = true
    if socketFD >= 0 { Darwin.shutdown(socketFD, SHUT_RDWR) }
    lock.unlock()
  }

  private func check() throws {
    lock.lock()
    let stopped = cancelled
    lock.unlock()
    if stopped { throw ThemeTransportError.cancelled }
    if DispatchTime.now().uptimeNanoseconds >= deadline { throw ThemeTransportError.timeout }
  }

  func get(_ destination: ThemePublicDestination, maximumBytes: Int) throws -> ThemeHTTPResponse {
    try check()
    let address = try resolve(destination.host)
    try check()
    try connect(address)
    defer { closeSocket() }
    guard let tls = SSLCreateContext(nil, .clientSide, .streamType) else {
      throw ThemeTransportError.tls
    }
    let pointer = Unmanaged.passUnretained(self).toOpaque()
    guard SSLSetIOFuncs(tls, Self.readSocket, Self.writeSocket) == noErr,
      SSLSetConnection(tls, pointer) == noErr,
      SSLSetProtocolVersionMin(tls, .tlsProtocol12) == noErr,
      SSLSetSessionOption(tls, .breakOnServerAuth, true) == noErr
    else { throw ThemeTransportError.tls }
    let hostname = Array(destination.host.utf8)
    let configured = hostname.withUnsafeBytes {
      SSLSetPeerDomainName(tls, $0.baseAddress!, $0.count)
    }
    guard configured == noErr else { throw ThemeTransportError.tls }
    // HTTP/1.1 is the only negotiated application protocol. Do not share sessions or client identities.
    guard SSLSetALPNProtocols(tls, ["http/1.1"] as CFArray) == noErr else {
      throw ThemeTransportError.tls
    }
    var verified = false
    while true {
      try check()
      wantsRead = false
      wantsWrite = false
      let status = SSLHandshake(tls)
      if status == errSSLPeerAuthCompleted {
        guard !verified else { throw ThemeTransportError.tls }
        var trust: SecTrust?
        guard SSLCopyPeerTrust(tls, &trust) == noErr, let trust,
          SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, destination.host as CFString))
            == errSecSuccess,
          SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess,
          SecTrustEvaluateWithError(trust, nil)
        else { throw ThemeTransportError.tls }
        verified = true
      } else if status == noErr {
        guard verified else { throw ThemeTransportError.tls }
        break
      } else if status == errSSLWouldBlock {
        try waitForSocket()
      } else {
        throw ThemeTransportError.tls
      }
    }
    let request = destination.request
    var offset = 0
    while offset < request.count {
      try check()
      wantsRead = false
      wantsWrite = false
      var written = 0
      let status = request.withUnsafeBytes {
        SSLWrite(tls, $0.baseAddress!.advanced(by: offset), request.count - offset, &written)
      }
      offset += written
      if status == errSSLWouldBlock {
        try waitForSocket()
      } else if status != noErr {
        throw ThemeTransportError.network
      } else if written == 0 {
        throw ThemeTransportError.network
      }
    }
    let parser = try ThemeHTTPParser(maximumBytes: maximumBytes)
    var bytes = [UInt8](repeating: 0, count: 32 * 1024)
    while true {
      try check()
      wantsRead = false
      wantsWrite = false
      var received = 0
      let status = SSLRead(tls, &bytes, bytes.count, &received)
      // Renegotiation/client-cert requests and unclean TLS truncation are rejected.
      guard status == noErr || status == errSSLWouldBlock || status == errSSLClosedGraceful else {
        throw ThemeTransportError.network
      }
      if let response = try parser.append(
        Data(bytes.prefix(received)), eof: status == errSSLClosedGraceful)
      {
        try check()
        return response
      }
      if status == errSSLWouldBlock {
        try waitForSocket()
      } else if received == 0 {
        throw ThemeTransportError.network
      }
    }
  }

  private func connect(_ address: Data) throws {
    // Darwin sockaddr begins with one-byte length and family; avoid an aligned
    // Swift load from Data's potentially unaligned inline storage.
    guard address.count >= 2 else { throw ThemeTransportError.destination }
    let family = Int32(address[address.startIndex + 1])
    let fd = Darwin.socket(family, SOCK_STREAM, IPPROTO_TCP)
    guard fd >= 0 else { throw ThemeTransportError.network }
    lock.lock()
    if cancelled {
      lock.unlock()
      Darwin.close(fd)
      throw ThemeTransportError.cancelled
    }
    socketFD = fd
    lock.unlock()
    do {
      var yes: Int32 = 1
      guard
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout.size(ofValue: yes)))
          == 0,
        fcntl(fd, F_SETFL, O_NONBLOCK) == 0
      else { throw ThemeTransportError.network }
      let result = address.withUnsafeBytes {
        Darwin.connect(
          fd, $0.baseAddress!.assumingMemoryBound(to: sockaddr.self), socklen_t(address.count))
      }
      if result != 0 {
        guard errno == EINPROGRESS else { throw ThemeTransportError.network }
        wantsWrite = true
        wantsRead = false
        try waitForSocket()
        var error: Int32 = 0
        var length = socklen_t(MemoryLayout.size(ofValue: error))
        guard getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &length) == 0, error == 0 else {
          throw ThemeTransportError.network
        }
      }
    } catch {
      closeSocket()
      throw error
    }
  }

  private func closeSocket() {
    lock.lock()
    if socketFD >= 0 {
      Darwin.close(socketFD)
      socketFD = -1
    }
    lock.unlock()
  }

  private func waitForSocket() throws {
    while true {
      try check()
      let events = Int16((wantsRead ? POLLIN : 0) | (wantsWrite ? POLLOUT : 0))
      guard events != 0 else { throw ThemeTransportError.network }
      var descriptor = pollfd(fd: socketFD, events: events, revents: 0)
      let result = Darwin.poll(&descriptor, 1, 50)
      if result < 0 && errno != EINTR { throw ThemeTransportError.network }
      if result > 0 {
        if descriptor.revents & Int16(POLLNVAL | POLLERR) != 0 { throw ThemeTransportError.network }
        return
      }
    }
  }

  private static let readSocket: SSLReadFunc = { connection, data, length in
    let request = Unmanaged<ThemePinnedRequest>.fromOpaque(connection).takeUnretainedValue()
    let wanted = length.pointee
    let count = Darwin.recv(request.socketFD, data, wanted, 0)
    if count > 0 {
      length.pointee = count
      if count < wanted {
        request.wantsRead = true
        return errSSLWouldBlock
      }
      return noErr
    }
    length.pointee = 0
    if count == 0 { return errSSLClosedAbort }
    if errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR {
      request.wantsRead = true
      return errSSLWouldBlock
    }
    return errSecIO
  }

  private static let writeSocket: SSLWriteFunc = { connection, data, length in
    let request = Unmanaged<ThemePinnedRequest>.fromOpaque(connection).takeUnretainedValue()
    let wanted = length.pointee
    let count = Darwin.send(request.socketFD, data, wanted, 0)
    if count >= 0 {
      length.pointee = count
      if count < wanted {
        request.wantsWrite = true
        return errSSLWouldBlock
      }
      return noErr
    }
    length.pointee = 0
    if errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR {
      request.wantsWrite = true
      return errSSLWouldBlock
    }
    return errSecIO
  }

  private final class DNSAnswer {
    let answers: ThemeDNSAnswers
    let signal = DispatchSemaphore(value: 0)
    init(preferredFamily: Int32) {
      answers = ThemeDNSAnswers(preferred: preferredFamily == AF_INET ? .ipv4 : .ipv6)
    }
  }

  private final class DNSQuery {
    let answer: DNSAnswer
    let family: ThemeDNSAnswers.Family
    init(answer: DNSAnswer, family: ThemeDNSAnswers.Family) {
      self.answer = answer
      self.family = family
    }
  }

  private static func preferredFamily() -> Int32 {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0 else { return AF_INET }
    defer { freeifaddrs(list) }
    var current = list
    while let item = current {
      defer { current = item.pointee.ifa_next }
      guard item.pointee.ifa_flags & UInt32(IFF_UP) != 0,
        item.pointee.ifa_flags & UInt32(IFF_LOOPBACK) == 0,
        let address = item.pointee.ifa_addr, address.pointee.sa_family == AF_INET
      else { continue }
      let value = UnsafeRawPointer(address).assumingMemoryBound(to: sockaddr_in.self).pointee
        .sin_addr
      let bytes = withUnsafeBytes(of: value) { Array($0) }
      if bytes[0] != 0 && bytes[0] != 127 && !(bytes[0] == 169 && bytes[1] == 254) {
        return AF_INET
      }
    }
    return AF_INET6
  }

  private func resolve(_ host: String) throws -> Data {
    // DNSService cancellation is bounded; unlike getaddrinfo it cannot leave an
    // unbounded pool of stuck resolver threads after a timeout.
    let queue = DispatchQueue(label: "dev.osuki.muqun.theme-dns")
    let answer = DNSAnswer(preferredFamily: Self.preferredFamily())
    let queries = [
      DNSQuery(answer: answer, family: .ipv4), DNSQuery(answer: answer, family: .ipv6),
    ]
    var services: [DNSServiceRef] = []
    // Keep each callback context alive until both queued services have been deallocated.
    defer {
      withExtendedLifetime(queries) { queue.sync { services.forEach(DNSServiceRefDeallocate) } }
    }
    for query in queries {
      var service: DNSServiceRef?
      let protocolFamily =
        query.family == .ipv4 ? kDNSServiceProtocol_IPv4 : kDNSServiceProtocol_IPv6
      // Request authoritative negative answers too. Without this flag a missing
      // AAAA record can remain silent indefinitely even after the A batch completed.
      let created = DNSServiceGetAddrInfo(
        &service, DNSServiceFlags(kDNSServiceFlagsTimeout | kDNSServiceFlagsReturnIntermediates), 0,
        DNSServiceProtocol(protocolFamily),
        host + ".",
        { _, flags, _, error, _, address, _, context in
          guard let context else { return }
          let query = Unmanaged<DNSQuery>.fromOpaque(context).takeUnretainedValue()
          let answers = query.answer.answers
          guard answers.result == nil else { return }
          defer { if answers.result != nil { query.answer.signal.signal() } }
          if error == kDNSServiceErr_NoSuchRecord {
            answers.empty(query.family)
            return
          }
          guard error == kDNSServiceErr_NoError, let address,
            flags & DNSServiceFlags(kDNSServiceFlagsAdd) != 0
          else {
            answers.fail()
            return
          }
          let moreComing = flags & DNSServiceFlags(kDNSServiceFlagsMoreComing) != 0
          if query.family == .ipv4 && address.pointee.sa_family == AF_INET {
            let socket = UnsafeRawPointer(address).assumingMemoryBound(to: sockaddr_in.self).pointee
            answers.add(
              withUnsafeBytes(of: socket.sin_addr) { Array($0) }, family: .ipv4,
              moreComing: moreComing)
          } else if query.family == .ipv6 && address.pointee.sa_family == AF_INET6 {
            let socket = UnsafeRawPointer(address).assumingMemoryBound(to: sockaddr_in6.self)
              .pointee
            answers.add(
              withUnsafeBytes(of: socket.sin6_addr) { Array($0) }, family: .ipv6,
              scopeID: socket.sin6_scope_id, moreComing: moreComing)
          } else {
            answers.fail()
          }
        }, Unmanaged.passUnretained(query).toOpaque())
      guard created == kDNSServiceErr_NoError, let service else {
        throw ThemeTransportError.destination
      }
      services.append(service)
      guard DNSServiceSetDispatchQueue(service, queue) == kDNSServiceErr_NoError else {
        throw ThemeTransportError.destination
      }
    }
    while answer.signal.wait(timeout: .now() + .milliseconds(50)) == .timedOut { try check() }
    try check()
    return try queue.sync { try answer.answers.result!.get() }
  }
}
