// The `testfile` step: run the tests a Testfile describes, from a Jenkins
// pipeline, the way the GitHub Action does it - map the step's options to
// runner flags, record the JUnit report, archive the recorded run.
//
//   @Library('testfile') _
//   node {
//     checkout scm
//     testfile()                                  // the whole suite
//     testfile path: 'services', filterTags: 'fast', failFast: true
//   }
//
// Options (all optional):
//   path          Testfile or directory containing one (default ".")
//   filter        generic filter (-f): name/path, tag, or key:value matrix
//   filterName    only tests whose path contains this (-n)
//   filterTags    tags to run (-t), a string or a list
//   filterMatrix  key:value matrix filter (-m)
//   failFast      abort the whole run at the first failure
//   maxParallel   global cap on concurrently running tests
//   variants      what distinguishes this run from other legs of a matrix,
//                 a map or "key=value" list; `testfile-viewer merge` needs it
//   labels        extra labels recorded with the run, a map or "key=value"
//                 list; explicit labels win over the automatic ones
//   autoLabels    label the run with the Jenkins context: job, build,
//                 branch, commit, node (default true)
//   reporter      machine-readable report: "junit" (default), "json", or ""
//   output        report target file (default "testfile-junit.xml")
//   junit         record the report with the junit step (default: true
//                 when the reporter is junit)
//   archiveRuns   archive the recorded run .testfile/runs/** (default true)
//   doctor        run `testfile doctor` first: check the machine against
//                 what the Testfile needs and fail early (default false)
//   runnerCommand the runner to invoke
//                 (default "npx --yes @testfile.dev/runner")

def call(Map config = [:]) {
  String runner = config.runnerCommand ? config.runnerCommand.toString() : 'npx --yes @testfile.dev/runner'
  String path = config.path ? config.path.toString() : ''
  String reporter = config.containsKey('reporter') ? (config.reporter ?: '').toString() : 'junit'
  String output = config.output ? config.output.toString() : (reporter == 'junit' ? 'testfile-junit.xml' : '')
  boolean recordJUnit = config.containsKey('junit') ? asBool(config.junit) : (reporter == 'junit' && output)
  boolean archiveRuns = config.containsKey('archiveRuns') ? asBool(config.archiveRuns) : true
  boolean autoLabels = config.containsKey('autoLabels') ? asBool(config.autoLabels) : true

  List<String> args = ['start']
  if (path) { args.add(shellQuote(path)) }
  addOption(args, '-f', config.filter)
  addOption(args, '-n', config.filterName)
  addOption(args, '-t', joinList(config.filterTags))
  addOption(args, '-m', config.filterMatrix)
  if (asBool(config.failFast)) { args.add('--fail-fast') }
  addOption(args, '--max-parallel', config.maxParallel)
  for (String variant : pairsOf(config.variants)) {
    args.add('--variant')
    args.add(shellQuote(variant))
  }
  Map<String, String> labels = [:]
  if (autoLabels) { labels.putAll(jenkinsLabels()) }
  for (String pair : pairsOf(config.labels)) {
    int at = pair.indexOf('=')
    if (at > 0) { labels.put(pair.substring(0, at).trim(), pair.substring(at + 1).trim()) }
  }
  for (Map.Entry<String, String> label : labels.entrySet()) {
    args.add('--label')
    args.add(shellQuote(label.key + '=' + label.value))
  }
  if (reporter) {
    args.add('--reporter')
    args.add(shellQuote(reporter))
    if (output) {
      args.add('--output')
      args.add(shellQuote(output))
    }
  }

  if (asBool(config.doctor)) {
    sh label: 'testfile doctor', script: runner + ' doctor' + (path ? ' ' + shellQuote(path) : '')
  }
  try {
    sh label: 'testfile start', script: runner + ' ' + args.join(' ')
  } finally {
    if (recordJUnit && output) {
      junit testResults: output, allowEmptyResults: true
    }
    if (archiveRuns) {
      archiveArtifacts artifacts: '.testfile/runs/**', allowEmptyArchive: true
    }
  }
}

// The labels the Jenkins context can supply, mirroring the vocabulary of the
// GitHub Action (action/labels.mjs): branch, job, sha, ci-run - plus the
// node, which has no GitHub equivalent but decides what a Jenkins run saw.
private Map<String, String> jenkinsLabels() {
  Map<String, String> labels = [:]
  String branch = env.BRANCH_NAME ?: env.GIT_BRANCH
  if (branch) { labels.put('branch', branch.replaceFirst('^origin/', '')) }
  if (env.JOB_NAME) { labels.put('job', env.JOB_NAME) }
  if (env.GIT_COMMIT) { labels.put('sha', env.GIT_COMMIT.take(7)) }
  if (env.BUILD_NUMBER) { labels.put('ci-run', env.BUILD_NUMBER) }
  if (env.NODE_NAME) { labels.put('node', env.NODE_NAME) }
  return labels
}

private void addOption(List<String> args, String flag, Object value) {
  if (value != null && value.toString() != '') {
    args.add(flag)
    args.add(shellQuote(value.toString()))
  }
}

// A tag list may be given as a list or as the comma-separated string the
// CLI takes; either way one -t value comes out.
private String joinList(Object value) {
  if (value == null) { return '' }
  if (value instanceof List) { return value.join(',') }
  return value.toString()
}

// variants/labels may be a map or a list of (or one) "key=value" strings.
private List<String> pairsOf(Object value) {
  List<String> pairs = []
  if (value == null) { return pairs }
  if (value instanceof Map) {
    for (Map.Entry entry : ((Map) value).entrySet()) {
      pairs.add(entry.key.toString() + '=' + entry.value.toString())
    }
  } else if (value instanceof List) {
    for (Object entry : (List) value) { pairs.add(entry.toString()) }
  } else {
    for (String entry : value.toString().split(/[,\n]/)) {
      if (entry.trim()) { pairs.add(entry.trim()) }
    }
  }
  return pairs
}

private boolean asBool(Object value) {
  return value == true || value.toString() == 'true'
}

// Values reach the shell single-quoted, so a branch name with a space (or
// worse) stays one argument and never becomes shell syntax.
private String shellQuote(String value) {
  return "'" + value.replace("'", "'\\''") + "'"
}
