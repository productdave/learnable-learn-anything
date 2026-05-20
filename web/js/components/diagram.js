export function renderDiagram(diagram) {
  switch (diagram.type) {
    case 'stack': return renderStack(diagram.data);
    case 'flow': return renderFlow(diagram.data);
    case 'comparison': return renderComparison(diagram.data);
    case 'timeline': return renderTimeline(diagram.data);
    default: return '';
  }
}

function renderStack(data) {
  return `
    <div class="diagram diagram-stack">
      ${data.layers.map((layer, i) => `
        <div class="stack-layer" style="--layer-color: ${layer.color}; --layer-index: ${i}">
          <div class="stack-layer-label">${layer.label}</div>
          <div class="stack-layer-items">
            ${layer.items.map(item => `<span class="stack-item">${item}</span>`).join('')}
          </div>
        </div>
      `).reverse().join('')}
    </div>`;
}

function renderFlow(data) {
  const nodeTypes = {
    start: { bg: 'var(--color-emerald)', shape: 'rounded' },
    process: { bg: 'var(--color-indigo)', shape: 'rect' },
    decision: { bg: 'var(--color-amber)', shape: 'diamond' },
    end: { bg: 'var(--color-success)', shape: 'rounded' }
  };

  return `
    <div class="diagram diagram-flow">
      <div class="flow-nodes">
        ${data.nodes.map((node, i) => {
          const type = nodeTypes[node.type] || nodeTypes.process;
          return `
            <div class="flow-node flow-node--${node.type}" style="--node-color: ${type.bg}">
              <div class="flow-node-label">${node.label}</div>
            </div>
            ${i < data.nodes.length - 1 ? '<div class="flow-arrow"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>' : ''}`;
        }).join('')}
      </div>
    </div>`;
}

function renderComparison(data) {
  return `
    <div class="diagram diagram-comparison">
      <div class="comparison-columns" style="--col-count: ${data.columns.length}">
        ${data.columns.map(col => `
          <div class="comparison-column" style="--col-color: ${col.color || 'var(--color-indigo)'}">
            <div class="comparison-column-header">${col.title}</div>
            <ul class="comparison-column-items">
              ${col.items.map(item => `<li>${item}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderTimeline(data) {
  return `
    <div class="diagram diagram-timeline">
      <div class="timeline-track">
        ${data.events.map((event, i) => `
          <div class="timeline-event ${i === data.events.length - 1 ? 'current' : ''}">
            <div class="timeline-dot"></div>
            <div class="timeline-content">
              <span class="timeline-year">${event.year}</span>
              <span class="timeline-label">${event.label}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}
