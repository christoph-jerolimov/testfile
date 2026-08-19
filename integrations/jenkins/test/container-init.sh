#!/bin/bash
# Boots a disposable Jenkins for the library's test suite. Runs inside the
# official jenkins/jenkins image, as the jenkins user, after the container's
# command fetched this folder from src-server into /var/jenkins_home/testfile-src.
set -euo pipefail
SRC=/var/jenkins_home/testfile-src

# The plugins the library and the seeded jobs need. jenkins-plugin-cli reads
# the core version from the bundled war and resolves versions against it, so
# every matrix leg gets plugins its Jenkins can actually load.
jenkins-plugin-cli -d "$JENKINS_HOME/plugins" --plugins \
  configuration-as-code job-dsl workflow-aggregator pipeline-groovy-lib git junit

# Node.js for the pipeline jobs - the jenkins image has none, and the
# testfile step runs the runner through npx. JCasC puts this on the PATH of
# every build (globalNodeProperties).
case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *)
    echo "container-init: unsupported architecture $(uname -m)" >&2
    exit 1
    ;;
esac
NODE_VERSION=22.13.0
mkdir -p "$JENKINS_HOME/tools/node"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.gz" \
  | tar xzm -C "$JENKINS_HOME/tools/node" --strip-components=1
export PATH="$JENKINS_HOME/tools/node/bin:$PATH"
# Warm the npx cache so the first build does not start with a download; a
# transient registry error is the build's problem to retry, not a boot failure.
npx --yes @testfile.dev/runner --version || true

# Jenkins loads shared libraries from SCM only, so the library under test
# becomes a one-commit git repo right where it was unpacked.
git -C "$SRC" init -q -b main
git -C "$SRC" -c user.email=testfile@localhost -c user.name=Testfile add -A
git -C "$SRC" -c user.email=testfile@localhost -c user.name=Testfile commit -q -m 'library under test'

# Hand over to Jenkins, configured entirely by JCasC: security, the library,
# the seeded jobs. Loopback only - this controller is wide open by design.
export CASC_JENKINS_CONFIG="$SRC/test/jenkins-casc.yaml"
export JAVA_OPTS="${JAVA_OPTS:-} -Djenkins.install.runSetupWizard=false"
export JENKINS_OPTS="${JENKINS_OPTS:-} --httpPort=${JENKINS_PORT} --httpListenAddress=127.0.0.1"
exec /usr/local/bin/jenkins.sh
