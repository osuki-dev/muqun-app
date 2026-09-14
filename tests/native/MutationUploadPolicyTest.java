import com.margelo.nitro.nitrofetch.MutationUploadPolicy;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.Executor;
import org.chromium.net.ExperimentalUrlRequest;
import org.chromium.net.UploadDataProvider;
import org.chromium.net.UploadDataSink;
import org.chromium.net.UrlRequest;

/** Runs against the pinned Cronet API; no network, device, Android mocks, or credentials. */
public final class MutationUploadPolicyTest {
  static final class Sink extends UploadDataSink {
    int readSuccess, readError, rewindSuccess, rewindError;
    public void onReadSucceeded(boolean last) { readSuccess++; }
    public void onReadError(Exception error) { readError++; }
    public void onRewindSucceeded() { rewindSuccess++; }
    public void onRewindError(Exception error) { rewindError++; }
  }
  static class UnsupportedBuilder extends UrlRequest.Builder {
    public UrlRequest.Builder setHttpMethod(String value) { return this; }
    public UrlRequest.Builder addHeader(String k, String v) { return this; }
    public UrlRequest.Builder disableCache() { return this; }
    public UrlRequest.Builder setPriority(int value) { return this; }
    public UrlRequest.Builder setUploadDataProvider(UploadDataProvider p, Executor e) { return this; }
    public UrlRequest.Builder allowDirectExecutor() { return this; }
    public UrlRequest build() { throw new UnsupportedOperationException(); }
  }
  static final class SupportedBuilder extends ExperimentalUrlRequest.Builder {
    int idempotency = -1;
    public ExperimentalUrlRequest.Builder setIdempotency(int value) { idempotency = value; return this; }
    public ExperimentalUrlRequest.Builder setHttpMethod(String value) { return this; }
    public ExperimentalUrlRequest.Builder addHeader(String k, String v) { return this; }
    public ExperimentalUrlRequest.Builder disableCache() { return this; }
    public ExperimentalUrlRequest.Builder setPriority(int value) { return this; }
    public ExperimentalUrlRequest.Builder setUploadDataProvider(UploadDataProvider p, Executor e) { return this; }
    public ExperimentalUrlRequest.Builder allowDirectExecutor() { return this; }
    public ExperimentalUrlRequest build() { throw new UnsupportedOperationException(); }
  }
  static void require(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }
  public static void main(String[] args) throws Exception {
    byte[] original = "one immutable upload".getBytes(StandardCharsets.UTF_8);
    for (String method : new String[]{"POST", "PATCH", "PUT", "DELETE", "post", "UNKNOWN"}) {
      require(!MutationUploadPolicy.allowsReplay(method), "mutation must not redirect or rewind");
      SupportedBuilder builder = new SupportedBuilder();
      MutationUploadPolicy.configure(builder, method);
      require(builder.idempotency == ExperimentalUrlRequest.Builder.NOT_IDEMPOTENT, "native hint missing");
      boolean unsupported = false;
      try { MutationUploadPolicy.configure(new UnsupportedBuilder(), method); }
      catch (IllegalStateException expected) { unsupported = true; }
      require(unsupported, "unknown engine must fail closed before dispatch");
      for (int consumed : new int[]{0, 3, original.length}) {
        UploadDataProvider provider = MutationUploadPolicy.body(original, method);
        Sink sink = new Sink();
        if (consumed > 0) provider.read(sink, ByteBuffer.allocate(consumed));
        provider.rewind(sink);
        require(sink.rewindError == 1 && sink.rewindSuccess == 0, "rewind must refuse before and after partial/full upload");
        ByteBuffer next = ByteBuffer.allocate(original.length);
        provider.read(sink, next);
        require(sink.readError == 1 && next.position() == 0, "refusal cannot reveal upload bytes again");
      }
      UploadDataProvider provider = MutationUploadPolicy.body(original, method);
      Sink sink = new Sink();
      ByteBuffer full = ByteBuffer.allocate(original.length);
      for (int count : new int[]{3, original.length - 3}) {
        ByteBuffer chunk = ByteBuffer.allocate(count);
        provider.read(sink, chunk);
        chunk.flip(); full.put(chunk);
      }
      require(Arrays.equals(full.array(), original) && sink.readSuccess == 2, "initial chunked reads must preserve bytes");
    }
    for (String method : new String[]{"GET", "HEAD", "OPTIONS", "get"}) {
      require(MutationUploadPolicy.allowsReplay(method), "read-only behavior changed");
      MutationUploadPolicy.configure(new UnsupportedBuilder(), method);
      UploadDataProvider provider = MutationUploadPolicy.body(original, method);
      Sink sink = new Sink();
      provider.read(sink, ByteBuffer.allocate(original.length));
      provider.rewind(sink);
      ByteBuffer repeated = ByteBuffer.allocate(original.length);
      provider.read(sink, repeated);
      require(sink.rewindSuccess == 1 && Arrays.equals(repeated.array(), original), "read-only rewind broken");
    }
    System.out.println("Mutation upload policy: all native assertions passed");
  }
}
