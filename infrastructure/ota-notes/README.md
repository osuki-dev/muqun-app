# OTA metadata endpoints

The custom Cloudflare Worker runs Hot Updater 1.0.1 and mounts only its client
handlers. Both endpoints use the existing `x-api-key` client credential and
return `Cache-Control: private, no-store`. Provider credentials and signing keys
never belong in App requests. Adding the size endpoint does not change the
localized-notes schema or require a database migration.

## Download size before consent

`GET /release-download-size/:releaseId?fromBundleId=:runningBundleId` accepts
UUIDv7 release and artifact identities. The target must be an enabled release.
Its successful response contains only:

```json
{
  "releaseId": "<requested release ID>",
  "fromBundleId": "<running artifact ID>",
  "estimatedBytes": 847397,
  "fullBytes": 11090275
}
```

`fullBytes` is mandatory, positive, and measured from published download
metadata: the complete archive when available, otherwise the original file
payloads. `estimatedBytes` may be `null` when the base is unknown or a reliable
incremental plan cannot be established. It estimates the selected patch/file
plan against the supplied base; native cache reuse and transfer fallback can
change the actual download. Final progress uses native measured counters.

Malformed identities return 400; an unknown or disabled release, or a known
base on another platform, returns 404. Missing/invalid authentication returns 401. Missing or invalid metadata that prevents a known full size returns 503,
never a successful response with an unknown full size. Responses expose no
artifact download URLs, storage URIs, or provider error details.

The App must obtain a known full size before enabling download consent. On a
metadata failure, retry only this metadata request for the retained update;
do not stage a bundle, begin a transfer, reload, or automatically consent.

## Localized release notes

`GET /release-notes/:releaseId?locale=:uiLocale` still returns exactly one
`{ releaseId, locale, markdown }` document: exact locale, then language, then
English. A missing translation response leaves the catalog's English message
available. The shared release catalog is never rewritten for a locale.
