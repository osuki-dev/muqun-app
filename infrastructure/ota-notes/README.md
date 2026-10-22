# OTA metadata endpoints

The Cloudflare Worker uses the root Hot Updater package pins and mounts only its
client handlers.
Requests to the update domain use the existing `x-api-key` client credential.
Provider credentials and signing keys never belong in App requests. Localized
notes retain their existing schema; download-size metadata uses SDK endpoints
and requires no custom endpoint or database migration.

## Download size before consent

The public client plugin's `onUpdateCheck` hook associates `toReleaseId` with
`toBundleId` and `fromBundleId`. The App requests the SDK's
`GET /artifacts/v1/:toBundleId/from/:fromBundleId` endpoint, then reads its
presigned manifest URL. Forward the client key only to the update domain, never
to the manifest URL.

The App validates the manifest's target bundle identity and obtains a positive
`fullBytes` from `archive.downloadByteSize` when an archive is available;
otherwise it sums the compressed assets' `downloadByteSize` values. This is the
complete compressed package size. Native cache reuse, patch selection, and
fallback can change the actual transfer; the SDK owns these decisions and
final progress uses native measured counters. The App does not reproduce a
native download estimate. The custom `/release-download-size` route is absent.

The App must obtain a known full size before enabling download consent. On a
metadata failure, retry only the artifact and manifest requests for the retained update;
do not stage a bundle, begin a transfer, reload, or automatically consent.

## Localized release notes

`GET /release-notes/:releaseId?locale=:uiLocale` still returns exactly one
`{ releaseId, locale, markdown }` document: exact locale, then language, then
English. A missing translation response leaves the catalog's English message
available. The shared release catalog is never rewritten for a locale.
Successful and error responses use `Cache-Control: private, no-store`, including
authentication failures handled by the SDK client handler.
