export function normalizeEvidence(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/LX\s*NO\.?|LC\s*NO\.?/g, "LC")
    .replace(/[^A-Z0-9]+/g, "");
}

export function sourceIncludes(source: string, value: unknown): boolean {
  const needle = normalizeEvidence(value);
  if (!needle || needle === "--") return false;
  return normalizeEvidence(source).includes(needle);
}

function present(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/^(?:--?|UNKNOWN|N\/?A|NONE|NULL|TBD)$/i.test(text);
}

function completeness(item: any): number {
  const confidence = item?.confidence === "HIGH" ? 3 : item?.confidence === "MEDIUM" ? 2 : 1;
  const fields = Object.values(item ?? {}).filter(
    (value) => present(value) && (!Array.isArray(value) || value.length > 0),
  ).length;
  return confidence * 100 + fields;
}

function mergeBy(results: any[], collection: string, keyFor: (item: any) => string): any[] {
  const merged = new Map<string, any>();
  for (const result of results) {
    const items = Array.isArray(result?.[collection]) ? result[collection] : [];
    for (const item of items) {
      const key = keyFor(item);
      if (!key) continue;
      const previous = merged.get(key);
      if (!previous) {
        merged.set(key, item);
        continue;
      }
      const preferred = completeness(item) > completeness(previous) ? item : previous;
      const fallback = preferred === item ? previous : item;
      const combined = { ...fallback, ...preferred };
      for (const [field, value] of Object.entries(preferred)) {
        if (!present(value) && present(fallback[field])) combined[field] = fallback[field];
      }
      merged.set(key, combined);
    }
  }
  return Array.from(merged.values());
}

export function mergeLayoutExtractions(results: any[]): any {
  if (results.length === 0) return {};
  const metadata: Record<string, unknown> = {};
  for (const result of results) {
    for (const [key, value] of Object.entries(result?.metadata ?? {})) {
      if (!present(metadata[key]) && present(value)) metadata[key] = value;
    }
  }
  const routes = mergeBy(results, "routes", (route) =>
    [route?.entrySignal, route?.exitSignal, route?.leadingToLine, route?.direction]
      .map(normalizeEvidence)
      .join(":"),
  ).map((route, index) => ({ ...route, slNo: index + 1 }));
  return {
    metadata,
    sourceSummary: "",
    tracks: mergeBy(results, "tracks", (track) => normalizeEvidence(track?.name)),
    signals: mergeBy(results, "signals", (signal) => normalizeEvidence(signal?.name)),
    points: mergeBy(results, "points", (point) => normalizeEvidence(point?.name)),
    tags: mergeBy(results, "tags", (tag) => normalizeEvidence(tag?.tagId)),
    levelCrossings: mergeBy(results, "levelCrossings", (lc) => normalizeEvidence(lc?.name)),
    routes,
    blockSections: mergeBy(results, "blockSections", (block) =>
      [block?.lastStopSignal, block?.nextStationId, block?.blockSectionTin]
        .map(normalizeEvidence)
        .join(":"),
    ),
  };
}

export function planVisualSections<T>(parts: T[], sectionSize = 3): T[][] {
  if (parts.length <= sectionSize) return parts.length > 0 ? [parts] : [];
  const sections: T[][] = [];
  for (let index = 0; index < parts.length; index += sectionSize) {
    sections.push(parts.slice(index, index + sectionSize));
  }
  return sections;
}

/**
 * Removes cross-table references and embedded-text identifiers that have no source support.
 * Vision-only raster files cannot be text-cross-checked, so their confidence and review flags remain essential.
 */
type GroundableProject = {
  metadata?: Record<string, any>;
  tracks?: any[];
  signals?: any[];
  points?: any[];
  tags?: any[];
  levelCrossings?: any[];
  routes?: any[];
  blockSections?: any[];
};

export function groundNormalizedExtraction<T extends GroundableProject>(
  project: T,
  embeddedText: string,
): T {
  const hasTextEvidence = normalizeEvidence(embeddedText).length >= 20;
  const supported = (value: unknown) => !hasTextEvidence || sourceIncludes(embeddedText, value);

  const tracks = (project.tracks ?? []).filter(
    (track: any) => present(track?.name) && supported(track.name),
  );
  const signals = (project.signals ?? []).filter(
    (signal: any) => present(signal?.name) && supported(signal.name),
  );
  const points = (project.points ?? []).filter(
    (point: any) => present(point?.name) && supported(point.name),
  );
  const tags = (project.tags ?? []).filter(
    (tag: any) => present(tag?.tagId) && supported(tag.tagId),
  );
  const levelCrossings = (project.levelCrossings ?? []).filter(
    (lc: any) => present(lc?.name) && supported(lc.name),
  );

  const signalNames = new Set<string>(signals.map((signal: any) => normalizeEvidence(signal.name)));
  const pointNames = new Set<string>(points.map((point: any) => normalizeEvidence(point.name)));
  const tagNames = new Set<string>(tags.map((tag: any) => normalizeEvidence(tag.tagId)));
  const knownReferences = (values: any[], known: Set<string>) =>
    (Array.isArray(values) ? values : []).filter((value) => known.has(normalizeEvidence(value)));

  const routes = (project.routes ?? [])
    .filter(
      (route: any) =>
        signalNames.has(normalizeEvidence(route?.entrySignal)) &&
        signalNames.has(normalizeEvidence(route?.exitSignal)),
    )
    .map((route: any, index: number) => ({
      ...route,
      slNo: index + 1,
      pointsNormal: knownReferences(route.pointsNormal, pointNames),
      pointsReverse: knownReferences(route.pointsReverse, pointNames),
      tinsRequiresFree: Array.isArray(route.tinsRequiresFree)
        ? route.tinsRequiresFree.filter(present)
        : [],
      entryFootTag: tagNames.has(normalizeEvidence(route.entryFootTag)) ? route.entryFootTag : "--",
      linkingSequence: (Array.isArray(route.linkingSequence) ? route.linkingSequence : []).filter(
        (link: any) => tagNames.has(normalizeEvidence(link?.tagId)),
      ),
      enRouteTags: knownReferences(route.enRouteTags, tagNames),
      conflictingTurnoutTags: knownReferences(route.conflictingTurnoutTags, tagNames),
      conflictingRouteTags: knownReferences(route.conflictingRouteTags, tagNames),
    }));

  const blockSections = (project.blockSections ?? [])
    .filter((block: any) => signalNames.has(normalizeEvidence(block?.lastStopSignal)))
    .map((block: any) => ({
      ...block,
      nextStationBorderRfid: tagNames.has(normalizeEvidence(block.nextStationBorderRfid))
        ? block.nextStationBorderRfid
        : "--",
      sosRfidTags: knownReferences(block.sosRfidTags, tagNames),
    }));

  const metadata = { ...(project as any).metadata };
  if (hasTextEvidence && metadata) {
    for (const key of ["division", "section", "nextDownStationId", "nextUpStationId"] as const) {
      if (present(metadata[key]) && !supported(metadata[key])) metadata[key] = "--";
    }
  }

  return {
    ...project,
    metadata,
    tracks,
    signals,
    points,
    tags,
    levelCrossings,
    routes,
    blockSections,
  };
}
