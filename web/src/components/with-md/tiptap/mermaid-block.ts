import { Node } from '@tiptap/core';
import { renderMermaidSVG } from 'beautiful-mermaid';
import {
  MAX_MERMAID_SCALE,
  MIN_MERMAID_SCALE,
  applySvgScale,
  clampMermaidScale,
  getFitScale,
  getSvgNaturalSize,
  scrollNearestPageContainer,
  shouldPassVerticalWheel,
  type DiagramSize,
} from '../mermaid-viewer-utils';

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  markdownTokenName: 'code',

  addAttributes() {
    return {
      code: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-mermaid-block]' }];
  },

  renderHTML({ node }) {
    return ['div', { 'data-mermaid-block': '', 'data-mermaid-source': node.attrs.code }];
  },

  parseMarkdown(token, helpers) {
    // Only claim ```mermaid fenced blocks; let CodeBlock handle everything else.
    if (token.type !== 'code') return [];
    if ((token.lang || '').trim().toLowerCase() !== 'mermaid') return [];
    return helpers.createNode('mermaidBlock', { code: token.text || '' }, []);
  },

  renderMarkdown(node) {
    const code = (node.attrs?.code as string) || '';
    return ['```mermaid', code, '```'].join('\n');
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'withmd-mermaid-block';
      dom.contentEditable = 'false';

      const viewport = document.createElement('div');
      viewport.className = 'withmd-mermaid-viewport';

      const zoomLayer = document.createElement('div');
      zoomLayer.className = 'withmd-mermaid-zoom';

      const svgHost = document.createElement('div');
      svgHost.className = 'withmd-mermaid-svg';

      zoomLayer.appendChild(svgHost);
      viewport.appendChild(zoomLayer);

      const errorHost = document.createElement('pre');
      errorHost.className = 'withmd-mermaid-error';
      errorHost.style.display = 'none';

      const zoomLabel = document.createElement('span');
      zoomLabel.className = 'withmd-mermaid-zoom-label';
      zoomLabel.style.display = 'none';

      const controls = document.createElement('div');
      controls.className = 'withmd-mermaid-controls';
      controls.setAttribute('aria-label', 'Mermaid diagram zoom controls');

      const zoomOutButton = document.createElement('button');
      zoomOutButton.type = 'button';
      zoomOutButton.className = 'withmd-mermaid-zoom-btn';
      zoomOutButton.setAttribute('aria-label', 'Zoom out diagram');
      zoomOutButton.title = 'Zoom out';
      zoomOutButton.textContent = '-';

      const zoomInButton = document.createElement('button');
      zoomInButton.type = 'button';
      zoomInButton.className = 'withmd-mermaid-zoom-btn';
      zoomInButton.setAttribute('aria-label', 'Zoom in diagram');
      zoomInButton.title = 'Zoom in';
      zoomInButton.textContent = '+';

      controls.appendChild(zoomOutButton);
      controls.appendChild(zoomInButton);

      let editing = false;
      let currentCode = (node.attrs.code as string) || '';
      let textarea: HTMLTextAreaElement | null = null;
      let scale = 1;
      let diagramSize: DiagramSize | null = null;
      let userZoomed = false;
      let zoomLabelTimer: ReturnType<typeof setTimeout> | null = null;
      let fitFrame: number | null = null;
      const updateZoomButtons = () => {
        zoomOutButton.disabled = scale <= MIN_MERMAID_SCALE + 0.01;
        zoomInButton.disabled = scale >= MAX_MERMAID_SCALE - 0.01;
      };

      const fitDiagram = () => {
        if (!diagramSize) return;
        scale = getFitScale(viewport, diagramSize);
        applySvgScale(svgHost, diagramSize, scale);
        updateZoomButtons();
      };

      const updateZoom = (newScale: number, showLabel = true) => {
        userZoomed = true;
        scale = clampMermaidScale(newScale);
        applySvgScale(svgHost, diagramSize, scale);
        if (showLabel) {
          zoomLabel.textContent = `${Math.round(scale * 100)}%`;
          zoomLabel.style.display = '';
          if (zoomLabelTimer) clearTimeout(zoomLabelTimer);
          zoomLabelTimer = setTimeout(() => { zoomLabel.style.display = 'none'; }, 1200);
        }
        updateZoomButtons();
      };

      viewport.addEventListener('wheel', (e) => {
        if (shouldPassVerticalWheel(e)) {
          e.preventDefault();
          e.stopPropagation();
          scrollNearestPageContainer(viewport, e.deltaY);
          return;
        }

        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        updateZoom(scale * factor);
      }, { passive: false });

      zoomOutButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        updateZoom(scale / 1.2);
      });

      zoomInButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        updateZoom(scale * 1.2);
      });

      controls.addEventListener('mousedown', (e) => e.stopPropagation());
      controls.addEventListener('pointerdown', (e) => e.stopPropagation());
      controls.addEventListener('dblclick', (e) => e.stopPropagation());

      const renderSvg = (code: string) => {
        currentCode = code;
        try {
          const svg = renderMermaidSVG(code, {
            bg: 'var(--background, #ffffff)',
            fg: 'var(--foreground, #27272a)',
            transparent: true,
            font: 'Geist, ui-sans-serif, system-ui, sans-serif',
          });
          svgHost.innerHTML = svg;
          viewport.style.display = '';
          controls.style.display = '';
          errorHost.style.display = 'none';
          userZoomed = false;
          const svgEl = svgHost.querySelector('svg') as SVGSVGElement | null;
          diagramSize = svgEl ? getSvgNaturalSize(svgEl) : null;
          fitDiagram();
          if (fitFrame !== null) cancelAnimationFrame(fitFrame);
          fitFrame = requestAnimationFrame(() => {
            if (!userZoomed) fitDiagram();
          });
        } catch (err) {
          viewport.style.display = 'none';
          controls.style.display = 'none';
          errorHost.style.display = '';
          const msg = err instanceof Error ? err.message : String(err);
          errorHost.textContent = `Mermaid render error:\n${msg}\n\n${code}`;
        }
      };

      const commitEdit = () => {
        if (!editing || !textarea) return;
        const newCode = textarea.value;
        editing = false;
        textarea = null;
        dom.classList.remove('is-editing');
        dom.appendChild(controls);
        dom.appendChild(viewport);
        dom.appendChild(errorHost);
        dom.appendChild(zoomLabel);

        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos != null && newCode !== currentCode) {
          const state = (editor as { state?: { doc?: { nodeAt: (p: number) => unknown }; tr?: unknown } }).state;
          if (state?.doc && state.tr) {
            const nodeAtPos = state.doc.nodeAt(pos) as { attrs?: Record<string, unknown> } | null;
            if (nodeAtPos) {
              const tr = (state.tr as {
                setNodeMarkup: (pos: number, type: undefined, attrs: Record<string, unknown>) => unknown;
              }).setNodeMarkup(pos, undefined, {
                ...(nodeAtPos.attrs ?? {}),
                code: newCode,
              });
              editor.view.dispatch(tr as never);
            }
          }
        }

        renderSvg(newCode);
      };

      const cancelEdit = () => {
        if (!editing) return;
        editing = false;
        textarea = null;
        dom.classList.remove('is-editing');
        dom.innerHTML = '';
        dom.appendChild(controls);
        dom.appendChild(viewport);
        dom.appendChild(errorHost);
        dom.appendChild(zoomLabel);
        renderSvg(currentCode);
      };

      const enterEdit = () => {
        if (editing) return;
        if (!editor.isEditable) return;
        editing = true;
        dom.innerHTML = '';
        dom.classList.add('is-editing');

        textarea = document.createElement('textarea');
        textarea.className = 'withmd-mermaid-editor';
        textarea.value = currentCode;
        textarea.spellcheck = false;

        textarea.addEventListener('blur', commitEdit);
        textarea.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
            editor.commands.focus();
          }
        });

        dom.appendChild(textarea);
        textarea.focus();
        textarea.style.height = textarea.scrollHeight + 'px';
      };

      dom.addEventListener('dblclick', (e) => {
        if (editing) return;
        e.preventDefault();
        enterEdit();
      });

      dom.appendChild(controls);
      dom.appendChild(viewport);
      dom.appendChild(errorHost);
      dom.appendChild(zoomLabel);
      updateZoomButtons();
      renderSvg(currentCode);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'mermaidBlock') return false;
          const nextCode = (updatedNode.attrs.code as string) || '';
          if (!editing && nextCode !== currentCode) {
            renderSvg(nextCode);
          } else if (editing) {
            currentCode = nextCode;
          }
          return true;
        },
        stopEvent(event: Event) {
          if (controls.contains(event.target as HTMLElement)) return true;
          if (editing && dom.contains(event.target as HTMLElement)) return true;
          return false;
        },
        destroy() {
          if (zoomLabelTimer) clearTimeout(zoomLabelTimer);
          if (fitFrame !== null) cancelAnimationFrame(fitFrame);
          if (editing) commitEdit();
        },
      };
    };
  },
});
