'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

interface Props {
  wsUrl?: string;
  shareId?: string;
  editSecret?: string;
  onConnectionChange?: (connected: boolean) => void;
}

export default function ClaudeTerminal({
  wsUrl,
  shareId,
  editSecret,
  onConnectionChange,
}: Props) {
  const baseWsUrl = wsUrl || process.env.NEXT_PUBLIC_CLAUDE_WEB_WS_URL || 'ws://localhost:8300';
  const fullWsUrl = (() => {
    if (!shareId || !editSecret) return baseWsUrl;
    const params = new URLSearchParams({
      doc: `share:${shareId}`,
      secret: editSecret,
      watchFile: `/tmp/withmd-${shareId}/document.md`,
      hocuspocusUrl: 'ws://localhost:3001',
    });
    return `${baseWsUrl}?${params.toString()}`;
  })();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f7844',
        black: '#161b22',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d2c0',
        white: '#e6edf3',
        brightBlack: '#484f58',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    // Small delay to ensure container is laid out before fitting
    requestAnimationFrame(() => fitAddon.fit());

    termRef.current = term;
    fitRef.current = fitAddon;

    // Resize observer
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        /* container may not be visible */
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    observer.observe(containerRef.current);

    // Input handler
    const inputDisposable = term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // WebSocket connection
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const ws = new WebSocket(fullWsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        onConnectionChange?.(true);
        fitAddon.fit();
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (e) => term.write(e.data);

      ws.onclose = () => {
        setConnected(false);
        onConnectionChange?.(false);
        if (disposed) return;
        term.write('\r\n\x1b[2m[session ended — reconnecting in 3s...]\x1b[0m\r\n');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    term.focus();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      inputDisposable.dispose();
      observer.disconnect();
      wsRef.current?.close();
      term.dispose();
    };
  }, [fullWsUrl, onConnectionChange]);

  return (
    <div className="withmd-claude-terminal-wrap">
      <div className="withmd-claude-terminal-status">
        <div className={`withmd-claude-terminal-dot ${connected ? 'connected' : ''}`} />
        <span className="withmd-claude-terminal-label">Claude Code</span>
      </div>
      <div ref={containerRef} className="withmd-claude-terminal" />
    </div>
  );
}
