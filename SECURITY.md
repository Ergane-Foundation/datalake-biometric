# Security policy

This SDK handles biometric data, so security reports are taken seriously and
handled privately.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub: open the repository's **Security** tab and
click **Report a vulnerability** (GitHub private vulnerability reporting). Only
the maintainers can see the report.

Please include:

- what is affected (file, function, platform, version or commit);
- steps to reproduce, or a proof of concept;
- the impact you expect, and any idea for a fix.

What to expect:

- an acknowledgement within 7 days;
- an assessment and a plan within 30 days;
- credit in the advisory and the changelog when the fix is released, unless you
  prefer to stay anonymous.

This is a volunteer project, so these are goals, not guarantees.

## In scope

- Exposure of biometric data: templates, images or frames that reach disk, logs,
  backups or the network when they should not.
- Key handling: the database passphrase or signing key leaking, being weaker than
  documented, or being usable on another device.
- Encrypted storage that is not actually encrypted.
- Liveness bypasses with a still image or a single photo (the documented limits,
  such as video replay, are known; see below).
- Signature forgery or record tampering that the documented design should prevent.
- The reference sync backend: authentication bypass, injection, data exposure.

## Out of scope

- Limits already documented in [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md),
  for example video replay, deepfake or mask attacks on the active liveness
  check, or attacks that need root access and a debugger on an unlocked phone.
- Face recognition accuracy in general (please open a normal issue).
- Vulnerabilities in dependencies that do not affect this project; report those
  to the dependency.
- Your own deployment of the backend, unless the problem is in this repository's code.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.2.x | Yes |
| 0.1.x and older | No |

Before 1.0, only the latest minor version gets security fixes.

## How the SDK protects data

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) and [docs/PRIVACY.md](docs/PRIVACY.md).
