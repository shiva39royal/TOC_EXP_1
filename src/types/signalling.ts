export type LineType =
  | 'UP_MAIN'
  | 'DN_MAIN'
  | 'COMMON_LOOP'
  | 'UP_LOOP'
  | 'DN_LOOP'
  | 'BRANCH'
  | 'SIDING';

export type SignalDirection = 'UP' | 'DOWN' | 'BIDIRECTIONAL' | 'UNKNOWN';

export type TagFunctionType =
  | 'SIGNAL_FOOT'
  | 'NORMAL'
  | 'LOOP'
  | 'GATE'
  | 'BOUNDARY'
  | 'DEAD_END'
  | 'UNKNOWN';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type TocFormatMode = 'CHITGIDDA_SELECTION' | 'JANKAMPET_TOC';

export interface StationMetadata {
  stationName: string;
  stationCode: string;
  stationId: string;
  division: string;
  section: string;
  refSip: string;
  refLayout: string;
  refToc: string;
  version: string;
  chainageDirection: 'LEFT_INCREASING' | 'RIGHT_INCREASING' | 'UNKNOWN';
  nextDownStationId: string;
  nextUpStationId: string;
  preparedBy: string;
  checkedBy: string;
  engineerSignedOff: boolean;
  signOffTimestamp?: string;
  signOffEngineerName?: string;
}

export interface TrackLine {
  id: string;
  name: string;
  lineType: LineType;
  direction: SignalDirection;
  trackCircuit: string;
  tinList: string[];
  ySlot: number; // Schematic vertical track row (0 = Top, 1 = Middle, 2 = Bottom, etc.)
  parentTrack?: string; // Track from which this loop/branch diverges
  startPointName?: string; // Point ID at left connection
  endPointName?: string; // Point ID at right connection
  isDeadEnd?: boolean; // Terminates at buffer stop
  extendsRight?: boolean; // Continues off right boundary (e.g. diverging branch line)
  extendsLeft?: boolean; // Continues off left boundary
}

export interface CadLineEntity {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  layer: string;
}

export interface CadTextEntity {
  x: number;
  y: number;
  text: string;
  layer: string;
  height?: number;
}

export interface CadCircleEntity {
  x: number;
  y: number;
  r: number;
  layer: string;
}

export interface CadGeometry {
  sourceFileName: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  lines: CadLineEntity[];
  circles: CadCircleEntity[];
  texts: CadTextEntity[];
}

export interface SignalNode {
  id: string;
  name: string;
  line: string;
  direction: SignalDirection;
  signalType: string;
  chainageM: number | null;
  footTagId: string;
  aspects: string[];
  trackCircuit?: string;
  routeLockingPrefix?: string;
  confidence: ConfidenceLevel;
  verified: boolean;
  notes?: string;
}

export interface PointSwitch {
  id: string;
  name: string;
  chainageM: number | null;
  normalLine: string;
  reverseLine: string;
  turnoutSpeedKmph: number | null;
  turnoutCommenceM?: number;
  turnoutLengthM?: number;
  confidence: ConfidenceLevel;
  notes?: string;
}

export interface RfidTag {
  id: string;
  tagId: string;
  chainageM: number | null;
  line: string;
  tin: string;
  tagType: TagFunctionType;
  linkedSignal?: string;
  confidence: ConfidenceLevel;
  verified: boolean;
  notes?: string;
}

export interface LevelCrossing {
  id: string;
  name: string;
  chainageM: number | null;
  manningType: string;
  lcClass: string;
  autoWhistling: string;
  closingCondition: string;
}

export interface LinkingTuple {
  distanceM: number;
  tagId: string;
}

export interface PsrSegment {
  speedKmph: string | number;
  staticSpeedType: string;
  lengthM: number;
}

export interface RouteAspectPermutation {
  aspectOfEntrySignal: string;
  requiresAspectOfExitSignal: string;
  movementAuthoritySections: string;
  authorizedSpeedOs: string;
}

export interface TocRouteRow {
  slNo: number;
  entrySignal: string;
  exitSignal: string;
  leadingToLine: string;
  direction: SignalDirection;
  tsrmsRouteId: string;
  signalType: string;
  aspectOfEntrySignal?: string;
  requiresAspectOfExitSignal?: string;
  aspectPermutations?: RouteAspectPermutation[];
  entryAspectSummary: string;
  exitAspectsSummary: string;
  requiredRouteLocking: string;
  pointsNormal: string[];
  pointsReverse: string[];
  trackCktUp: string;
  trackCircuitInOverlap?: string;
  tinsRequiresFree: string[];
  tinsInOverlap?: string[];
  entryFootTag: string;
  linkingSequence: LinkingTuple[];
  enRouteTags: string[];
  conflictingTurnoutTags: string[];
  conflictingRouteTags: string[];
  turnoutSpeedKmph: number | null;
  turnoutCommenceM: number | null;
  turnoutRestrictionDistM: number | null;
  distanceBetweenSignalsM: number;
  movementAuthoritySections: string;
  movementAuthorityMeters: string;
  authorizedSpeedSr: string;
  authorizedSpeedOs: string;
  psrSegments: PsrSegment[];
  averageGradient: string;
  isTsl: boolean;
  tslRouteCommand?: string;
  sectionType?: string;
  lcGateRequired?: string;
  overlapTrackCkt?: string;
  overlapTins?: string[];
  engineerStatus: 'AUTO_GENERATED' | 'NEEDS_REVIEW' | 'VERIFIED';
  sourceNotes?: string;
}

export interface ShuntingLimitEntry {
  adjacentStationName: string;
  direction: 'Nominal' | 'Reverse' | string;
  rfidTagNo: string;
  tin: string;
  absoluteLocationM: number;
}

export interface GradientEntry {
  type: 'R' | 'F' | 'Level' | string;
  gradientValue: string;
  lengthM: number;
}

export interface AverageGradientEntry {
  gradientValue: string;
  lengthM: number;
}

export interface TrackProfileRow {
  slNo: number;
  entrySignal: string;
  exitSignal: string;
  line: string;
  turnoutSpeedKmph: number | null;
  turnoutStartDistanceM: number | null;
  turnoutLengthM: number | null;
  psrList: PsrSegment[];
  engineeringGradients: GradientEntry[];
  averageGradients: AverageGradientEntry[];
  lcGate?: {
    id: string;
    distanceM: number;
    manningType: string;
    lcClass: string;
    autoWhistling: string;
  };
  trackCondition?: {
    type: string;
    startDistanceM: number;
    lengthM: number;
    description?: string;
  };
}

export interface TsrRouteRow {
  slNo: number;
  oheLine: string;
  entrySignal: string;
  exitSignal: string;
  oheLineStartRfidTag: string;
  tsrRouteId: string;
  entrySignalDistanceM: number;
  lastPoleDistanceM: number;
  ohePoles: Array<{ poleId: string; distanceM: number }>;
}

export interface TslRouteRow {
  slNo: number;
  tslEntrySignal: string;
  tslExitSignal: string;
  signalType: string;
  aspectOfEntrySignal: string;
  requiresAspectOfExitSignal: string;
  requiredRouteCommand: string;
  pointsNormal: string[];
  pointsReverse: string[];
  requiresTrackCktUp: string;
  tinsRequiresFree: string[];
  entryFootTag: string;
  linkingSequence: LinkingTuple[];
  distanceBetweenSignalsM: number;
  movementAuthoritySections: string;
  authorizedSpeedOsFirstTrain: string;
  authorizedSpeedOsSubsequentTrains: string;
}

export interface BlockSectionDetail {
  lastStopSignal: string;
  blockSectionTin: string;
  adjacentLineTins: string;
  nextStationId: string;
  nextStationBorderRfid: string;
  startDistAbsResetM: string;
  absLocationCorrectionM: string;
  locoDirectionAfterAdj: string;
  sosRfidTags?: string[];
  lastSignalMaMeters?: number;
  direction?: 'UP' | 'Down' | string;
  authorisedSpeed?: string;
}

export interface ValidationIssue {
  id: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  category: 'CHAINAGE' | 'CONNECTIVITY' | 'TIN' | 'RFID' | 'DIRECTION' | 'AMBIGUITY';
  title: string;
  description: string;
  affectedEntityId?: string;
  affectedRouteSlNo?: number;
  ruleReference: string;
  suggestedFix?: string;
  resolved: boolean;
  resolvedNote?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  details: string;
}

export interface SourceLayoutAsset {
  kind: 'DWG' | 'DXF' | 'PDF';
  fileName: string;
  dxfData?: unknown;
  pdfBase64?: string;
  pageCount?: number;
  layerCount?: number;
  blockCount?: number;
  entityCount?: number;
  cadVersion?: string;
}

export interface StationProject {
  id: string;
  metadata: StationMetadata;
  tocFormatPreference: TocFormatMode;
  tracks: TrackLine[];
  signals: SignalNode[];
  points: PointSwitch[];
  tags: RfidTag[];
  levelCrossings: LevelCrossing[];
  routes: TocRouteRow[];
  blockSections: BlockSectionDetail[];
  trackProfiles?: TrackProfileRow[];
  tsrRoutes?: TsrRouteRow[];
  tslRoutes?: TslRouteRow[];
  tslTrackProfiles?: TrackProfileRow[];
  shuntingLimits?: ShuntingLimitEntry[];
  signalsOverrideOv?: string[];
  authorizedSpeedOnSightKmph?: number;
  sectionSpeedKmph?: number;
  validationIssues: ValidationIssue[];
  auditLog: AuditEntry[];
  sourceSummary?: string;
  cadGeometry?: CadGeometry;
  sourceLayout?: SourceLayoutAsset;
}
