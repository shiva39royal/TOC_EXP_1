import type {
  LevelCrossing,
  PointSwitch,
  SignalDirection,
  SignalNode,
  TrackLine,
} from "@/types/signalling";
import type { InternalTrackLine } from "../lines/lines";

export interface GraphNode {
  id: string;
  name: string;
  kind: "SIGNAL" | "SWITCH_POINT" | "LC_GATE" | "TRACK_BOUNDARY";
  lineId: string;
  direction: SignalDirection;
  x: number;
  y: number;
  chainageM: number | null;
  footTagId?: string;
  signalNode?: SignalNode;
  pointSwitch?: PointSwitch;
  levelCrossing?: LevelCrossing;
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  lineId: string;
  direction: SignalDirection;
  lengthM: number;
  isDiverging: boolean;
  pointsRequired: Array<{ pointName: string; position: "NORMAL" | "REVERSE" }>;
  trackCircuits: string[];
  tins: string[];
  rfidTags: Array<{ id: string; chainageM: number | null; x: number }>;
  levelCrossings: string[];
}

export interface RailwayGraphInput {
  signals: SignalNode[];
  points: PointSwitch[];
  levelCrossings: LevelCrossing[];
  trackLines: TrackLine[];
  internalLines?: InternalTrackLine[];
  rfidTags?: Array<{ id: string; chainageM: number | null; x: number; lineId?: string }>;
}

export interface RailwayGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  adjacency: Map<string, GraphEdge[]>;
  reverseAdjacency: Map<string, GraphEdge[]>;
}

export function buildRailwayGraph(input: RailwayGraphInput): RailwayGraph {
  const { signals, points, levelCrossings, trackLines } = input;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const adjacency = new Map<string, GraphEdge[]>();
  const reverseAdjacency = new Map<string, GraphEdge[]>();

  const addNode = (node: GraphNode) => {
    nodes.set(node.id, node);
    if (!adjacency.has(node.id)) adjacency.set(node.id, []);
    if (!reverseAdjacency.has(node.id)) reverseAdjacency.set(node.id, []);
  };

  const addEdge = (edge: GraphEdge) => {
    edges.push(edge);
    adjacency.get(edge.fromNodeId)?.push(edge);
    reverseAdjacency.get(edge.toNodeId)?.push(edge);
  };

  // 1. Add Signal Nodes
  for (const sig of signals) {
    const internal = input.internalLines?.find((il) => il.id === sig.line);
    const x = Number.isFinite(sig.x)
      ? sig.x!
      : internal
        ? sig.direction === "DOWN"
          ? internal.x0 + 100
          : internal.x1 - 100
        : 0;
    const y = Number.isFinite(sig.y) ? sig.y! : internal ? internal.y : 0;

    addNode({
      id: sig.id,
      name: sig.name,
      kind: "SIGNAL",
      lineId: sig.line,
      direction: sig.direction,
      x,
      y,
      chainageM: sig.chainageM,
      footTagId: sig.footTagId,
      signalNode: sig,
    });
  }

  // 2. Add Switch Point Nodes
  for (const pt of points) {
    addNode({
      id: `POINT_${pt.name}`,
      name: pt.name,
      kind: "SWITCH_POINT",
      lineId: pt.normalLine,
      direction: "BIDIRECTIONAL",
      x: 0,
      y: 0,
      chainageM: pt.chainageM,
      pointSwitch: pt,
    });
  }

  // 3. Add Level Crossing Nodes
  for (const lc of levelCrossings) {
    addNode({
      id: lc.id,
      name: lc.name,
      kind: "LC_GATE",
      lineId: trackLines[0]?.name || "MAIN LINE",
      direction: "BIDIRECTIONAL",
      x: 0,
      y: 0,
      chainageM: lc.chainageM,
      levelCrossing: lc,
    });
  }

  // 4. Construct Edges along each Track Line
  for (const track of trackLines) {
    // Signals on this track line
    const signalsOnTrack = signals
      .filter(
        (s) =>
          s.line === track.name || (track.lineType.includes("MAIN") && s.line.includes("MAIN")),
      )
      .slice();

    // Sort signals along running direction
    // Down signals: ordered by ascending chainage (or left to right)
    // Up signals: ordered by descending chainage (or right to left)
    const downSignals = signalsOnTrack
      .filter((s) => s.direction === "DOWN")
      .sort((a, b) => (a.chainageM ?? 0) - (b.chainageM ?? 0));

    for (let i = 0; i < downSignals.length - 1; i++) {
      const from = downSignals[i]!;
      const to = downSignals[i + 1]!;
      const lengthM =
        from.chainageM !== null && to.chainageM !== null
          ? Math.abs(to.chainageM - from.chainageM)
          : 1000;

      // Find tags between from and to
      const tagsBetween = (input.rfidTags || [])
        .filter((t) => {
          if (t.chainageM === null || from.chainageM === null || to.chainageM === null)
            return false;
          return t.chainageM > from.chainageM && t.chainageM < to.chainageM;
        })
        .sort((a, b) => (a.chainageM ?? 0) - (b.chainageM ?? 0));

      // Level crossings between from and to
      const lcsBetween = levelCrossings
        .filter((lc) => {
          if (lc.chainageM === null || from.chainageM === null || to.chainageM === null)
            return false;
          return lc.chainageM >= from.chainageM && lc.chainageM <= to.chainageM;
        })
        .map((lc) => lc.name);

      addEdge({
        id: `EDGE_${from.id}_TO_${to.id}`,
        fromNodeId: from.id,
        toNodeId: to.id,
        lineId: track.name,
        direction: "DOWN",
        lengthM,
        isDiverging: false,
        pointsRequired: [],
        trackCircuits: track.trackCircuit ? track.trackCircuit.split(",").map((s) => s.trim()) : [],
        tins: track.tinList || [],
        rfidTags: tagsBetween,
        levelCrossings: lcsBetween,
      });
    }

    const upSignals = signalsOnTrack
      .filter((s) => s.direction === "UP")
      .sort((a, b) => (b.chainageM ?? 0) - (a.chainageM ?? 0));

    for (let i = 0; i < upSignals.length - 1; i++) {
      const from = upSignals[i]!;
      const to = upSignals[i + 1]!;
      const lengthM =
        from.chainageM !== null && to.chainageM !== null
          ? Math.abs(from.chainageM - to.chainageM)
          : 1000;

      const tagsBetween = (input.rfidTags || [])
        .filter((t) => {
          if (t.chainageM === null || from.chainageM === null || to.chainageM === null)
            return false;
          return t.chainageM < from.chainageM && t.chainageM > to.chainageM;
        })
        .sort((a, b) => (b.chainageM ?? 0) - (a.chainageM ?? 0));

      const lcsBetween = levelCrossings
        .filter((lc) => {
          if (lc.chainageM === null || from.chainageM === null || to.chainageM === null)
            return false;
          return lc.chainageM <= from.chainageM && lc.chainageM >= to.chainageM;
        })
        .map((lc) => lc.name);

      addEdge({
        id: `EDGE_${from.id}_TO_${to.id}`,
        fromNodeId: from.id,
        toNodeId: to.id,
        lineId: track.name,
        direction: "UP",
        lengthM,
        isDiverging: false,
        pointsRequired: [],
        trackCircuits: track.trackCircuit ? track.trackCircuit.split(",").map((s) => s.trim()) : [],
        tins: track.tinList || [],
        rfidTags: tagsBetween,
        levelCrossings: lcsBetween,
      });
    }
  }

  // 5. Construct Directed Signalling Edges (Home -> Starters, Starters -> Adv Starter)
  // 100% dynamic without requiring point machine switches
  const directions: Array<SignalDirection> = ["DOWN", "UP"];

  for (const dir of directions) {
    const dirSignals = signals.filter(
      (s) => s.direction === dir || s.direction === "BIDIRECTIONAL",
    );

    const homeSig = dirSignals.find((s) => s.signalType === "HOME");
    const callingOnSig = dirSignals.find(
      (s) => s.signalType === "CALLING_ON" && (homeSig ? s.base === homeSig.base : true),
    );
    const starters = dirSignals.filter((s) => s.signalType === "STARTER");
    const advStarter = dirSignals.find((s) => s.signalType === "ADVANCED_STARTER");

    // 5A. Reception Edges: Home -> All Starters (Mainline and Loops)
    if (homeSig) {
      for (const starter of starters) {
        const edgeId = `RECEPTION_${homeSig.id}_TO_${starter.id}`;
        if (edges.some((e) => e.fromNodeId === homeSig.id && e.toNodeId === starter.id)) {
          continue;
        }

        const isDiverging =
          /loop/i.test(starter.line) ||
          (typeof starter.y === "number" &&
            typeof homeSig.y === "number" &&
            Math.abs(starter.y - homeSig.y) > 8);

        const lengthM =
          homeSig.chainageM !== null && starter.chainageM !== null
            ? Math.abs(starter.chainageM - homeSig.chainageM)
            : 1510;

        addEdge({
          id: edgeId,
          fromNodeId: homeSig.id,
          toNodeId: starter.id,
          lineId: starter.line,
          direction: dir,
          lengthM,
          isDiverging,
          pointsRequired: [],
          trackCircuits: [],
          tins: [],
          rfidTags: [],
          levelCrossings: [],
        });

        // 5B. Calling-on Reception Edges
        if (callingOnSig) {
          addEdge({
            id: `CALLING_ON_${callingOnSig.id}_TO_${starter.id}`,
            fromNodeId: callingOnSig.id,
            toNodeId: starter.id,
            lineId: starter.line,
            direction: dir,
            lengthM,
            isDiverging,
            pointsRequired: [],
            trackCircuits: [],
            tins: [],
            rfidTags: [],
            levelCrossings: [],
          });
        }
      }
    }

    // 5C. Departure Edges: All Starters -> Advanced Starter
    if (advStarter) {
      for (const starter of starters) {
        const edgeId = `DEPARTURE_${starter.id}_TO_${advStarter.id}`;
        if (edges.some((e) => e.fromNodeId === starter.id && e.toNodeId === advStarter.id)) {
          continue;
        }

        const lengthM =
          starter.chainageM !== null && advStarter.chainageM !== null
            ? Math.abs(advStarter.chainageM - starter.chainageM)
            : 1200;

        addEdge({
          id: edgeId,
          fromNodeId: starter.id,
          toNodeId: advStarter.id,
          lineId: advStarter.line,
          direction: dir,
          lengthM,
          isDiverging: /loop/i.test(starter.line),
          pointsRequired: [],
          trackCircuits: [],
          tins: [],
          rfidTags: [],
          levelCrossings: [],
        });
      }
    }

    // 5D. Intermediate Block Connections (if present)
    const ibDistant = dirSignals.find(
      (s) => s.signalType === "DISTANT" && s.id.toUpperCase().includes("IB"),
    );
    const ibInnerDistant = dirSignals.find(
      (s) => s.signalType === "INNER_DISTANT" && s.id.toUpperCase().includes("IB"),
    );
    const ibSignal = dirSignals.find((s) => s.signalType === "INTERMEDIATE_BLOCK");

    if (advStarter && ibDistant) {
      addEdge({
        id: `BLOCK_${advStarter.id}_TO_${ibDistant.id}`,
        fromNodeId: advStarter.id,
        toNodeId: ibDistant.id,
        lineId: advStarter.line,
        direction: dir,
        lengthM: 3000,
        isDiverging: false,
        pointsRequired: [],
        trackCircuits: [],
        tins: [],
        rfidTags: [],
        levelCrossings: [],
      });
    }

    if (ibDistant && ibInnerDistant) {
      addEdge({
        id: `IB_APPROACH_${ibDistant.id}_TO_${ibInnerDistant.id}`,
        fromNodeId: ibDistant.id,
        toNodeId: ibInnerDistant.id,
        lineId: advStarter ? advStarter.line : "MAIN LINE",
        direction: dir,
        lengthM: 1000,
        isDiverging: false,
        pointsRequired: [],
        trackCircuits: [],
        tins: [],
        rfidTags: [],
        levelCrossings: [],
      });
    }

    if (ibInnerDistant && ibSignal) {
      addEdge({
        id: `IB_APPROACH_${ibInnerDistant.id}_TO_${ibSignal.id}`,
        fromNodeId: ibInnerDistant.id,
        toNodeId: ibSignal.id,
        lineId: advStarter ? advStarter.line : "MAIN LINE",
        direction: dir,
        lengthM: 1050,
        isDiverging: false,
        pointsRequired: [],
        trackCircuits: [],
        tins: [],
        rfidTags: [],
        levelCrossings: [],
      });
    }
  }

  // 6. Optional: Construct Crossover Edges for Diverging Routes if points exist
  for (const pt of points) {
    if (!pt.normalLine || !pt.reverseLine) continue;

    // Find Home signal on normalLine leading to this point
    const homeSig = signals.find((s) => s.signalType === "HOME" && s.line === pt.normalLine);
    // Find Loop starter on reverseLine
    const loopStarter = signals.find(
      (s) => s.signalType === "STARTER" && s.line === pt.reverseLine,
    );

    if (homeSig && loopStarter) {
      const lengthM =
        homeSig.chainageM !== null && loopStarter.chainageM !== null
          ? Math.abs(loopStarter.chainageM - homeSig.chainageM)
          : 1510;

      const reverseTrack = trackLines.find(
        (t) => t.name === pt.reverseLine || t.id === pt.reverseLine,
      );
      const trackCircuits = reverseTrack?.trackCircuit
        ? reverseTrack.trackCircuit.split(",").map((s) => s.trim())
        : [loopStarter.name ? `${loopStarter.name}T` : "TURNOUT_TC"];
      const tins = reverseTrack?.tinList || [];

      addEdge({
        id: `DIVERGE_${homeSig.id}_TO_${loopStarter.id}_VIA_PT_${pt.name}`,
        fromNodeId: homeSig.id,
        toNodeId: loopStarter.id,
        lineId: pt.reverseLine,
        direction: homeSig.direction,
        lengthM,
        isDiverging: true,
        pointsRequired: [{ pointName: pt.name, position: "REVERSE" }],
        trackCircuits,
        tins,
        rfidTags: [],
        levelCrossings: [],
      });
    }
  }

  return {
    nodes,
    edges,
    adjacency,
    reverseAdjacency,
  };
}

export function findSequentialSignals(
  graph: RailwayGraph,
  fromSignalId: string,
): Array<{ exitSignalId: string; edge: GraphEdge }> {
  const outgoing = graph.adjacency.get(fromSignalId) || [];
  return outgoing.map((edge) => ({
    exitSignalId: edge.toNodeId,
    edge,
  }));
}
