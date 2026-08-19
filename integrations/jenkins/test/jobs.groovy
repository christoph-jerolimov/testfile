// The pipeline jobs the suite triggers (seeded by JCasC through Job DSL).
// Each copies one fixture suite from test/fixtures into its workspace and
// calls the library's `testfile` step; test/verify.mjs asserts the verdicts.

static String pipelineScript(String fixture, String stepCall) {
  return """\
    @Library('testfile') _
    node {
      deleteDir()
      sh 'cp -r /var/jenkins_home/testfile-src/test/fixtures/${fixture}/. .'
      ${stepCall}
    }
  """.stripIndent()
}

// The happy path: the suite passes, JUnit results are recorded, the
// recorded run is archived.
pipelineJob('testfile-smoke') {
  definition {
    cps {
      sandbox(true)
      script(pipelineScript('passing', 'testfile()'))
    }
  }
}

// filterTags keeps the broken slow test out, so the build succeeds with
// exactly the one fast test in its report.
pipelineJob('testfile-filtered') {
  definition {
    cps {
      sandbox(true)
      script(pipelineScript('mixed', "testfile filterTags: 'fast'"))
    }
  }
}

// A failing suite must fail the build - and still record the report, so
// the failure is readable as test results rather than only as a red build.
pipelineJob('testfile-failing') {
  definition {
    cps {
      sandbox(true)
      script(pipelineScript('failing', 'testfile()'))
    }
  }
}
