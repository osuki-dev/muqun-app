import ExpoModulesCore

public class MuqunThemeTransportModule: Module {
  private let transport = ThemeTransportService()

  public func definition() -> ModuleDefinition {
    Name("MuqunThemeTransport")

    Constants(["contractVersion": 1])

    AsyncFunction("get") { (requestId: String, url: String, maxBytes: Int, promise: Promise) in
      self.transport.get(requestId, url: url, maximumBytes: maxBytes) { result in
        switch result {
        case .success(let response):
          var value: [String: Any] = ["status": response.status, "bytes": response.bytes]
          if let location = response.location { value["location"] = location }
          if let contentType = response.contentType { value["contentType"] = contentType }
          promise.resolve(value)
        case .failure(let error):
          // Never bridge raw system errors that could contain a URL or certificate subject.
          let code = (error as? ThemeTransportError).map { String(describing: $0) } ?? "unavailable"
          promise.reject(
            "ERR_THEME_TRANSPORT_\(code.uppercased())", "Public theme download failed (\(code))")
        }
      }
    }

    Function("cancel") { (requestId: String) in self.transport.cancel(requestId) }
    OnDestroy { self.transport.destroy() }
    OnAppContextDestroys { self.transport.destroy() }
  }
}
