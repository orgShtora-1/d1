# Contributing

Thanks for considering a contribution to `@shtora/d1`.

## Before opening a pull request

For API or behavior changes, open an issue first to agree on the change. Bug fixes, documentation corrections, and focused tests can go directly to a pull request.

## Development setup

Use Bun 1.4.4, matching the CI configuration:

```sh
bun install --frozen-lockfile
```

Run the full package checks before submitting:

```sh
bun run prepublishOnly
```

This runs type checking, tests, a package build, and packed-consumer checks.

## Pull requests

Keep each pull request focused. Include the user-visible reason for the change, summarize behavior or API changes, and report the checks you ran. Update the README when a public behavior or usage pattern changes.
