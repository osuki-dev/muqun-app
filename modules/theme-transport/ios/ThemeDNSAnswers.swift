import Darwin
import Foundation

/// The first complete initial A and AAAA batches are checked together before
/// opening any socket. A usable A must not hide a later private AAAA (or vice versa).
/// After selection the exact sockaddr is pinned; later DNS changes cannot retarget it.
final class ThemeDNSAnswers {
  enum Family: Hashable { case ipv4, ipv6 }
  private let preferred: Family
  private var finished = Set<Family>()
  private var addresses: [(Family, Data)] = []
  private var records = 0
  private(set) var result: Result<Data, Error>?

  init(preferred: Family) { self.preferred = preferred }

  func fail() { if result == nil { result = .failure(ThemeTransportError.destination) } }

  func empty(_ family: Family) {
    guard result == nil else { return }
    finished.insert(family)
    selectIfComplete()
  }

  func add(_ bytes: [UInt8], family: Family, scopeID: UInt32 = 0, moreComing: Bool) {
    guard result == nil else { return }
    records += 1
    guard records <= 64, scopeID == 0 else {
      fail()
      return
    }
    let data: Data
    switch family {
    case .ipv4:
      guard ThemePublicDestination.publicIPv4(bytes) else {
        fail()
        return
      }
      var address = sockaddr_in()
      address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
      address.sin_family = sa_family_t(AF_INET)
      address.sin_port = UInt16(443).bigEndian
      withUnsafeMutableBytes(of: &address.sin_addr) { $0.copyBytes(from: bytes) }
      data = withUnsafeBytes(of: address) { Data($0) }
    case .ipv6:
      guard ThemePublicDestination.publicIPv6(bytes) else {
        fail()
        return
      }
      var address = sockaddr_in6()
      address.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
      address.sin6_family = sa_family_t(AF_INET6)
      address.sin6_port = UInt16(443).bigEndian
      withUnsafeMutableBytes(of: &address.sin6_addr) { $0.copyBytes(from: bytes) }
      data = withUnsafeBytes(of: address) { Data($0) }
    }
    if !addresses.contains(where: { $0.1 == data }) { addresses.append((family, data)) }
    if !moreComing { finished.insert(family) }
    selectIfComplete()
  }

  private func selectIfComplete() {
    guard finished.count == 2 else { return }
    guard let selected = addresses.first(where: { $0.0 == preferred }) ?? addresses.first else {
      fail()
      return
    }
    result = .success(selected.1)
  }
}
