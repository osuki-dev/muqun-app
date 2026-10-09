# Muqun

Muqun is an iOS and Android app for viewing and interacting with coding agents
and terminal sessions running on your own computer. It connects to the
self-hosted [Muqun Gateway](https://github.com/osuki-dev/muqun-gateway), with no
Muqun account or hosted relay.

This repository contains the Expo and React Native application. Issues and pull
requests are welcome.

Download the official app from [muqun.dev](https://muqun.dev).

## Voice to text

On iOS and Android, open Settings > Voice to text and choose a transcription mode:

- **After recording** (the default): enter the full HTTPS endpoint for an
  OpenAI-compatible multipart transcription API returning JSON with `text`.
  Audio is uploaded after stopping.
- **Realtime**: enter the full WSS endpoint for the OpenAI Realtime transcription
  protocol and choose a model that produces live transcription, such as
  `gpt-live-transcribe`. Audio streams as 24 kHz mono PCM; partial text appears in
  the sheet while speaking. Tap to stop and wait for the final transcript.
  A streaming response to a completed file upload is not live microphone
  transcription. Other providers' WebSocket protocols are not interchangeable.

URLs are used exactly as entered, including custom paths and queries. API key
and model are optional in the app; the configured service may require them.
The API key is kept in this device's SecureStore. Existing configurations remain
in After recording mode. Muqun never probes endpoints, retries a recording, or
switches modes automatically. OpenRouter's documented file transcription API
uses After recording mode.

Once configured, hold Send in either a session or terminal to record, then tap
the animation to stop. Recognition follows the App
language unless overridden; Auto-detect sends no language hint. Recordings are
limited to two minutes. Text is inserted into the current draft without sending
it; turn off Insert text automatically to review and edit it first. Cancelling,
leaving the recording sheet or backgrounding the App discards the recording.
File-mode temporary audio is removed after completion or cancellation. Realtime
capture creates no audio file; cancelling closes the connection and discards
partial text. Clear configuration
to disable Voice to text.

File recording requires a native build containing `react-native-nitro-sound`;
Expo Go and older native builds do not expose the microphone. A new native
runtime must be shipped before distributing an OTA that depends on the recorder.
Realtime capture uses Expo SDK 57's `expo-audio` `AudioStream`. It does not
replace or patch Nitro Sound or enable background recording.

## Audio previews

Audio tool outputs play inline in the conversation, with a waveform and playback
progress. Audio files can also be opened from session Files. Play, pause, seek,
or replay them. Playback starts only when you choose Play. Files are downloaded
through the authenticated Gateway transport into temporary storage, with a
10 MiB limit; scrolling an inline player out of view, closing the preview,
backgrounding the App or starting dictation stops playback and removes its
temporary file. Returning to a message never resumes playback automatically.
Only one preview plays at a time.

This requires a Gateway that identifies audio assets and a native App build
containing Nitro Sound. Supported formats depend on the platform's native
decoder. Video previews are not available yet.

## License

The source is available to read, fork, modify, and contribute to. Public
distribution of compiled builds—including App Store, Google Play, TestFlight,
APK, IPA, marketplace, or download releases—requires prior written permission
from muqun.dev.

See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), and
[`TRADEMARK.md`](TRADEMARK.md).
