# Contributing

Thank you for helping. This guide covers setup on Windows, macOS and Linux, the
checks your change must pass, and how pull requests are reviewed. By taking part
you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Security problems are not reported here: see [SECURITY.md](SECURITY.md).

## What you need

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 24 (see `.nvmrc`) | nvm, fnm or the installer from nodejs.org |
| Yarn | 4, through Corepack | run `corepack enable` once; do not install Yarn globally |
| JDK | 17 | for Android builds |
| Android SDK | platform 36, build-tools 36, NDK 27.1 | Android Studio installs these |
| Xcode | 16 | macOS only, for iOS (experimental) |
| Python | 3.10 or newer | only for `ml_prep/` and `backend/` |

Windows works for everything except iOS. Use PowerShell or Git Bash; the project
scripts are written in Node, so they run the same everywhere.

## Setup

```sh
git clone https://github.com/<your-username>/faceproof.git
cd faceproof
corepack enable
yarn install
yarn setup
```

`yarn setup` downloads the two models and checks their SHA-256 hashes
(`yarn setup:models`), then creates the debug signing key for the example app
(`yarn setup:keystore`). Both results are git-ignored.

The repository is a Yarn workspace: the library is at the root, the example app
in `example/`.

## Running the example app

```sh
yarn example start      # Metro bundler
yarn example android    # in a second terminal, with a phone or emulator
yarn example ios        # macOS; run `cd example/ios && pod install` first
```

Face features need a real camera; an emulator only checks that the app starts.
Changes in `src/` reload in the app; changes in `android/` or `ios/` need a rebuild.

### Windows: release builds and long paths

Debug builds work from any folder, but a local release build
(`assembleRelease`) can fail on Windows with
`ninja: error: manifest 'build.ninja' still dirty after 100 tries` in a
native dependency. The CMake build paths get too long for Windows. Clone
the repository to a short path, for example `C:\src\dlb`, and build there.
Mapping a short drive letter with `subst` does not help, because the build
resolves the real path.

To get a release APK without building locally, run the "Release APK (test
only, debug-signed)" workflow from the Actions tab of your fork and download
the `example-release-apk` artifact. It is signed with a throwaway debug key,
so use it for testing only.

## Checks

Run these before opening a pull request. CI runs the same ones.

```sh
yarn lint:encoding        # files are UTF-8 without BOM, no garbled characters
yarn lint:react           # react matches the renderer bundled in React Native
yarn lint                 # ESLint and Prettier (yarn lint --fix fixes formatting)
yarn typecheck            # library types
yarn example typecheck    # example app types
yarn test                 # library tests
yarn example test         # example app tests
yarn prepare              # builds the library into lib/
yarn build:web            # checks that the example still bundles for the web
```

For native or backend changes, also run:

```sh
cd example/android && ./gradlew :faceproof:testDebugUnitTest   # Kotlin unit tests
cd backend && python -m pytest                                             # see backend/README.md
```

On Windows use `gradlew.bat` instead of `./gradlew`.

Git hooks (installed by `yarn install` through lefthook) lint and type-check your
staged files and check your commit message.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org), checked by
commitlint:

```
<type>(<optional scope>): <subject>

<optional body: why the change is needed>
```

- `type` is one of: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`,
  `ci`, `chore`, `style`, `revert`.
- Useful scopes: `android`, `ios`, `js`, `liveness`, `example`, `backend`,
  `ml`, `docs`, `ci`.
- Subject in the imperative mood, lower case, no full stop, short (the whole
  first line must stay under 100 characters; aim for 72).
- Examples:
  - `fix(android): close the interpreter when the module is invalidated`
  - `docs: explain how to measure verify latency`

## Branches and pull requests

1. Comment on the issue you want to work on and wait to be assigned, so two
   people do not do the same work.
2. Fork the repository and create a branch from `main` named
   `<type>/<short-description>`, for example `fix/camera-permission-settings`.
3. Keep the pull request focused on one issue. Link it in the description
   (`Closes #123`).
4. Fill in the pull request template, including how you tested the change.
5. Make sure all checks pass. A maintainer will review; please answer comments
   by pushing new commits rather than force-pushing, so the review is easy to follow.

## What makes a good pull request

- It solves the linked issue and nothing else. No unrelated formatting changes.
- It includes tests for new behavior, or explains why a test is not practical.
- It updates the documentation when behavior or the API changes.
- Native changes cover both Android and iOS, or say clearly that they only touch one.
- New dependencies are necessary, actively maintained and have a license
  compatible with Apache-2.0. Mention them in the description.
- It never writes face images or templates to disk or logs, and never sends
  them over the network.
- Documentation is in plain English, ASCII punctuation, and makes no claim that
  is not measured or cited.

## Open-source event rules

During community events (for example Hacktoberfest), we value quality over quantity.

- Only pull requests that address an open issue, or a fix that clearly deserves
  one, are reviewed.
- Pull requests that only change whitespace, reword text without improving it,
  add your name somewhere, or are generated without understanding the code, are
  closed and labelled `invalid` or `spam`.
- Accepted pull requests are labelled `hacktoberfest-accepted`.
- Be patient: maintainers are volunteers. Do not ping repeatedly.

## Getting help

See [SUPPORT.md](SUPPORT.md).

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), as stated in its section 5.
