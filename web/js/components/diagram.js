export function renderDiagram(diagram) {
  if (!diagram || !diagram.type) return '';
  try {
    switch (diagram.type) {
      case 'stack': return renderStack(diagram.data);
      case 'flow': return renderFlow(diagram.data);
      case 'comparison': return renderComparison(diagram.data);
      case 'timeline': return renderTimeline(diagram.data);
      default: return '';
    }
  } catch {
    return renderDiagramFallback(diagram);
  }
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function renderDiagramFallback(diagram) {
  const label = escapeHTML(diagram?.title || diagram?.label || 'Generated diagram');
  return `
    <div class="diagram diagram-fallback">
      <div class="diagram-fallback-label">Diagram unavailable</div>
      <div class="diagram-fallback-text">${label}</div>
    </div>`;
}

function renderStack(data) {
  const layers = list(data?.layers);
  if (!layers.length) return renderDiagramFallback({ title: 'Stack diagram' });
  return `
    <div class="diagram diagram-stack">
      ${layers.map((layer, i) => `
        <div class="stack-layer" style="--layer-color: ${escapeHTML(layer.color || 'var(--primary)')}; --layer-index: ${i}">
          <div class="stack-layer-label">${escapeHTML(layer.label)}</div>
          <div class="stack-layer-items">
            ${list(layer.items).map(item => `<span class="stack-item">${escapeHTML(item)}</span>`).join('')}
          </div>
        </div>
      `).reverse().join('')}
    </div>`;
}

function renderFlow(data) {
  const nodes = list(data?.nodes);
  if (!nodes.length) return renderDiagramFallback({ title: 'Flow diagram' });
  const nodeTypes = {
    start: { bg: 'var(--color-emerald)', shape: 'rounded' },
    process: { bg: 'var(--color-indigo)', shape: 'rect' },
    decision: { bg: 'var(--color-amber)', shape: 'diamond' },
    end: { bg: 'var(--color-success)', shape: 'rounded' }
  };

  return `
    <div class="diagram diagram-flow">
      <div class="flow-nodes">
        ${nodes.map((node, i) => {
          const type = nodeTypes[node.type] || nodeTypes.process;
          return `
            <div class="flow-node flow-node--${escapeHTML(node.type || 'process')}" style="--node-color: ${type.bg}">
              <div class="flow-node-label">${escapeHTML(node.label)}</div>
            </div>
            ${i < nodes.length - 1 ? '<div class="flow-arrow"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>' : ''}`;
        }).join('')}
      </div>
    </div>`;
}

function renderComparison(data) {
  const columns = list(data?.columns);
  if (!columns.length) return renderDiagramFallback({ title: 'Comparison diagram' });
  return `
    <div class="diagram diagram-comparison">
      <div class="comparison-columns" style="--col-count: ${columns.length}">
        ${columns.map(col => `
          <div class="comparison-column" style="--col-color: ${escapeHTML(col.color || 'var(--color-indigo)')}">
            <div class="comparison-column-header">${escapeHTML(col.title)}</div>
            <ul class="comparison-column-items">
              ${list(col.items).map(item => `<li>${escapeHTML(item)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderTimeline(data) {
  const events = list(data?.events);
  if (!events.length) return renderDiagramFallback({ title: 'Timeline diagram' });
  return `
    <div class="diagram diagram-timeline">
      <div class="timeline-track">
        ${events.map((event, i) => `
          <div class="timeline-event ${i === events.length - 1 ? 'current' : ''}">
            <div class="timeline-dot"></div>
            <div class="timeline-content">
              <span class="timeline-year">${escapeHTML(event.year)}</span>
              <span class="timeline-label">${escapeHTML(event.label)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}
