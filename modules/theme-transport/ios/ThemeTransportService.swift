import Foundation

/// Bounded, synchronous registration/cancellation prevents an abort racing a
/// queued Expo AsyncFunction from starting a request after it was cancelled.
final class ThemeTransportService {
  private let lock = NSLock()
  private let workers = DispatchQueue(
    label: "dev.osuki.muqun.theme-transport", attributes: .concurrent)
  private final class Entry {
    let request = ThemePinnedRequest()
    var completion: ((Result<ThemeHTTPResponse, Error>) -> Void)?
    var timer: DispatchWorkItem?
    init(_ completion: @escaping (Result<ThemeHTTPResponse, Error>) -> Void) {
      self.completion = completion
    }
  }
  private var requests: [String: Entry] = [:]
  private var cancelledIDs = Set<String>()
  private var closed = false
  private var timeoutSeconds: Double = 30
  private var perform:
    (ThemePinnedRequest, ThemePublicDestination, Int) throws -> ThemeHTTPResponse = {
      try $0.get($1, maximumBytes: $2)
    }

  init() {}

  #if THEME_TRANSPORT_TESTING
    // Test-only blocked OS-operation simulation. No alternate runtime network adapter.
    init(
      testTimeout: Double,
      testPerform:
        @escaping (ThemePinnedRequest, ThemePublicDestination, Int) throws -> ThemeHTTPResponse
    ) {
      timeoutSeconds = testTimeout
      perform = testPerform
    }
  #endif

  func get(
    _ id: String, url: String, maximumBytes: Int,
    completion: @escaping (Result<ThemeHTTPResponse, Error>) -> Void
  ) {
    guard !id.isEmpty, id.utf8.count <= 128, (0...25 * 1024 * 1024).contains(maximumBytes) else {
      completion(.failure(ThemeTransportError.invalidRequest))
      return
    }
    let destination: ThemePublicDestination
    do { destination = try ThemePublicDestination(url) } catch {
      completion(.failure(error))
      return
    }
    lock.lock()
    guard !closed, !cancelledIDs.contains(id), requests[id] == nil, requests.count < 2 else {
      lock.unlock()
      completion(.failure(ThemeTransportError.unavailable))
      return
    }
    let entry = Entry(completion)
    requests[id] = entry
    let timeout = DispatchWorkItem { [weak self, weak entry] in
      guard let self, let entry else { return }
      entry.request.cancel()
      self.finish(
        id, entry: entry, result: .failure(ThemeTransportError.timeout), workerFinished: false)
    }
    entry.timer = timeout
    lock.unlock()
    DispatchQueue.global().asyncAfter(deadline: .now() + timeoutSeconds, execute: timeout)
    workers.async { [self] in
      let result = Result { try perform(entry.request, destination, maximumBytes) }
      finish(id, entry: entry, result: result, workerFinished: true)
    }
  }

  private func finish(
    _ id: String, entry: Entry, result: Result<ThemeHTTPResponse, Error>, workerFinished: Bool
  ) {
    lock.lock()
    guard requests[id] === entry else {
      lock.unlock()
      return
    }
    if workerFinished { requests.removeValue(forKey: id) }
    // Retain the occupied worker slot after timeout until it actually exits.
    // A stuck OS trust evaluator cannot cause unbounded replacement workers.
    let completion = entry.completion
    entry.completion = nil
    entry.timer?.cancel()
    entry.timer = nil
    let stopped = closed || cancelledIDs.contains(id)
    lock.unlock()
    completion?(stopped ? .failure(ThemeTransportError.cancelled) : result)
  }

  func cancel(_ id: String) {
    guard !id.isEmpty, id.utf8.count <= 128 else { return }
    lock.lock()
    // Never evict a tombstone and accidentally revive an older cancelled get.
    // Flooding unique cancels closes this module instance instead of growing memory.
    if !cancelledIDs.contains(id) && cancelledIDs.count >= 1024 {
      closed = true
      for entry in requests.values { entry.request.cancel() }
    } else {
      cancelledIDs.insert(id)
      requests[id]?.request.cancel()
    }
    let stopping = closed ? requests : requests.filter { $0.key == id }
    lock.unlock()
    for (key, entry) in stopping {
      finish(
        key, entry: entry, result: .failure(ThemeTransportError.cancelled), workerFinished: false)
    }
  }

  func destroy() {
    lock.lock()
    closed = true
    let stopping = requests
    for entry in stopping.values { entry.request.cancel() }
    lock.unlock()
    for (key, entry) in stopping {
      finish(
        key, entry: entry, result: .failure(ThemeTransportError.cancelled), workerFinished: false)
    }
  }
}
