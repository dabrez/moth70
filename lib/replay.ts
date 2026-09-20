// Reconstructs a human/agent-readable click-path from a gzipped rrweb recording.
//
// An agent can't do anything with raw rrweb JSON — it's a DOM mutation log. What it needs
// is the action sequence that produced the bug: "clicked button.checkout-submit, typed into
// #email, resized viewport". That's what this file extracts.
//
// Enum values below are transcribed from extension/vendor/rrweb.min.js (rrweb 2.x) rather
// than imported, because this runs server-side and rrweb is a browser-only ESM package.

const EventType = {
  DomContentLoaded: 0,
  Load: 1,
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
  Plugin: 6,
} as const;

const IncrementalSource = {
  Mutation: 0,
  MouseMove: 1,
  MouseInteraction: 2,
  Scroll: 3,
  ViewportResize: 4,
  Input: 5,
  TouchMove: 6,
  MediaInteraction: 7,
} as const;

const MouseInteractions = {
  MouseUp: 0,
  MouseDown: 1,
  Click: 2,
  ContextMenu: 3,
  DblClick: 4,
  Focus: 5,
  Blur: 6,
  TouchStart: 7,
  TouchMove_Departed: 8,
  TouchEnd: 9,
} as const;

const NodeType = {
  Document: 0,
  DocumentType: 1,
  Element: 2,
  Text: 3,
  CDATA: 4,
  Comment: 5,
} as const;

// Interactions worth reporting. Mouse up/down are dropped because the Click that follows
// already covers them, and mouse-move/scroll are far too noisy to narrate.
const NARRATED_INTERACTIONS: Record<number, string> = {
  [MouseInteractions.Click]: 'Clicked',
  [MouseInteractions.DblClick]: 'Double-clicked',
  [MouseInteractions.ContextMenu]: 'Right-clicked',
  [MouseInteractions.TouchStart]: 'Tapped',
  [MouseInteractions.Focus]: 'Focused',
  [MouseInteractions.Blur]: 'Blurred',
};

type SerializedNode = {
  id: number;
  type: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SerializedNode[];
  textContent?: string;
};

type RrwebEvent = {
  type: number;
  timestamp: number;
  data?: Record<string, unknown>;
};

export type ClickPathStep = {
  /** Milliseconds since the first recorded event. */
  offsetMs: number;
  action: string;
  target: string | null;
  detail?: string;
};

export type ReplaySummary = {
  steps: ClickPathStep[];
  durationMs: number;
  eventCount: number;
  /** True when the recording had no resolvable DOM snapshot, so targets are unnamed. */
  degraded: boolean;
};

/** Element metadata kept for selector building, keyed by rrweb node id. */
type NodeMeta = {
  tagName: string;
  id?: string;
  classes?: string;
  attrs: Record<string, string>;
  text?: string;
};

function attrString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * Walks a serialized rrweb DOM tree, recording element metadata by node id.
 * Also collects the immediate text of each element so buttons/links can be
 * described by their label rather than only their selector.
 */
function indexNodes(node: SerializedNode | undefined, index: Map<number, NodeMeta>): void {
  if (!node || typeof node !== 'object') return;

  if (node.type === NodeType.Element && typeof node.tagName === 'string') {
    const rawAttrs = node.attributes ?? {};
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawAttrs)) {
      const str = attrString(value);
      if (str !== undefined) attrs[key] = str;
    }

    // Direct text children only — descending further would pull in the whole subtree
    // of a wrapper element and produce useless labels.
    const text = (node.childNodes ?? [])
      .filter((child) => child.type === NodeType.Text)
      .map((child) => (child.textContent ?? '').trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    index.set(node.id, {
      tagName: node.tagName.toLowerCase(),
      id: attrs.id,
      classes: attrs.class,
      attrs,
      text: text || undefined,
    });
  }

  for (const child of node.childNodes ?? []) indexNodes(child, index);
}

/**
 * Builds the most identifying selector available for an element, preferring
 * stable test hooks over generated class names.
 */
function describeNode(meta: NodeMeta | undefined): string | null {
  if (!meta) return null;

  const testId =
    meta.attrs['data-testid'] ?? meta.attrs['data-test-id'] ?? meta.attrs['data-test'];
  if (testId) return `${meta.tagName}[data-testid="${testId}"]`;

  if (meta.id) return `${meta.tagName}#${meta.id}`;

  if (meta.attrs.name) return `${meta.tagName}[name="${meta.attrs.name}"]`;

  if (meta.attrs['aria-label']) {
    return `${meta.tagName}[aria-label="${truncate(meta.attrs['aria-label'], 40)}"]`;
  }

  if (meta.classes) {
    // Utility-class soup (Tailwind etc.) makes for unreadable selectors, so keep
    // only the first couple of classes as a hint.
    const classes = meta.classes.trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (classes.length > 0) return `${meta.tagName}.${classes.join('.')}`;
  }

  if (meta.attrs.href) return `${meta.tagName}[href="${truncate(meta.attrs.href, 60)}"]`;
  if (meta.attrs.type) return `${meta.tagName}[type="${meta.attrs.type}"]`;

  return meta.tagName;
}

function truncate(value: string, max: number): string {
  const str = String(value);
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/** The visible label of an element, used to make a step read like a human action. */
function describeLabel(meta: NodeMeta | undefined): string | undefined {
  if (!meta) return undefined;
  const label = meta.text ?? meta.attrs['aria-label'] ?? meta.attrs.placeholder ?? meta.attrs.value;
  if (!label) return undefined;
  const clean = label.replace(/\s+/g, ' ').trim();
  return clean ? truncate(clean, 60) : undefined;
}

/**
 * Decodes the base64+gzip payload the extension produces. Returns null on any
 * failure — a corrupt or truncated recording must never break report rendering.
 */
export async function decodeSessionReplay(encoded: string): Promise<RrwebEvent[] | null> {
  try {
    const compressed = Buffer.from(encoded, 'base64');
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const json = await new Response(stream).text();
    const events = JSON.parse(json);
    return Array.isArray(events) ? (events as RrwebEvent[]) : null;
  } catch {
    return null;
  }
}

/**
 * Turns rrweb events into an ordered list of user actions.
 *
 * Input values are never included: the extension records with `maskAllInputs`, so the
 * captured text is masked placeholder characters, not real content. We report only that
 * a field was typed into and how many characters it held.
 */
export function buildClickPath(events: RrwebEvent[]): ReplaySummary {
  const usable = events.filter((e) => e && typeof e.timestamp === 'number');
  if (usable.length === 0) {
    return { steps: [], durationMs: 0, eventCount: 0, degraded: true };
  }

  const sorted = [...usable].sort((a, b) => a.timestamp - b.timestamp);
  const startedAt = sorted[0].timestamp;
  const endedAt = sorted[sorted.length - 1].timestamp;

  const nodeIndex = new Map<number, NodeMeta>();
  const steps: ClickPathStep[] = [];
  let sawSnapshot = false;

  // Collapses runs of typing into one step per field, so a 20-character entry
  // reads as a single action instead of twenty.
  let pendingInput: { nodeId: number; offsetMs: number; count: number } | null = null;

  // A focus is held for one step: if typing into the same field follows, the focus is
  // redundant and dropped; otherwise it is emitted as a real action (e.g. tab-through).
  let pendingFocus: { nodeId: number; offsetMs: number; action: string } | null = null;

  const emitPendingFocus = () => {
    if (!pendingFocus) return;
    const meta = nodeIndex.get(pendingFocus.nodeId);
    const label = describeLabel(meta);
    steps.push({
      offsetMs: pendingFocus.offsetMs,
      action: pendingFocus.action,
      target: describeNode(meta),
      detail: label ? `labelled "${label}"` : undefined,
    });
    pendingFocus = null;
  };

  const flushInput = () => {
    if (!pendingInput) return;
    const meta = nodeIndex.get(pendingInput.nodeId);
    const label = describeLabel(meta);
    steps.push({
      offsetMs: pendingInput.offsetMs,
      action: 'Typed into',
      target: describeNode(meta),
      detail:
        `${pendingInput.count} input event${pendingInput.count === 1 ? '' : 's'}` +
        (label ? ` — field labelled "${label}"` : '') +
        ' (values masked at capture)',
    });
    pendingInput = null;
  };

  for (const event of sorted) {
    const offsetMs = event.timestamp - startedAt;
    const data = event.data ?? {};

    if (event.type === EventType.Meta) {
      flushInput();
      emitPendingFocus();
      const href = attrString(data.href);
      if (href) {
        steps.push({
          offsetMs,
          action: 'Navigated to',
          target: null,
          detail: truncate(href, 200),
        });
      }
      continue;
    }

    if (event.type === EventType.FullSnapshot) {
      sawSnapshot = true;
      const node = (data as { node?: SerializedNode }).node;
      indexNodes(node, nodeIndex);
      continue;
    }

    if (event.type !== EventType.IncrementalSnapshot) continue;

    const source = data.source;

    // Nodes added after the initial snapshot must be indexed too, or clicks on
    // dynamically rendered elements resolve to nothing.
    if (source === IncrementalSource.Mutation) {
      const adds = (data.adds ?? []) as Array<{ node?: SerializedNode }>;
      for (const add of adds) indexNodes(add?.node, nodeIndex);

      const attributes = (data.attributes ?? []) as Array<{
        id?: number;
        attributes?: Record<string, unknown>;
      }>;
      for (const change of attributes) {
        if (typeof change?.id !== 'number') continue;
        const meta = nodeIndex.get(change.id);
        if (!meta) continue;
        for (const [key, value] of Object.entries(change.attributes ?? {})) {
          const str = attrString(value);
          if (str === undefined) {
            delete meta.attrs[key];
            if (key === 'id') meta.id = undefined;
            if (key === 'class') meta.classes = undefined;
          } else {
            meta.attrs[key] = str;
            if (key === 'id') meta.id = str;
            if (key === 'class') meta.classes = str;
          }
        }
      }
      continue;
    }

    if (source === IncrementalSource.MouseInteraction) {
      const interactionType = data.type as number;
      const action = NARRATED_INTERACTIONS[interactionType];
      if (!action) continue;

      if (
        interactionType === MouseInteractions.Focus ||
        interactionType === MouseInteractions.Blur
      ) {
        // Focus/blur bracketing a typed field is implied by the input step itself.
        // Blur is checked against the field currently being typed into; focus is
        // held back instead, because it arrives *before* the first input event and
        // we cannot yet know whether typing follows.
        if (pendingInput && data.id === pendingInput.nodeId) continue;

        if (interactionType === MouseInteractions.Focus) {
          flushInput();
          // A previously held focus was never followed by typing, so it was a real
          // action (tab-through) and must be emitted before this one replaces it.
          emitPendingFocus();
          pendingFocus = { nodeId: data.id as number, offsetMs, action };
          continue;
        }
      }

      flushInput();
      emitPendingFocus();
      const meta = nodeIndex.get(data.id as number);
      const label = describeLabel(meta);
      steps.push({
        offsetMs,
        action,
        target: describeNode(meta),
        detail: label ? `labelled "${label}"` : undefined,
      });
      continue;
    }

    if (source === IncrementalSource.Input) {
      const nodeId = data.id as number;
      // Typing into the just-focused field makes that focus redundant; a focus on any
      // other element was a real action and still needs to be emitted.
      if (pendingFocus) {
        if (pendingFocus.nodeId === nodeId) pendingFocus = null;
        else emitPendingFocus();
      }
      if (pendingInput && pendingInput.nodeId === nodeId) {
        pendingInput.count += 1;
      } else {
        flushInput();
        pendingInput = { nodeId, offsetMs, count: 1 };
      }
      continue;
    }

    if (source === IncrementalSource.ViewportResize) {
      flushInput();
      emitPendingFocus();
      steps.push({
        offsetMs,
        action: 'Resized viewport to',
        target: null,
        detail: `${data.width}×${data.height}`,
      });
      continue;
    }
  }

  flushInput();
  emitPendingFocus();

  return {
    steps,
    durationMs: endedAt - startedAt,
    eventCount: sorted.length,
    degraded: !sawSnapshot,
  };
}

export function formatOffset(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
