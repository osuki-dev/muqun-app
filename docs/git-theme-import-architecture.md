# Git-backed theme import

## Product contract

A repository is a source of theme data, never executable application code. Importing must not run package managers, hooks, filters, repository scripts, submodules, or Git LFS downloads. The application does not need an installed Git client.

Do not reject a theme solely because its total download exceeds an arbitrary package-size threshold. Show known download sizes, progress, cancellation, and actionable storage failures. This requires file-backed streaming rather than removing limits from the existing in-memory ZIP importer.

## Source and immutable identity

The initial production provider is public GitHub HTTPS. Generic SSH, file, ext, and credential-bearing repository URLs are not production inputs. A provider resolves a selected branch or tag once to a full commit object ID. Inspection, consent, asset retrieval, and installation all use that same immutable revision.

Read the selected manifest and only its declared assets through verified Git objects. Tree ancestors must be directories and leaves regular files. Reject symlinks, gitlinks, special modes, unsafe paths, and LFS pointer substitution. Verify object identities, then manifest-declared asset hashes. Do not use a checkout or a Contents endpoint that silently dereferences links.

## Responsibilities

1. Provider: resolve revision and retrieve immutable commit, tree, and blob objects
2. Inspector: validate source, paths, object identity, manifest schema, and declared asset inventory
3. Acquisition: stream assets individually into an installation-owned staging directory, reporting progress and cancellation
4. Validation: verify actual bytes, declared hashes, supported image formats, decoded dimensions, and runtime memory budgets
5. Installation: atomically publish a complete durable theme; preserve the current theme on failure
6. Presentation: inspect source and revision, preview both appearances, then explicitly apply

Download failures, invalid objects, cancellation, and storage exhaustion must not partially update the library. Cleanup owns only the current import's staging files and must not garbage-collect references from incomplete metadata recovery.

## Resource safety without an arbitrary total cap

Bound manifest parsing, individual decode memory, path depth, metadata work, concurrent requests, and decompression work. Read and stage assets incrementally. Check available storage when possible, but also handle disk-write failures because a preflight check cannot reserve space.

The current ThemePackage and prepareThemeAssets APIs retain complete byte arrays. They are not an unlimited-size implementation. Production completion requires a staged-file asset interface and incremental validation. Existing protections must remain until that replacement is tested; merely increasing constants is not an implementation.

## Network boundary

Repository transport sends no application or Gateway credentials. Revalidate redirects and enforce reviewed resource origins. The current security contract also requires enforcement of public destination addresses across DNS resolution and connection establishment. The existing JavaScript transport interface does not itself provide this native guarantee. Do not advertise production remote import until its actual transport is implemented and tested.

## Local Git acceptance

Use a newly created private temporary repository, isolated Git configuration, argument arrays, and object reads only. Fixture files are created deliberately; never import a user's working repository for tests. This adapter is test-only and does not enable file URLs or loopback bypasses in production.

Verify a complete local theme at a pinned commit, changes to a branch after inspection, object tampering, missing assets, hash mismatches, symlinks, submodules, LFS pointers, unsafe paths, cancellation, and resource-budget failures. Feed accepted data through the same theme and image validators used by the app. A successful local object test is not proof that production HTTPS transport or native device import works.

## Delivery status

This is the agreed architecture, not a completion claim. The Git object importer and isolated-repository tests are in development. File-backed incremental installation, production network transport, and device acceptance remain separate gates. Documentation stays local and is excluded from GitHub pushes at the user's request.
