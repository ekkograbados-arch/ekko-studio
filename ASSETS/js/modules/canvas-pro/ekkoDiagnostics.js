/* =========================================================================
   EKKO STUDIO — STRUCTURED DIAGNOSTICS / FORENSIC OBSERVER
   Candidate contract v1

   This module observes operations. It does not own selection, geometry,
   fusion, panels or CSG. Functional modules must call EKKO_DIAG.begin/end
   or EKKO_DIAG.run at their public boundaries.
========================================================================= */

(function (root, factory) {
    const api = factory(root);
    if (root) root.EKKO_DIAG = api;
    if (typeof module === "object" && module.exports) module.exports = api;
}(typeof window !== "undefined" ? window : null, function (root) {
    "use strict";

    const nativeConsole = {
        log: typeof console !== "undefined" && console.log ? console.log.bind(console) : () => {},
        warn: typeof console !== "undefined" && console.warn ? console.warn.bind(console) : () => {},
        error: typeof console !== "undefined" && console.error ? console.error.bind(console) : () => {}
    };

    const state = {
        version: "EKKO_DIAG_CONTRACT_V1",
        active: false,
        ready: false,
        startedAt: null,
        operationCounter: 0,
        operations: [],
        errors: [],
        eventRegistry: new Map(),
        stack: [],
        maxOperations: 500,
        maxErrors: 200
    };

    function now() {
        return Date.now();
    }

    function operationId() {
        state.operationCounter += 1;
        return `OP-${String(state.operationCounter).padStart(5, "0")}`;
    }

    function safeValue(value, seen = new WeakSet(), depth = 0) {
        if (value === null || value === undefined) return value;
        if (depth > 4) return "[MAX_DEPTH]";
        const type = typeof value;
        if (type === "string" || type === "number" || type === "boolean") return value;
        if (type === "bigint") return `${value}n`;
        if (type === "function") return `[Function ${value.name || "anonymous"}]`;
        if (type !== "object") return String(value);
        if (seen.has(value)) return "[Circular]";
        seen.add(value);

        if (Array.isArray(value)) {
            return value.slice(0, 50).map(item => safeValue(item, seen, depth + 1));
        }

        const result = {};
        Object.keys(value).slice(0, 80).forEach(key => {
            try { result[key] = safeValue(value[key], seen, depth + 1); } catch (e) { result[key] = "[Unreadable]"; }
        });
        return result;
    }

    function pointValue(point) {
        if (!point) return null;
        return { x: Number(point.x) || 0, y: Number(point.y) || 0 };
    }

    function boundsValue(bounds) {
        if (!bounds) return null;
        return {
            x: Number(bounds.x) || 0,
            y: Number(bounds.y) || 0,
            width: Number(bounds.width) || 0,
            height: Number(bounds.height) || 0,
            left: Number(bounds.left) || 0,
            top: Number(bounds.top) || 0,
            right: Number(bounds.right) || 0,
            bottom: Number(bounds.bottom) || 0
        };
    }

    function countSegments(item) {
        if (!item) return 0;
        if (item.segments) return item.segments.length;
        if (!item.children) return 0;
        return Array.from(item.children).reduce((sum, child) => sum + countSegments(child), 0);
    }

    function snapshotItem(item, options = {}) {
        if (!item) return null;
        const data = item.data || {};
        const snapshot = {
            id: item.id ?? null,
            className: item.className || null,
            name: item.name || null,
            parentId: item.parent?.id ?? null,
            parentClassName: item.parent?.className || null,
            index: typeof item.index === "number" ? item.index : null,
            visible: item.visible !== false,
            selected: !!item.selected,
            bounds: boundsValue(item.bounds),
            position: pointValue(item.position),
            rotation: Number(data.rotation ?? item.rotation ?? 0) || 0,
            scaling: pointValue(item.scaling),
            children: item.children ? item.children.length : 0,
            segments: countSegments(item),
            isHole: data.isHole === true,
            isSmartFusion: data.isSmartFusion === true,
            isFusionMask: data.isFusionMask === true,
            clipGroup: data.clipGroup === true,
            fusionId: data.fusionId || null,
            fusionMode: data.fusionMode || null,
            receiverKind: data.receiverKind || null,
            containmentScope: data.containmentScope || null,
            containmentKey: data.containmentKey || null,
            ownerContainmentKey: data.ownerContainmentKey || null,
            hasGeomBase: !!data.geomBase,
            geomBaseBounds: boundsValue(data.geomBase?.bounds),
            layer: item.layer?.name || null
        };

        if (options.deep && item.children) {
            snapshot.childrenState = Array.from(item.children).slice(0, 100)
                .map(child => snapshotItem(child, { deep: true }));
        }
        return snapshot;
    }

    function snapshotState(meta = {}) {
        const selectedItems = root && Array.isArray(root.selectedItems) ? root.selectedItems : [];
        const selectedItem = root ? root.selectedItem : null;
        return {
            timestamp: now(),
            selectedItem: snapshotItem(selectedItem),
            selectedItems: selectedItems.slice(0, 100).map(item => snapshotItem(item)),
            selectionCount: selectedItems.length,
            nodeEditMode: !!root?.nodeEditMode,
            fusionEditActive: !!root?.fusionEditActive,
            fusionRecords: Array.isArray(root?._fusionRecords)
                ? root._fusionRecords.map(record => ({
                    fusionId: record.fusionId || null,
                    groupId: record.group?.id ?? null,
                    mode: record.mode || null,
                    originalIsHole: record.originalIsHole === true,
                    hasMask: !!record.mask,
                    alive: !!record.group?.project
                }))
                : [],
            virtualHoles: Array.isArray(root?._fusionVirtualHoles)
                ? root._fusionVirtualHoles.map(entry => ({
                    fusionId: entry.fusionId || null,
                    ownerContainmentKey: entry.ownerContainmentKey || null,
                    geomId: entry.geom?.id ?? null,
                    alive: !!entry.geom?.project
                }))
                : [],
            meta: safeValue(meta)
        };
    }

    function trim() {
        if (state.operations.length > state.maxOperations) {
            state.operations.splice(0, state.operations.length - state.maxOperations);
        }
        if (state.errors.length > state.maxErrors) {
            state.errors.splice(0, state.errors.length - state.maxErrors);
        }
    }

    function addError(error, context = {}) {
        const entry = {
            timestamp: now(),
            message: error?.message || String(error),
            name: error?.name || "Error",
            stack: error?.stack || null,
            operationId: state.stack[state.stack.length - 1]?.id || null,
            selectedItemId: root?.selectedItem?.id ?? null,
            context: safeValue(context)
        };
        state.errors.push(entry);
        trim();
        return entry;
    }

    function addStep(operation, step) {
        if (!operation || !step) return;
        operation.execution.push({
            order: operation.execution.length + 1,
            timestamp: now(),
            file: step.file || null,
            function: step.function || step.fn || null,
            args: safeValue(step.args || null),
            result: safeValue(step.result || null),
            error: step.error ? safeValue(step.error) : null
        });
    }

    function begin(type, meta = {}) {
        if (!state.active) return null;
        const before = snapshotState(meta.beforeMeta || meta);
        const operation = {
            id: operationId(),
            type: String(type || "UNKNOWN").toUpperCase(),
            startedAt: now(),
            endedAt: null,
            durationMs: null,
            status: "RUNNING",
            args: safeValue(meta.args || null),
            source: meta.source || null,
            execution: [],
            before,
            after: null,
            result: null,
            inconsistencies: [],
            errors: []
        };
        state.operations.push(operation);
        state.stack.push(operation);
        trim();
        return operation;
    }

    function end(operation, result = null, meta = {}) {
        if (!operation) return null;
        operation.endedAt = now();
        operation.durationMs = operation.endedAt - operation.startedAt;
        operation.result = safeValue(result);
        operation.after = snapshotState(meta.afterMeta || meta);
        operation.status = meta.status || (operation.errors.length ? "ERROR" : "OK");
        operation.inconsistencies = Array.isArray(meta.inconsistencies)
            ? meta.inconsistencies.map(item => safeValue(item))
            : [];
        const index = state.stack.lastIndexOf(operation);
        if (index >= 0) state.stack.splice(index, 1);
        return operation;
    }

    function fail(operation, error, meta = {}) {
        const entry = addError(error, meta);
        if (operation) {
            operation.errors.push(entry);
            operation.status = "ERROR";
            end(operation, null, { ...meta, status: "ERROR" });
        }
        return entry;
    }

    async function run(type, meta, callback) {
        const operation = begin(type, meta);
        try {
            const result = await callback({
                operation,
                step: step => addStep(operation, step),
                snapshot: snapshotState
            });
            end(operation, result, meta);
            return result;
        } catch (error) {
            fail(operation, error, meta);
            throw error;
        }
    }

    function registerEvent(target, type, listener) {
        const key = typeof target === "string"
            ? target
            : target === root ? "window"
                : target === document ? "document"
                    : target?.id ? `#${target.id}`
                        : target?.tagName ? target.tagName.toLowerCase() : "unknown";
        if (!state.eventRegistry.has(key)) state.eventRegistry.set(key, new Set());
        state.eventRegistry.get(key).add(String(type));
        return listener;
    }

    function clear() {
        state.operations = [];
        state.errors = [];
        state.stack = [];
        state.operationCounter = 0;
        return true;
    }

    function report(options = {}) {
        const result = {
            diagnosticVersion: state.version,
            generatedAt: now(),
            active: state.active,
            ready: state.ready,
            startedAt: state.startedAt,
            operationCount: state.operations.length,
            errorCount: state.errors.length,
            operations: state.operations.map(operation => safeValue(operation)),
            errors: state.errors.map(error => safeValue(error)),
            state: snapshotState(),
            eventRegistry: Array.from(state.eventRegistry.entries()).map(([selector, types]) => ({
                selector,
                types: Array.from(types)
            }))
        };
        if (options.print !== false) nativeConsole.log("[EKKO_DIAG] Reporte estructurado", result);
        return result;
    }

    function last(options = {}) {
        const operation = state.operations[state.operations.length - 1] || null;
        if (options.print !== false) nativeConsole.log("[EKKO_DIAG] Última operación", operation);
        return operation ? safeValue(operation) : null;
    }

    function start(options = {}) {
        if (options.clear !== false) clear();
        state.active = true;
        state.startedAt = now();
        nativeConsole.log("[EKKO_DIAG] Captura estructurada iniciada");
        return true;
    }

    function stop() {
        state.active = false;
        state.stack = [];
        nativeConsole.log("[EKKO_DIAG] Captura estructurada detenida");
        return true;
    }

    function markReady(detail = {}) {
        state.ready = true;
        if (root && !root.__ekkoDiagReadyDispatched) {
            root.__ekkoDiagReadyDispatched = true;
            try {
                root.dispatchEvent(new CustomEvent("EKKO_STUDIO_READY", { detail: safeValue(detail) }));
            } catch (e) {}
        }
        return true;
    }

    function logEvent(type, meta = {}) {
        const operation = begin(type, meta);
        if (!operation) return null;
        addStep(operation, {
            file: meta.file || null,
            function: meta.function || meta.fn || type,
            args: meta.args || null,
            result: meta.result || null
        });
        return end(operation, meta.result || null, meta);
    }

    function assert(condition, code, details = {}) {
        if (condition) return { ok: true, code };
        const inconsistency = {
            code: code || "ASSERTION_FAILED",
            details: safeValue(details)
        };
        const operation = state.stack[state.stack.length - 1];
        if (operation) operation.inconsistencies.push(inconsistency);
        return { ok: false, ...inconsistency };
    }

    const api = {
        version: state.version,
        start,
        stop,
        clear,
        begin,
        end,
        fail,
        run,
        step: addStep,
        logEvent,
        report,
        last,
        assert,
        markReady,
        snapshotItem,
        snapshotState,
        registerEvent,
        getEventRegistry: () => state.eventRegistry,
        getOperations: () => state.operations,
        getConsoleErrors: () => state.errors,
        isActive: () => state.active,
        isReady: () => state.ready,
        copyErrors: async function () {
            const text = JSON.stringify(report({ print: false }), null, 2);
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return text;
            }
            nativeConsole.log(text);
            return text;
        },
        inspect: () => report({ print: true })
    };

    if (typeof window !== "undefined") {
        window.addEventListener("error", event => {
            if (state.active) addError(event.error || new Error(event.message), {
                source: event.filename,
                line: event.lineno,
                column: event.colno
            });
        });
        window.addEventListener("unhandledrejection", event => {
            if (state.active) addError(event.reason || new Error("Unhandled rejection"));
        });
    }

    return api;
}));
