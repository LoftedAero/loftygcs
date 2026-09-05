// The protocol worker: hosts the engine off the UI thread so a burst of
// telemetry can never cost a frame of rendering. The main thread is a dumb
// byte pump (Web Serial is not reachable from workers in every browser);
// everything with protocol knowledge lives here.
import { ProtocolEngine } from '../protocol/engine'
import type { EngineCommand, EngineOutput } from '../protocol/types'

const engine = new ProtocolEngine((out: EngineOutput) => {
  if (out.t === 'tx') {
    // Transfer, not copy: tx buffers are made fresh per frame.
    self.postMessage(out, { transfer: [out.bytes.buffer] })
  } else {
    self.postMessage(out)
  }
})

async function handleRequest(cmd: Extract<EngineCommand, { t: 'req' }>) {
  try {
    let data: unknown
    switch (cmd.op) {
      case 'downloadParams':
        data = await engine.downloadParams()
        break
      case 'setParam':
        data = await engine.setParam(cmd.name, cmd.value, cmd.mavType)
        break
      case 'command':
        data = await engine.runCommand(cmd.command, cmd.params, cmd.timeoutMs)
        break
      case 'downloadMission':
        data = await engine.downloadMission(cmd.missionType)
        break
      case 'uploadMission':
        data = await engine.uploadMission(cmd.items, cmd.missionType)
        break
      case 'clearMission':
        data = await engine.clearMission(cmd.missionType)
        break
      case 'listFiles':
        data = await engine.listFiles(cmd.path)
        break
      case 'downloadFile':
        data = await engine.downloadFile(cmd.path)
        break
    }
    self.postMessage({ t: 'res', id: cmd.id, ok: true, data })
  } catch (err) {
    self.postMessage({
      t: 'res',
      id: cmd.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

self.onmessage = (e: MessageEvent<EngineCommand>) => {
  const cmd = e.data
  switch (cmd.t) {
    case 'rx':
      engine.pushBytes(cmd.bytes)
      break
    case 'start':
      engine.start()
      break
    case 'stop':
      engine.stop()
      break
    case 'send':
      engine.send(cmd.msgName, cmd.fields)
      break
    case 'inspect':
      engine.setInspecting(cmd.on)
      break
    case 'req':
      void handleRequest(cmd)
      break
  }
}
