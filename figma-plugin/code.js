figma.showUI(__html__, { width: 260, height: 90, visible: true });

function plainNode(node) {
  if (!node) return null;
  const box = 'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null;
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: 'visible' in node ? node.visible : true,
    locked: 'locked' in node ? node.locked : false,
    x: 'x' in node ? node.x : undefined,
    y: 'y' in node ? node.y : undefined,
    width: 'width' in node ? node.width : box && box.width,
    height: 'height' in node ? node.height : box && box.height,
  };
}

function serialize(value, depth = 0) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 4) return '[MaxDepth]';
  if (Array.isArray(value)) return value.map((item) => serialize(item, depth + 1));
  if (typeof value === 'object') {
    if ('type' in value && 'id' in value && 'name' in value) return plainNode(value);
    const out = {};
    for (const key of Object.keys(value)) {
      if (typeof value[key] !== 'function') out[key] = serialize(value[key], depth + 1);
    }
    return out;
  }
  return String(value);
}

async function loadDefaultFonts() {
  const fonts = [
    { family: 'Inter', style: 'Regular' },
    { family: 'Inter', style: 'Medium' },
    { family: 'Inter', style: 'Semi Bold' },
    { family: 'Inter', style: 'Bold' },
  ];
  for (const font of fonts) {
    try { await figma.loadFontAsync(font); } catch (_) {}
  }
}

async function runScript(code) {
  await loadDefaultFonts();
  const fn = new Function('figma', `return (async () => { ${code}\n })();`);
  return serialize(await fn(figma));
}

async function execute(command, params) {
  switch (command) {
    case 'get_selection':
      return figma.currentPage.selection.map(plainNode);
    case 'select_node': {
      const node = await figma.getNodeByIdAsync(params.nodeId);
      if (!node) throw new Error(`Node not found: ${params.nodeId}`);
      figma.currentPage.selection = [node];
      if ('scrollAndZoomIntoView' in figma) figma.viewport.scrollAndZoomIntoView([node]);
      return plainNode(node);
    }
    case 'zoom_to_node': {
      const node = await figma.getNodeByIdAsync(params.nodeId);
      if (!node) throw new Error(`Node not found: ${params.nodeId}`);
      figma.viewport.scrollAndZoomIntoView([node]);
      return plainNode(node);
    }
    case 'get_node':
    case 'get_node_full': {
      const node = await figma.getNodeByIdAsync(params.nodeId);
      if (!node) throw new Error(`Node not found: ${params.nodeId}`);
      return plainNode(node);
    }
    case 'get_children': {
      const parent = params.nodeId ? await figma.getNodeByIdAsync(params.nodeId) : figma.currentPage;
      if (!parent || !('children' in parent)) throw new Error(`Node has no children: ${params.nodeId || 'current page'}`);
      return parent.children.map(plainNode);
    }
    case 'run_script':
      return runScript(params.code || '');
    case 'undo':
      figma.triggerUndo();
      return { ok: true };
    default:
      throw new Error(`Unsupported local bridge command: ${command}. Use labor_run_script for writes.`);
  }
}

figma.ui.onmessage = async (pluginMessage) => {
  if (!pluginMessage || pluginMessage.type !== 'labor-command') return;
  const { id, command, params = {} } = pluginMessage.message;
  try {
    const result = await execute(command, params);
    figma.ui.postMessage({ type: 'labor-response', message: { id, result } });
  } catch (error) {
    figma.ui.postMessage({ type: 'labor-response', message: { id, error: error && error.message ? error.message : String(error) } });
  }
};
