const WebSocket = require('ws');

class WsTransport {

  constructor(url) {
    this.url = url;
    /** @type {WebSocket|null} */
    this.ws = null;
    this.connected = false;
    this.messageQueue = [];
    this.onCommands = null; // callback(commands[])
    this.reconnectMs = 3000;
    this._destroyed = false;
  }

  connect() {
    return new Promise((resolve) => {
      this._connect(resolve);
    });
  }

  _connect(onFirstConnect) {
    if (this._destroyed) return;

    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this.connected = true;
      console.log(`🔗 Connected to backend: ${this.url}`);

      // Flush queued messages
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift();
        this.ws.send(msg);
      }

      if (onFirstConnect) {
        onFirstConnect();
        onFirstConnect = null;
      }
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'commands' || msg.type === 'commands_batch') {
          const cmds = msg.commands || [];
          if (this.onCommands && cmds.length > 0) {
            this.onCommands(cmds);
          }
        }
      } catch { /* ignore */ }
    });

    this.ws.on('close', () => {
      this.connected = false;
      if (!this._destroyed) {
        console.log(`🔗 Disconnected. Reconnecting in ${this.reconnectMs}ms...`);
        setTimeout(() => this._connect(), this.reconnectMs);
      }
    });

    this.ws.on('error', () => {
      // close event will handle reconnect
    });
  }

  send(obj) {
    const msg = JSON.stringify(obj);
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.messageQueue.push(msg);
    }
  }

  registerDevice(deviceId, meta) {
    this.send({ type: 'register', deviceId, meta });
  }

  sendTelemetryBatch(items) {
    // items: [{ deviceId, data }]
    this.send({ type: 'telemetry_batch', items });
  }

  pollCommandsBatch(deviceIds) {
    this.send({ type: 'poll_commands_batch', deviceIds });
  }

  sendCommandResult(commandId, status, result) {
    this.send({ type: 'command_result', commandId, status, result });
  }

  destroy() {
    this._destroyed = true;
    if (this.ws) this.ws.close();
  }
}

module.exports = WsTransport;
