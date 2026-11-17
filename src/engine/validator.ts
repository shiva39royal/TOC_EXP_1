// @ts-nocheck -- ported from the original app (written for a looser TS config)
import type {
  RfidTag,
  SignalNode,
  StationProject,
  TocRouteRow,
  ValidationIssue,
} from '../types/signalling';

function normalizeTagKey(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function isPlaceholder(raw: string | undefined): boolean {
  if (!raw) return true;
  const trimmed = raw.trim().toUpperCase();
  return trimmed === '' || trimmed === '--' || trimmed === '----' || trimmed === 'N/A' || trimmed === 'NONE' || trimmed === 'TBD';
}

/**
 * Deterministic Engineering Validation Engine for KAVACH RFID Layouts & TOCs.
 * Evaluates chainage consistency, RFID linking distances, point conflicts,
 * TIN continuity, tag uniqueness, direction alignment, and CAD extraction ambiguities.
 */
export function runEngineeringValidation(
  project: StationProject,
  existingResolutions: Record<string, { resolved: boolean; resolvedNote?: string }> = {}
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const signalByName = new Map<string, SignalNode>();
  for (const sig of project.signals) {
    signalByName.set(sig.name.trim().toUpperCase(), sig);
  }

  const tagByNormalizedKey = new Map<string, RfidTag[]>();
  for (const tag of project.tags) {
    const norm = normalizeTagKey(tag.tagId);
    if (!norm) continue;
    const list = tagByNormalizedKey.get(norm) ?? [];
    list.push(tag);
    tagByNormalizedKey.set(norm, list);
  }

  // 1. Duplicate RFID Tag ID check (ignores same-line exact duplicates at identical chainage)
  for (const [normKey, occurrences] of tagByNormalizedKey.entries()) {
    if (occurrences.length > 1) {
      const displayId = occurrences[0].tagId;
      const id = `dup-tag-${normKey}`;
      issues.push({
        id,
        severity: 'ERROR',
        category: 'RFID',
        title: `Duplicate RFID Tag ID ${displayId}`,
        description: `Tag ${displayId} appears ${occurrences.length} times at chainages ${occurrences
          .map((o) => `${o.chainageM}m (${o.line})`)
          .join(', ')}. Every physical RFID tag must have a unique ID.`,
        affectedEntityId: displayId,
        ruleReference: 'RDSO SPN-196 §4.2 Tag Uniqueness',
        suggestedFix: 'Verify physical tag numbering on the CAD drawing and reassign any duplicate ID.',
        resolved: existingResolutions[id]?.resolved ?? false,
        resolvedNote: existingResolutions[id]?.resolvedNote,
      });
    }
  }

  // Tag-level TIN gaps are only meaningful when the source assigns TINs to individual tags.
  const usesTinSystem = project.tags.some((t) => !isPlaceholder(t.tin));

  const isAutoSectionOnly =
    project.routes.length > 0 &&
    project.routes.every((r) => /auto/i.test(r.sectionType || '') || /auto/i.test(r.signalType || ''));

  // 2. Orphan or unverified RFID Tags (missing TIN only flagged when layout uses TINs, or genuinely LOW confidence)
  for (const tag of project.tags) {
    if (usesTinSystem && !isAutoSectionOnly && isPlaceholder(tag.tin)) {
      const isYardTrackTag = tag.tagType === 'NORMAL' || tag.tagType === 'LOOP' || tag.tagType === 'SIGNAL_FOOT';
      const id = `missing-tin-${tag.id}`;
      issues.push({
        id,
        severity: isYardTrackTag ? 'WARNING' : 'INFO',
        category: 'TIN',
        title: `RFID Tag ${tag.tagId} missing TIN assignment`,
        description: `Tag ${tag.tagId} at chainage ${tag.chainageM}m (${tag.line}) has no Track Identification Number (TIN).`,
        affectedEntityId: tag.tagId,
        ruleReference: 'RDSO SPN-196 §3.1 TIN Demarcation',
        suggestedFix: 'Assign the enclosing track circuit / block section TIN in Extracted Data.',
        resolved: existingResolutions[id]?.resolved ?? false,
        resolvedNote: existingResolutions[id]?.resolvedNote,
      });
    }
    if (tag.confidence === 'LOW' && !tag.verified) {
      const id = `low-conf-tag-${tag.id}`;
      issues.push({
        id,
        severity: 'WARNING',
        category: 'AMBIGUITY',
        title: `Low-confidence reading of Tag ${tag.tagId}`,
        description: `Extracted Tag ${tag.tagId} (${tag.line}, ${tag.chainageM}m) requires visual confirmation against the CAD drawing.${tag.notes ? ` Note: ${tag.notes}` : ''}`,
        affectedEntityId: tag.tagId,
        ruleReference: 'Signalling Engineer Review Gate',
        suggestedFix: 'Confirm Tag ID, TIN, and chainage on CAD layout and mark Verified.',
        resolved: existingResolutions[id]?.resolved ?? false,
        resolvedNote: existingResolutions[id]?.resolvedNote,
      });
    }
  }

  // 3. Signal Foot Tag & Confidence Checks
  for (const sig of project.signals) {
    const sigTypeLower = sig.signalType.toLowerCase();
    const isExternalOrAuxiliary =
      sigTypeLower.includes('adjacent') ||
      sigTypeLower.includes('shunt') ||
      sigTypeLower.includes('calling') ||
      sigTypeLower.includes('gate') ||
      sig.name.toLowerCase().includes(' of ');

    if (isPlaceholder(sig.footTagId)) {
      if (!isExternalOrAuxiliary) {
        const id = `missing-foot-${sig.id}`;
        issues.push({
          id,
          severity: 'WARNING',
          category: 'RFID',
          title: `Signal ${sig.name} has no Entry Signal Foot Tag`,
          description: `Signal ${sig.name} on ${sig.line} (Ch. ${sig.chainageM}m) is missing a mapped RFID Foot Tag.`,
          affectedEntityId: sig.name,
          ruleReference: 'RDSO KAVACH TOC §5.1 Signal Foot Tag',
          suggestedFix: 'Link the closest RFID tag at the foot of this signal.',
          resolved: existingResolutions[id]?.resolved ?? false,
          resolvedNote: existingResolutions[id]?.resolvedNote,
        });
      }
    } else {
      const footNorm = normalizeTagKey(sig.footTagId);
      if (project.tags.length > 0 && !tagByNormalizedKey.has(footNorm) && !isExternalOrAuxiliary) {
        const id = `unknown-foot-${sig.id}`;
        issues.push({
          id,
          severity: 'WARNING',
          category: 'RFID',
          title: `Foot Tag ${sig.footTagId} for ${sig.name} not found in tag inventory`,
          description: `Signal ${sig.name} references Foot Tag ${sig.footTagId}, which is absent from the parsed RFID tag table.`,
          affectedEntityId: sig.name,
          ruleReference: 'Cross-Table Referential Integrity',
          suggestedFix: `Add ${sig.footTagId} to the RFID tag inventory or update ${sig.name}.`,
          resolved: existingResolutions[id]?.resolved ?? false,
          resolvedNote: existingResolutions[id]?.resolvedNote,
        });
      }
    }

    if (sig.confidence === 'LOW' && !sig.verified) {
      const id = `low-conf-sig-${sig.id}`;
      issues.push({
        id,
        severity: 'WARNING',
        category: 'AMBIGUITY',
        title: `Low-confidence reading of Signal ${sig.name}`,
        description: `Signal ${sig.name} (${sig.signalType}) has uncertain CAD annotation.${sig.notes ? ` Note: ${sig.notes}` : ''}`,
        affectedEntityId: sig.name,
        ruleReference: 'Signalling Engineer Review Gate',
        suggestedFix: 'Verify signal aspect & chainage against CAD layout.',
        resolved: existingResolutions[id]?.resolved ?? false,
        resolvedNote: existingResolutions[id]?.resolvedNote,
      });
    }
  }

  // 4. Route-level deterministic engineering checks
  for (const route of project.routes) {
    // 4a. Point Normal/Reverse mutual exclusion check
    const normalSet = new Set(
      route.pointsNormal.map((p) => p.replace(/[^0-9A-Za-z]/g, '').toUpperCase()).filter(Boolean)
    );
    const reverseSet = new Set(
      route.pointsReverse.map((p) => p.replace(/[^0-9A-Za-z]/g, '').toUpperCase()).filter(Boolean)
    );
    for (const pt of normalSet) {
      if (reverseSet.has(pt)) {
        const id = `point-conflict-r${route.slNo}-${pt}`;
        issues.push({
          id,
          severity: 'ERROR',
          category: 'CONNECTIVITY',
          title: `Conflicting point state on Route #${route.slNo} (${route.entrySignal} -> ${route.exitSignal})`,
          description: `Point ${pt} is listed in both Normal and Reverse columns for the same route.`,
          affectedRouteSlNo: route.slNo,
          ruleReference: 'IRSEM Interlocking Mutual Exclusion',
          suggestedFix: `Remove Point ${pt} from either Normal or Reverse.`,
          resolved: existingResolutions[id]?.resolved ?? false,
          resolvedNote: existingResolutions[id]?.resolvedNote,
        });
      }
    }

    // 4b. Linking distance sum vs Signal-to-Signal distance check
    if (route.linkingSequence.length > 0 && route.distanceBetweenSignalsM > 0) {
      const linkingSum = route.linkingSequence.reduce((acc, item) => acc + (Number(item.distanceM) || 0), 0);
      if (linkingSum > 0) {
        const delta = Math.abs(linkingSum - route.distanceBetweenSignalsM);
        if (delta > 15) {
          const id = `linking-sum-r${route.slNo}`;
          issues.push({
            id,
            severity: delta > 30 ? 'ERROR' : 'WARNING',
            category: 'CHAINAGE',
            title: `Linking distance mismatch on Route #${route.slNo} (${route.entrySignal} -> ${route.exitSignal})`,
            description: `Sum of RFID linking intervals is ${linkingSum}m, which differs by ${delta}m from stated signal spacing (${route.distanceBetweenSignalsM}m).`,
            affectedRouteSlNo: route.slNo,
            ruleReference: 'RDSO SPN-196 §6.3 RFID Linking Sum Check',
            suggestedFix: 'Adjust linking segment distances or update signal chainage spacing in TOC Output.',
            resolved: existingResolutions[id]?.resolved ?? false,
            resolvedNote: existingResolutions[id]?.resolvedNote,
          });
        }
      }
    }

    // 4c. PSR total length vs route distance check
    if (route.psrSegments.length > 0 && route.distanceBetweenSignalsM > 0) {
      const psrSum = route.psrSegments.reduce((acc, seg) => acc + (Number(seg.lengthM) || 0), 0);
      if (psrSum > 0) {
        const psrDelta = Math.abs(psrSum - route.distanceBetweenSignalsM);
        if (psrDelta > 25) {
          const id = `psr-length-r${route.slNo}`;
          issues.push({
            id,
            severity: 'WARNING',
            category: 'CHAINAGE',
            title: `PSR profile length differs from TOC signal distance on Route #${route.slNo}`,
            description: `Speed Restriction segments sum to ${psrSum}m while Selection Table Distance between ${route.entrySignal} and ${route.exitSignal} is ${route.distanceBetweenSignalsM}m (delta ${psrDelta}m).`,
            affectedRouteSlNo: route.slNo,
            ruleReference: 'Gradient / Speed Profile Alignment',
            suggestedFix: 'Verify whether PSR includes overlap beyond exit signal.',
            resolved: existingResolutions[id]?.resolved ?? false,
            resolvedNote: existingResolutions[id]?.resolvedNote,
          });
        }
      }
    }

    // 4d. Home / Routing route entering Loop without Reverse point
    const isEnteringLoop =
      route.leadingToLine.toLowerCase().includes('loop') &&
      (route.signalType.toLowerCase().includes('home') || route.signalType.toLowerCase().includes('routing'));
    if (isEnteringLoop && route.pointsReverse.length === 0 && route.pointsNormal.length > 0) {
      const id = `loop-reverse-r${route.slNo}`;
      issues.push({
        id,
        severity: 'WARNING',
        category: 'CONNECTIVITY',
        title: `Loop reception Route #${route.slNo} (${route.entrySignal} -> ${route.exitSignal}) has no Reverse point`,
        description: `Reception route leads into ${route.leadingToLine} but lists no turnout point in Reverse position.`,
        affectedRouteSlNo: route.slNo,
        ruleReference: 'SIP Turnout Routing Consistency',
        suggestedFix: 'Confirm crossover point setting for loop reception.',
        resolved: existingResolutions[id]?.resolved ?? false,
        resolvedNote: existingResolutions[id]?.resolvedNote,
      });
    }

    // 4e. Route explicitly flagged NEEDS_REVIEW with missing critical parameters
    if (route.engineerStatus === 'NEEDS_REVIEW') {
      const isMissingCritical =
        isPlaceholder(route.entryFootTag) ||
        route.linkingSequence.length === 0 ||
        route.distanceBetweenSignalsM <= 0;

      const id = `route-review-r${route.slNo}`;
      issues.push({
        id,
        severity: isMissingCritical ? 'WARNING' : 'INFO',
        category: 'AMBIGUITY',
        title: `Route #${route.slNo} (${route.entrySignal} -> ${route.exitSignal}) verification check`,
        description:
          route.sourceNotes ||
          `Route #${route.slNo} path parameters synthesized from CAD layout.`,
        affectedRouteSlNo: route.slNo,
        ruleReference: 'Signalling Engineer Review Gate',
        suggestedFix: 'Confirm signal interlocking and RFID linking sequence in TOC Output.',
        resolved: existingResolutions[id]?.resolved ?? false,
        resolvedNote: existingResolutions[id]?.resolvedNote,
      });
    }

    // 4f. Cross-check Entry/Exit signal chainage if both signals exist in inventory
    const entrySig = signalByName.get(route.entrySignal.trim().toUpperCase());
    const exitSig = signalByName.get(route.exitSignal.trim().toUpperCase());
    if (entrySig && exitSig && Number.isFinite(entrySig.chainageM) && Number.isFinite(exitSig.chainageM)) {
      const calcDist = Math.round(Math.abs(exitSig.chainageM - entrySig.chainageM));
      const diff = Math.abs(calcDist - route.distanceBetweenSignalsM);
      if (calcDist > 0 && route.distanceBetweenSignalsM > 0 && diff > 35) {
        const id = `sig-chainage-r${route.slNo}`;
        issues.push({
          id,
          severity: 'INFO',
          category: 'CHAINAGE',
          title: `Chainage delta notice on Route #${route.slNo}`,
          description: `Signal inventory chainages give |${exitSig.chainageM} - ${entrySig.chainageM}| = ${calcDist}m vs stated ${route.distanceBetweenSignalsM}m.`,
          affectedRouteSlNo: route.slNo,
          ruleReference: 'Chainage Coordinate Consistency',
          suggestedFix: 'Confirm curved track / crossover allowance vs linear chainage.',
          resolved: existingResolutions[id]?.resolved ?? false,
          resolvedNote: existingResolutions[id]?.resolvedNote,
        });
      }
    }
  }

  // 5. Block Section Handover Check (advisory INFO if absent from station yard CAD)
  if (!isAutoSectionOnly && project.blockSections.length === 0 && project.routes.length > 0) {
    const id = 'missing-block-section';
    issues.push({
      id,
      severity: 'INFO',
      category: 'DIRECTION',
      title: 'Block Section Handover table not explicitly present in CAD layout',
      description: 'Adjacent station handover TINs were not listed separately on this CAD drawing.',
      ruleReference: 'RDSO KAVACH §7 Adjacent Station Interface',
      suggestedFix: 'Verify adjacent station border tags and block section TINs before commissioning.',
      resolved: existingResolutions[id]?.resolved ?? false,
      resolvedNote: existingResolutions[id]?.resolvedNote,
    });
  }

  return issues;
}

/**
 * Helper to recalculate a route's linking sequence from the RFID Tag inventory
 * when an engineer edits tag chainages or requests route auto-linking.
 */
export function recomputeRouteFromTags(
  route: TocRouteRow,
  tags: RfidTag[],
  signals: SignalNode[]
): TocRouteRow {
  const entrySig = signals.find((s) => s.name === route.entrySignal);
  const exitSig = signals.find((s) => s.name === route.exitSignal);
  if (!entrySig || !exitSig) return route;

  const minCh = Math.min(entrySig.chainageM, exitSig.chainageM);
  const maxCh = Math.max(entrySig.chainageM, exitSig.chainageM);
  const increasing = exitSig.chainageM >= entrySig.chainageM;

  const candidateTags = tags
    .filter((t) => {
      if (t.chainageM < minCh - 2 || t.chainageM > maxCh + 2) return false;
      if (normalizeTagKey(t.tagId) === normalizeTagKey(entrySig.footTagId)) return false;
      if (route.tinsRequiresFree.length > 0 && t.tin) {
        return route.tinsRequiresFree.includes(t.tin) || normalizeTagKey(t.tagId) === normalizeTagKey(exitSig.footTagId);
      }
      return true;
    })
    .sort((a, b) => (increasing ? a.chainageM - b.chainageM : b.chainageM - a.chainageM));

  if (candidateTags.length === 0) return route;

  let prevCh = entrySig.chainageM;
  const linkingSequence = candidateTags.map((t) => {
    const dist = Math.round(Math.abs(t.chainageM - prevCh));
    prevCh = t.chainageM;
    return { distanceM: dist, tagId: t.tagId };
  });

  return {
    ...route,
    entryFootTag: entrySig.footTagId || route.entryFootTag,
    linkingSequence,
    enRouteTags: candidateTags.map((t) => t.tagId),
    distanceBetweenSignalsM: Math.round(Math.abs(exitSig.chainageM - entrySig.chainageM)),
  };
}
