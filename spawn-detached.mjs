// spawn-detached.mjs — one-shot launcher: starts the target command fully
// detached (new session, own process group), so it survives the Bash tool
// call that spawned it (direct `&`+setsid children get reaped at call end;
// processes spawned detached from INSIDE a running process survive — the
// keepalive→dev chain proved this empirically).
//
// usage:
//   bun spawn-detached.mjs <cmd> [args…]            # cwd = project root
//   bun spawn-detached.mjs --cwd <dir> <cmd> …      # explicit working dir
//
// The --cwd form is REQUIRED for mini-services (e.g. the event-stream
// service on :3003 must run inside its own project directory — launching
// it from the root accidentally starts a SECOND Next dev server).
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const ROOT = '/home/z/my-project'
const argv = process.argv.slice(2)
let cwd = ROOT
if (argv[0] === '--cwd') {
  cwd = argv[1]
  argv.splice(0, 2)
}
const [cmd, ...args] = argv
if (!cmd || !fs.existsSync(cwd)) {
  console.error(`usage: bun spawn-detached.mjs [--cwd <dir>] <cmd> [args…] (dir must exist: ${cwd})`)
  process.exit(1)
}
const logPath = cwd === ROOT ? `${ROOT}/dev.log` : `${cwd}/service.log`
const out = fs.openSync(logPath, 'a')
const child = spawn(cmd, args, {
  cwd,
  detached: true,
  stdio: ['ignore', out, out],
})
child.unref()
console.log(`detached spawn: ${cmd} ${args.join(' ')} (pid ${child.pid}) in ${cwd} → ${logPath}`)
