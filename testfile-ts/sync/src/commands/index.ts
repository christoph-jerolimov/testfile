// The sharing commands, next to the code that does the sharing: pack and
// import archives, and move runs through S3, GitHub Actions or GitLab CI.
// Each register function hangs its command group off whatever commander
// program it is given - @testfile.dev/cli registers them next to the other
// history commands.
export { registerArchive } from "./archive.js";
export { registerGithub } from "./github.js";
export { registerGitlab } from "./gitlab.js";
export { registerS3 } from "./s3.js";
