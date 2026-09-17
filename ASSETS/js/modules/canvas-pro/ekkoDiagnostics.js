// ASSETS/js/modules/canvas-pro/ekkoDiagnostics.js
// Versión: Fase A - Diagnóstico robusto
(function(global){
  if(global.EKKO_DIAG) return; // no sobrescribir si ya existe

  const safeStringify = (obj) => {
    const seen = new WeakSet();
    try {
      return JSON.stringify(obj, function(key, val){
        if (typeof val === 'function') return `[Function:${val.name||'anon'}]`;
        if (val && typeof val === 'object') {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        // Paper.js Items can be large; reduce to primitives
        if (val && val.constructor && val.constructor.name === 'Point') {
          return {x: val.x, y: val.y};
        }
        return val;
      }, 2);
    } catch (e) {
      return String(obj);
    }
  };

  const now = () => (new Date()).toISOString();

  // Snapshot serializer para Paper.js items (ligero)
  function snapshotItem(item){
    if(!item) return null;
    try {
      return {
        id: item.id || null,
        className: item.className || item.constructor && item.constructor.name || null,
        visible: !!item.visible,
        selected: !!item.selected,
        bounds: item.bounds ? {
          x: item.bounds.x, y: item.bounds.y,
          width: item.bounds.width, height: item.bounds.height
        } : null,
        position: item.position ? {x: item.position.x, y: item.position.y} : null,
        rotation: typeof item.rotation !== 'undefined' ? item.rotation : null,
        scale: item.scaling ? {x: item.scaling.x, y: item.scaling.y} : null,
        data: item.data ? (function(d){
          // copy only known keys to avoid huge objects
          const keys = ['isHole','isSmartFusion','fusionId','isMask','isMockup','source','userImported'];
          const out = {};
          keys.forEach(k => { if(typeof d[k] !== 'undefined') out[k] = d[k]; });
          return out;
        })(item.data) : null,
        childrenCount: item.children ? item.children.length : 0
      };
    } catch(e){
      return {error: 'snapshot-failed', message: String(e)};
    }
  }

  // Snapshot de selección / layer / documento
  function snapshotDocument(){
    try {
      const paper = global.paper;
      if(!paper || !paper.project) return {error: 'paper-not-ready'};
      const project = paper.project;
      const activeLayer = project.activeLayer;
      const designLayer = project.getItem({name: 'designLayer'}) || activeLayer;
      const items = (designLayer && designLayer.children) ? designLayer.children.map(snapshotItem) : [];
      return {
        time: now(),
        project: {
          layers: project.layers ? project.layers.map(l => ({name: l.name, visible: !!l.visible})) : [],
          activeLayer: activeLayer ? activeLayer.name : null
        },
        designLayerSnapshot: {
          itemsCount: items.length,
          items
        }
      };
    } catch(e){
      return {error: 'snapshot-exception', message: String(e)};
    }
  }

  // Operaciones registradas
  const state = {
    active: true,
    initialized: false,
    operations: [],
    consoleErrors: [],
    eventRegistry: new Map(),
    synapse: null,
    lastOperationId: 0
  };

  // API pública
  const api = {
    start(){
      state.active = true;
      return {ok:true};
    },
    stop(){
      state.active = false;
      return {ok:true};
    },
    clear(){
      state.operations = [];
      state.consoleErrors = [];
      state.eventRegistry = new Map();
      return {ok:true};
    },
    last(){
      return state.operations[state.operations.length-1] || null;
    },
    getOperations(){
      return state.operations.slice();
    },
    getConsoleErrors(){
      return state.consoleErrors.slice();
    },
    getEventRegistry(){
      return state.eventRegistry;
    },
    registerEvent(selector, metadata = {}){
      if (!selector) return false;
      state.eventRegistry.set(String(selector), metadata || {});
      return true;
    },
    integrateSynapse(synapseAPI){
      state.synapse = synapseAPI || null;
      return {ok: !!state.synapse};
    },
    report(){
      return {
        meta: {generatedAt: now()},
        operations: api.getOperations(),
        consoleErrors: api.getConsoleErrors(),
        eventRegistry: Array.from(state.eventRegistry.entries()),
        synapseIntegrated: !!state.synapse
      };
    },
    assert(condition, message){
      if(!condition) {
        const op = {
          id: `ASSERT-${Date.now()}`,
          type: 'assertion',
          time: now(),
          message: message || 'assertion failed'
        };
        state.operations.push(op);
        return false;
      }
      return true;
    },
    // registro de eventos y operaciones instrumentadas
    logEvent(type, details){
      if(!state.active) return;
      const opId = ++state.lastOperationId;
      const op = {
        id: `OP-${String(opId).padStart(5,'0')}`,
        type: type || 'event',
        time: now(),
        details: details || {},
        stateBefore: snapshotDocument()
      };
      state.operations.push(op);
      return op.id;
    },
    finishEvent(opId, result){
      if(!state.active) return;
      const op = state.operations.find(o => o.id === opId);
      if(!op) return;
      op.timeEnd = now();
      op.durationMs = (new Date(op.timeEnd) - new Date(op.time)) || 0;
      op.result = result || {};
      op.stateAfter = snapshotDocument();
    },
    // helpers internos
    _snapshotDocument: snapshotDocument,
    _safeStringify: safeStringify
  };

  // Interceptor seguro de console.error
  (function installConsoleInterceptor(){
    const orig = global.console && global.console.error ? global.console.error.bind(global.console) : function(){};
    global.console.error = function(...args){
      try {
        const entry = {
          time: now(),
          args: args.map(a => {
            try { return typeof a === 'string' ? a : safeStringify(a); }
            catch(e){ return String(a); }
          })
        };
        state.consoleErrors.push(entry);
      } catch(e){
        // no bloquear la app
      } finally {
        try { orig(...args); } catch(e) {}
      }
    };
  })();

  // Emisión de evento global EKKO_STUDIO_READY (se disparará desde editor.js)
  api.emitReady = function(){
    try {
      const ev = new Event('EKKO_STUDIO_READY');
      global.dispatchEvent(ev);
      if (global.document) document.dispatchEvent(ev);
      state.initialized = true;
    } catch(e){}
  };

  // Instrumentador ligero para funciones críticas (manual)
  api.instrument = function(ownerName, fnName, fn){
    return function(...args){
      if(!state.active) return fn.apply(this, args);
      const opId = api.logEvent(`${ownerName}.${fnName}`, {args: args});
      try {
        const res = fn.apply(this, args);
        api.finishEvent(opId, {ok:true});
        return res;
      } catch(e){
        api.finishEvent(opId, {ok:false, error: String(e)});
        throw e;
      }
    };
  };

  // Exponer en global
  global.EKKO_DIAG = api;

  // Auto-expose for legacy references
  global.ekkoDiagnostics = api;

  // Small helper to attach to editor bootstrap
  // editor.js should call: window.EKKO_DIAG.emitReady();
})(window);
