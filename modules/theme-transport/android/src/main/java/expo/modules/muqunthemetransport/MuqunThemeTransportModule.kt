package expo.modules.muqunthemetransport

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class MuqunThemeTransportModule : Module() {
  private val transport = PublicThemeClient()
  override fun definition() = ModuleDefinition {
    Name("MuqunThemeTransport")
    Constant("contractVersion") { 1 }
    AsyncFunction("get") { requestId: String, url: String, maxBytes: Int, promise: Promise ->
      transport.get(requestId, url, maxBytes,
        { promise.resolve(it) },
        { promise.reject("ERR_THEME_TRANSPORT", "Theme download failed or was canceled", null) })
    }
    Function("cancel") { requestId: String -> transport.cancel(requestId) }
    OnDestroy { transport.close() }
  }
}
