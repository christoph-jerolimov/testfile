---
"@testfile.dev/runner": patch
---

Service containers accept the engine's own network modes: `network: host`,
`none` and `bridge` are joined as such — nothing is created and no
`--network-alias` is passed, which the engines reject for anything but a
user-defined network. `host` is how a container service and the machine
reach each other on localhost.
