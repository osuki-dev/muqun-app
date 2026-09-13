import Foundation

enum ThemeTransportError: Error {
  case invalidRequest, unavailable, cancelled, timeout, destination, tls, network, response, limit
}

struct ThemeHTTPResponse {
  let status: Int
  let location: String?
  let contentType: String?
  let bytes: Data
}

/// One HTTP/1.1 response, no redirects, compression, cookies, caching or authentication.
/// Wire metadata has an independent budget; decoded body bytes never exceed maximumBytes.
final class ThemeHTTPParser {
  private enum State {
    case headers
    case fixed(Int)
    case closeDelimited, chunkSize
    case chunk(Int)
    case chunkEnd, trailers, done
  }
  private var state: State = .headers
  private var buffer = Data()
  private var body = Data()
  private var status = 0
  private var location: String?
  private var contentType: String?
  private var metadataBytes = 0
  private let maximumBytes: Int
  private(set) var complete = false

  init(maximumBytes: Int) throws {
    guard (0...25 * 1024 * 1024).contains(maximumBytes) else {
      throw ThemeTransportError.invalidRequest
    }
    self.maximumBytes = maximumBytes
  }

  func append(_ bytes: Data, eof: Bool = false) throws -> ThemeHTTPResponse? {
    guard !complete, bytes.count <= 64 * 1024 else { throw ThemeTransportError.response }
    buffer.append(bytes)
    while true {
      switch state {
      case .headers:
        guard let range = buffer.range(of: Data("\r\n\r\n".utf8)) else {
          guard buffer.count <= 32 * 1024 else { throw ThemeTransportError.limit }
          return try incomplete(eof)
        }
        let count = buffer.distance(from: buffer.startIndex, to: range.upperBound)
        guard count <= 32 * 1024 else { throw ThemeTransportError.limit }
        let headers = buffer.prefix(count - 4)
        buffer.removeFirst(count)
        try parseHeaders(Data(headers))
      case .fixed(let remaining):
        let count = min(remaining, buffer.count)
        try takeBody(count)
        state = remaining == count ? .done : .fixed(remaining - count)
        if count == 0 && remaining != 0 { return try incomplete(eof) }
      case .closeDelimited:
        try takeBody(buffer.count)
        if eof { state = .done } else { return nil }
      case .chunkSize:
        guard let line = try nextLine(limit: 1024) else { return try incomplete(eof) }
        // Extensions are unnecessary for static downloads. Reject rather than ambiguously parse.
        guard !line.isEmpty, line.count <= 16, line.allSatisfy({ $0.isHexDigit }),
          let size = Int(line, radix: 16), size <= maximumBytes - body.count
        else {
          throw ThemeTransportError.limit
        }
        state = size == 0 ? .trailers : .chunk(size)
      case .chunk(let remaining):
        let count = min(remaining, buffer.count)
        try takeBody(count)
        state = count == remaining ? .chunkEnd : .chunk(remaining - count)
        if count == 0 { return try incomplete(eof) }
      case .chunkEnd:
        guard buffer.count >= 2 else { return try incomplete(eof) }
        guard buffer.prefix(2) == Data("\r\n".utf8) else { throw ThemeTransportError.response }
        buffer.removeFirst(2)
        state = .chunkSize
      case .trailers:
        guard let line = try nextLine(limit: 8192) else { return try incomplete(eof) }
        if line.isEmpty {
          state = .done
        } else {
          // No trailer fields influence framing, redirect destination or content interpretation.
          let field = try header(line)
          guard
            ![
              "content-length", "transfer-encoding", "content-encoding", "location", "content-type",
            ].contains(field.0)
          else {
            throw ThemeTransportError.response
          }
        }
      case .done:
        guard buffer.isEmpty else { throw ThemeTransportError.response }
        complete = true
        return ThemeHTTPResponse(
          status: status, location: location, contentType: contentType, bytes: body)
      }
    }
  }

  private func incomplete(_ eof: Bool) throws -> ThemeHTTPResponse? {
    if eof { throw ThemeTransportError.response }
    return nil
  }

  private func takeBody(_ count: Int) throws {
    guard count <= maximumBytes - body.count else { throw ThemeTransportError.limit }
    body.append(buffer.prefix(count))
    buffer.removeFirst(count)
  }

  private func nextLine(limit: Int) throws -> String? {
    guard let range = buffer.range(of: Data("\r\n".utf8)) else {
      guard buffer.count <= limit else { throw ThemeTransportError.limit }
      return nil
    }
    let count = buffer.distance(from: buffer.startIndex, to: range.lowerBound)
    metadataBytes += count + 2
    guard count <= limit, metadataBytes <= 64 * 1024,
      let line = String(data: buffer.prefix(count), encoding: .ascii)
    else { throw ThemeTransportError.limit }
    buffer.removeFirst(count + 2)
    return line
  }

  private func header(_ line: String) throws -> (String, String) {
    guard let colon = line.firstIndex(of: ":"), colon != line.startIndex else {
      throw ThemeTransportError.response
    }
    let name = String(line[..<colon])
    guard
      name.utf8.allSatisfy({
        (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45
      }),
      line.utf8.allSatisfy({ $0 == 9 || (32...126).contains($0) })
    else { throw ThemeTransportError.response }
    return (
      name.lowercased(),
      String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
    )
  }

  private func parseHeaders(_ data: Data) throws {
    guard let text = String(data: data, encoding: .ascii) else {
      throw ThemeTransportError.response
    }
    let lines = text.components(separatedBy: "\r\n")
    guard lines.count <= 101, let first = lines.first else { throw ThemeTransportError.response }
    let parts = first.split(separator: " ", omittingEmptySubsequences: false)
    guard parts.count >= 2, ["HTTP/1.1", "HTTP/1.0"].contains(String(parts[0])),
      parts[1].count == 3, let code = Int(parts[1]), (200...599).contains(code),
      first.utf8.allSatisfy({ (32...126).contains($0) })
    else { throw ThemeTransportError.response }
    status = code
    var values: [String: String] = [:]
    for line in lines.dropFirst() {
      let (key, value) = try header(line)
      // Ambiguous framing and duplicate interpretation fields are always refused.
      if values[key] != nil
        && ["content-length", "transfer-encoding", "content-encoding", "location", "content-type"]
          .contains(key)
      {
        throw ThemeTransportError.response
      }
      values[key] = value
    }
    guard
      values["content-encoding"] == nil || values["content-encoding"]?.lowercased() == "identity"
    else { throw ThemeTransportError.response }
    location = values["location"]
    contentType = values["content-type"]
    // Keep untrusted response strings outside Expo's internal dynamic-token
    // namespace on every platform, even though iOS currently converts them literally.
    guard
      ![location, contentType].contains(where: {
        $0?.hasPrefix("__expo_dynamic_extension__#") == true
      })
    else {
      throw ThemeTransportError.response
    }
    if let transfer = values["transfer-encoding"] {
      guard transfer.lowercased() == "chunked", values["content-length"] == nil, code != 204,
        code != 304
      else { throw ThemeTransportError.response }
      state = .chunkSize
    } else if let length = values["content-length"] {
      guard !length.isEmpty, length.utf8.allSatisfy({ (48...57).contains($0) }),
        let size = Int(length), size <= maximumBytes
      else { throw ThemeTransportError.limit }
      guard ![204, 304].contains(code) || size == 0 else { throw ThemeTransportError.response }
      state = .fixed(size)
    } else {
      state = [204, 304].contains(code) ? .done : .closeDelimited
    }
  }
}
