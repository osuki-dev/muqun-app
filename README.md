# Muqun

Muqun is an iOS and Android app for viewing and interacting with coding agents
and terminal sessions running on your own computer. It connects to the
self-hosted [Muqun Gateway](https://github.com/osuki-dev/muqun-gateway), with no
Muqun account or hosted relay.

This repository contains the Expo and React Native application. Issues and pull
requests are welcome.

Download the official app from [muqun.dev](https://muqun.dev).

## Voice to text

On iOS and Android, open Settings > Voice to text and configure an HTTPS speech
service base URL, API key and transcription model. The service must implement
the OpenAI-compatible `POST /audio/transcriptions` multipart API and return
JSON containing `text`. The API key is kept in this device's SecureStore.

The microphone appears in message inputs once configured. Tap it to record,
then tap Stop and transcribe. Recognition follows the App
language unless overridden; Auto-detect sends no language hint. Recordings are
limited to two minutes. Text is inserted into the current draft without sending
it; turn off Insert text automatically to review and edit it first. Cancelling,
leaving the recording sheet or backgrounding the App discards the recording.
Temporary audio is removed after completion or cancellation. Clear configuration
to disable Voice to text.

This feature requires a native build containing `react-native-nitro-sound`;
Expo Go and older native builds do not expose the microphone. A new native
runtime must be shipped before distributing an OTA that depends on the recorder.

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
