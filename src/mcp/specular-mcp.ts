import { connect } from 'node:net';

/**
 * Stdio entry point that agents start as the `specular` MCP server (increment 86a, DD-054). It forwards newline-delimited
 * JSON-RPC between the agent and the Specular run that issued its token; it has no tools of its own.
 * Run with Electron's binary and ELECTRON_RUN_AS_NODE=1.
 */
const pipe = process.env.SPECULAR_MCP_PIPE, token = process.env.SPECULAR_RUN_TOKEN;
if (!pipe || !token || !/^[a-f0-9]{64}$/.test(token)) {
  process.stderr.write('specular-mcp: start it from a Specular discovery run.\n');
  process.exit(2);
}
const socket = connect(pipe!, () => {
  socket.write(JSON.stringify({ token }) + '\n');
  process.stdin.pipe(socket);
});
socket.pipe(process.stdout);
const exit = (code: number) => () => process.exit(code);
socket.on('error', () => { process.stderr.write('specular-mcp: the Specular run is not available.\n'); process.exit(1); });
socket.on('close', exit(0));
process.stdin.on('end', () => socket.end());
