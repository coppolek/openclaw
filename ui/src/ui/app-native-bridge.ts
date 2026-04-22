type WebView2Bridge = {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

export type NativeBridgeMessage =
  | { type: "recording-start"; payload?: Record<string, unknown> }
  | { type: "recording-stop"; payload?: Record<string, unknown> }
  | { type: "voice-start"; payload?: Record<string, unknown> }
  | { type: "voice-stop"; payload?: Record<string, unknown> }
  | { type: "draft-text"; payload: { text: string } }
  | { type: "ready"; payload?: Record<string, unknown> };

export type NativeBridgeHost = {
  nativeRecording: boolean;
  chatMessage: string;
};

function getWebview(): WebView2Bridge | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webview = (window as any).chrome?.webview;
  return webview as WebView2Bridge | undefined;
}

export function isWebView2(): boolean {
  return getWebview() !== undefined;
}

export function sendToNative(msg: NativeBridgeMessage): void {
  getWebview()?.postMessage(msg);
}

function handleNativeMessage(host: NativeBridgeHost, msg: NativeBridgeMessage): void {
  switch (msg.type) {
    case "recording-start":
      host.nativeRecording = true;
      break;
    case "recording-stop":
      host.nativeRecording = false;
      break;
    case "draft-text":
      host.chatMessage = msg.payload.text;
      break;
    // voice-start / voice-stop: no SPA UI state yet — acknowledged by the ready
    // handshake but no visual change until a voice UI exists in this repo.
  }
}

/**
 * Subscribes to WebView2 native messages and sends the ready handshake.
 * addEventListener is called BEFORE the ready handshake so no messages
 * are missed between the handshake and the first listen.
 * Returns a cleanup function that removes the listener.
 * No-op (returns empty cleanup) when not running inside WebView2.
 */
export function initNativeBridge(host: NativeBridgeHost): () => void {
  const bridge = getWebview();
  if (!bridge) return () => {};

  const handler = (event: MessageEvent) => {
    const msg = event.data as NativeBridgeMessage;
    if (msg && typeof msg.type === "string") {
      handleNativeMessage(host, msg);
    }
  };

  // Register listener FIRST, then send ready — order matters.
  bridge.addEventListener("message", handler);
  sendToNative({ type: "ready" });

  return () => {
    bridge.removeEventListener("message", handler);
  };
}
