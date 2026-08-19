// The command next to the server it starts: `mcp` serves the recorded
// runs over stdio. It hangs off whatever commander program it is given -
// @testfile.dev/cli registers it next to the other history commands.
export { registerMcp } from "./mcp.js";
