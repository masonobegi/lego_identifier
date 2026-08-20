import type { Transport } from '@haulmates/core';

/**
 * WebSocket transport.
 *
 * Everything the game sends is small and ordered, and a TCP-based transport
 * removes an entire class of bug from the netcode: no reordering, no loss, no
 * MTU. Latency is handled by rollback rather than by a custom UDP stack.
 */
export function createWebSocketTransport(url: string): Transport {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const queue: Uint8Array[] = [];

  const transport: Transport = {
    onOpen: null,
    onMessage: null,
    onClose: null,
    send(bytes) {
      if (socket.readyState === WebSocket.OPEN) socket.send(bytes);
      else if (socket.readyState === WebSocket.CONNECTING) queue.push(bytes.slice());
    },
    close() {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    },
  };

  socket.addEventListener('open', () => {
    // The handshake goes first: `onOpen` writes the hello straight through the
    // now-open socket, and only then does anything buffered during connection
    // get flushed behind it.
    transport.onOpen?.();
    for (const bytes of queue) socket.send(bytes);
    queue.length = 0;
  });
  socket.addEventListener('message', (event) => {
    const data = event.data;
    if (data instanceof ArrayBuffer) transport.onMessage?.(new Uint8Array(data));
  });
  socket.addEventListener('close', (event) => {
    transport.onClose?.(event.reason || 'Connection closed');
  });
  socket.addEventListener('error', () => {
    transport.onClose?.('Could not reach the server');
  });

  return transport;
}

/** Normalise whatever the player typed into a usable websocket URL. */
export function normaliseServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return url;
  if (!/^wss?:\/\//i.test(url)) {
    url = (url.startsWith('localhost') || url.startsWith('127.') || url.startsWith('192.168.') ? 'ws://' : 'wss://') + url;
  }
  return url.replace(/\/+$/, '');
}
