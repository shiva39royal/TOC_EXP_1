import type { LayoutToken, Phrase } from "@/engine/offlineExtractor";
import type { StationMetadata } from "@/types/signalling";

export interface MetadataExtractionInput {
  fileName: string;
  tokens: LayoutToken[];
  phrases?: Phrase[];
}

/** Generic corporate, organizational, and agency structural designators */
export const CORPORATE_STRUCTURAL_TOKENS = new Set([
  "LTD",
  "PVT",
  "LIMITED",
  "PRIVATE",
  "CORP",
  "CORPORATION",
  "INC",
  "LLC",
  "ENTERPRISES",
  "SOLUTIONS",
  "ENGINEERING",
  "SERVICES",
  "CONSULTANT",
  "CONSULTANTS",
  "CONSULTANCY",
  "PROJECT",
  "MANAGER",
]);

/** Backward-compatibility alias so existing imports continue to compile */
export const CORPORATE_VENDOR_BLACKLIST = CORPORATE_STRUCTURAL_TOKENS;

/** Drawing label and title-block structural keywords that must never be extracted as station names */
export const DRAWING_LABEL_TOKENS = new Set([
  "SCALE",
  "NTS",
  "DRAWING",
  "DRG",
  "REVISION",
  "REV",
  "SHEET",
  "SHEETS",
  "TITLE",
  "DATE",
  "SIGN",
  "SIGNATURE",
  "PREPARED",
  "CHECKED",
  "APPROVED",
  "VERIFIED",
  "RECOMMENDED",
  "SUBMITTED",
  "CLIENT",
  "CONTRACTOR",
  "RAILWAY",
  "DIVISION",
  "ZONE",
  "SECTION",
  "DETAILS",
  "SPECIFICATION",
  "GENERAL",
  "NOTES",
  "SIP",
  "ESP",
  "TOC",
  "TCAS",
  "KAVACH",
]);

export function isNonStationToken(token: string): boolean {
  const upperToken = token.trim().toUpperCase();
  return (
    CORPORATE_STRUCTURAL_TOKENS.has(upperToken) ||
    DRAWING_LABEL_TOKENS.has(upperToken) ||
    NON_STATION_ACRONYMS.has(upperToken)
  );
}

export const NON_STATION_ACRONYMS = new Set([
  "UP",
  "DN",
  "DOWN",
  "LC",
  "RFID",
  "TIN",
  "TOC",
  "SIP",
  "ESP",
  "SCR",
  "ECR",
  "NR",
  "NCR",
  "WR",
  "WCR",
  "SR",
  "SWR",
  "ER",
  "SER",
  "SECR",
  "ECOR",
  "NFR",
  "NWR",
  "CR",
  "KAVACH",
  "TCAS",
  "SIL",
  "DRG",
  "REV",
  "ALT",
  "NO",
  "ID",
  "BG",
  "SG",
  "MG",
  "AC",
  "DC",
  "MPS",
  "SPL",
  "PSR",
  "MA",
  "SR",
  "OS",
  "SHEET",
  "SHEETS",
  "SIGN",
  "SIGNAL",
  "STATION",
  "DIVISION",
  "RAILWAY",
]);

function upper(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, " ").trim();
}

function words(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]+/g, " ").trim();
}

function unitHeight(texts: LayoutToken[]): number {
  const heights = texts.map((t) => t.height || 0).filter((h) => h > 0);
  if (heights.length === 0) return 8;
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] || 8;
}

function assemblePhrases(texts: LayoutToken[], h: number): Phrase[] {
  const horizontal = texts.filter((t) => !t.vertical && Boolean(t.text?.trim()));
  const sorted = horizontal.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const phrases: Phrase[] = [];

  for (const token of sorted) {
    const raw = token.text.trim();
    if (!raw) continue;
    const last = phrases[phrases.length - 1];
    const glyphW = (token.width || raw.length * h * 0.6) / raw.length;

    if (
      last &&
      last.page === token.page &&
      Math.abs(last.y - token.y) <= 0.45 * h &&
      token.x - last.x1 >= -0.2 * glyphW &&
      token.x - last.x1 <= 2.2 * glyphW
    ) {
      last.text = `${last.text} ${raw}`;
      last.x1 = token.x + (token.width || raw.length * glyphW);
      last.width = last.x1 - last.x;
      last.height = Math.max(last.height, token.height || h);
      if (last.tokens) {
        last.tokens.push(token);
      } else {
        last.tokens = [token];
      }
    } else {
      const width = token.width || raw.length * glyphW;
      phrases.push({
        text: raw,
        page: token.page,
        x: token.x,
        y: token.y,
        x0: token.x,
        x1: token.x + width,
        width,
        height: token.height || h,
        confidence: token.confidence ?? 100,
        tokens: [token],
      });
    }
  }

  return phrases;
}

/**
 * Universal Indian Railways Title Block & Station Metadata Extractor
 * Strictly station-independent: dynamically parses Station Name, Station Code,
 * Station ID, Division, Section, Zone, and Reference Document details.
 */
export function extractStationMetadata(input: MetadataExtractionInput): StationMetadata {
  const { fileName, tokens } = input;
  const texts = tokens.filter((t) => !t.kind || t.kind === "text");
  const h = unitHeight(texts);
  const phrases =
    input.phrases && input.phrases.length > 0 ? input.phrases : assemblePhrases(texts, h);

  const ordered = phrases.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const allText = ordered.map((p) => p.text).join(" | ");

  const baseFileName = fileName
    .replace(/\.(?:pdf|dwg|dxf)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(
      /\b(?:RFID|TAG|TIN|LAYOUT|KAVACH|TCAS|SIL[-\s]?\d*|DRAWING|DRG|TOC|TABLE|OF|CONTROL|PLAN)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  const fileKeywords = new Set(
    upper(baseFileName)
      .split(/[^A-Z0-9]+/)
      .filter((w) => w.length > 2),
  );

  let stationName = "";
  let stationCode = "";
  let stationId = "";
  let division = "";
  let section = "";
  let railwayZone = "";
  let nextDownStationId = "";
  let nextUpStationId = "";

  // 1A. Prominent Station Heading directly above Station ID
  // e.g. "[STATION NAME] Jn. | Station ID : 01014" or "[STATION NAME] | Station ID : 520"
  // Allow optional pipe delimiter between ID label and digits, and allow parentheses after digits
  const headerAboveId = allText.match(
    /\b([A-Z][A-Z\s.-]{2,35}?(?:\s*(?:Jn\.?|Junction|Cabin|Station|Yard))?)\s*(?:[|\n\r]+)?\s*(?:STATION|STN)\s*ID\s*[:.\-=~]?\s*(?:\|\s*)?([0-9O]{3,6})(?:\s*\(|\s*\[|\s*$|\s*[,\s|])/i,
  );
  if (headerAboveId && headerAboveId[1]) {
    const rawCand = headerAboveId[1].trim();
    const candUpper = rawCand.toUpperCase();
    const candWords = candUpper.split(/[^A-Z0-9]+/).filter(Boolean);
    const hasBlacklist = candWords.some((w) => isNonStationToken(w));
    const isGenericDrawing =
      /^(?:SCALE|NOT TO SCALE|NTS|SIP|SIGNAL INTERLOCKING PLAN|DRAWING|DRG|DETAILS)$/i.test(
        candUpper,
      );

    if (!hasBlacklist && !isGenericDrawing && !/^(?:NEXT|DN|UP|DOWN)\b/i.test(candUpper)) {
      let resolvedName = candUpper;
      const ORPHAN_SUFFIXES = /^(?:JN\.?|JUNCTION|CABIN|STATION|STN|YARD)$/i;
      if (ORPHAN_SUFFIXES.test(resolvedName) || resolvedName.length <= 3) {
        const matchIdx = headerAboveId.index ?? 0;
        const preText = allText.slice(0, matchIdx);
        const preWordMatch = preText.match(/\b([A-Z]{3,30})\s*(?:\|\s*)?$/i);
        if (
          preWordMatch &&
          !isNonStationToken(preWordMatch[1]!)
        ) {
          resolvedName = `${preWordMatch[1]!.toUpperCase()} ${resolvedName}`;
        } else {
          const fileBase = Array.from(fileKeywords).find(
            (w) => !ORPHAN_SUFFIXES.test(w) && w.length >= 4,
          );
          if (fileBase) {
            resolvedName = `${fileBase} ${resolvedName}`;
          }
        }
      }
      stationName = resolvedName.replace(/\s+/g, " ").trim();
      if (headerAboveId[2]) {
        stationId = headerAboveId[2].replace(/O/gi, "0");
      }
    } else if (headerAboveId[2]) {
      stationId = headerAboveId[2].replace(/O/gi, "0");
    }
  }

  // 1A-2: 2D Spatial Extraction from prominent "STATION ID" anchor token
  const idAnchorPhrase = phrases.find((p) => /\b(?:STATION|STAION|STN)\s*ID\b/i.test(p.text));
  if (idAnchorPhrase) {
    // 1. Extract station ID from the anchor phrase or immediately following token
    if (!stationId) {
      const inlineId = idAnchorPhrase.text.match(
        /\b(?:STATION|STAION|STN)\s*ID\s*[:.\-=~]?\s*([0-9O]{3,6})/i,
      );
      if (inlineId && inlineId[1]) {
        stationId = inlineId[1].replace(/O/gi, "0");
      } else {
        const nextIdToken = texts
          .filter(
            (t) =>
              t.page === idAnchorPhrase.page &&
              Math.abs(t.y - idAnchorPhrase.y) <= 0.8 * h &&
              t.x >= idAnchorPhrase.x &&
              t.x - idAnchorPhrase.x1 <= 15.0 * h,
          )
          .sort((a, b) => a.x - b.x)[0];
        if (nextIdToken) {
          const m = upper(nextIdToken.text).match(/^[:.\-=~]?\s*([0-9O]{3,6})/);
          if (m && m[1]) {
            stationId = m[1].replace(/O/gi, "0");
          }
        }
      }
    }

    // 2. Discover Station Heading situated vertically directly ABOVE the Station ID anchor
    const candidateAboveTokens = texts.filter(
      (t) =>
        t.page === idAnchorPhrase.page &&
        idAnchorPhrase.y - t.y >= 0.4 * h &&
        idAnchorPhrase.y - t.y <= 12.0 * h &&
        Math.abs(t.x - idAnchorPhrase.x) <= 30.0 * h &&
        !/^(?:SCALE|NTS|DRG|SIP|DRAWING|REV|DATE)$/i.test(t.text.trim()),
    );

    if (candidateAboveTokens.length > 0) {
      // Find highest/largest heading line
      const maxHeight = Math.max(...candidateAboveTokens.map((t) => t.height || h));
      const headingTokens = candidateAboveTokens
        .filter((t) => (t.height || h) >= maxHeight * 0.75)
        .sort((a, b) => a.y - b.y || a.x - b.x);

      // Group into lines by y
      if (headingTokens.length > 0) {
        const lineY = headingTokens[0]!.y;
        const lineTokens = headingTokens
          .filter((t) => Math.abs(t.y - lineY) <= 0.6 * h)
          .sort((a, b) => a.x - b.x);
        const headingText = lineTokens
          .map((t) => t.text.trim())
          .join(" ")
          .toUpperCase()
          .replace(/\s+/g, " ")
          .trim();
        const wordsInHeading = headingText.split(/[^A-Z0-9]+/).filter(Boolean);
        const hasBlacklist = wordsInHeading.some((w) => isNonStationToken(w));
        if (!hasBlacklist && wordsInHeading.length > 0) {
          let resolved = headingText;

          // If heading text is purely an acronym in parentheses e.g. "(CTF)", it's the station code, not name
          const pureCodeMatch = resolved.match(/^[[(]([A-Z0-9]{2,5})[)\]]$/);
          if (pureCodeMatch) {
            if (!stationCode && !isNonStationToken(pureCodeMatch[1]!)) {
              stationCode = pureCodeMatch[1]!;
            }
            resolved = "";
          } else {
            // If heading is "STATION_NAME (CODE)", separate them cleanly
            const nameAndCodeMatch = resolved.match(/^([A-Z0-9\s.]{2,40}?)\s*[[(]([A-Z0-9]{2,5})[)\]]$/);
            if (nameAndCodeMatch) {
              resolved = nameAndCodeMatch[1]!.trim();
              if (!stationCode && !isNonStationToken(nameAndCodeMatch[2]!)) {
                stationCode = nameAndCodeMatch[2]!;
              }
            }
          }

          const ORPHAN_SUFFIXES = /^(?:JN\.?|JUNCTION|CABIN|STATION|STN|YARD)$/i;
          if (resolved && (ORPHAN_SUFFIXES.test(resolved) || resolved.length <= 3)) {
            const fileBase = Array.from(fileKeywords).find(
              (w) => !ORPHAN_SUFFIXES.test(w) && w.length >= 4,
            );
            if (fileBase) resolved = `${fileBase} ${resolved}`;
          }
          if (resolved && (!stationName || ORPHAN_SUFFIXES.test(stationName) || stationName.length <= 3)) {
            stationName = resolved.replace(/\s+/g, " ").trim();
          }
        }
      }
    }
  }

  // 1B. Explicit Labeled Search for Station Name and Code
  // Pattern: "STATION NAME: <NAME> (<CODE>)" or "STATION: <NAME> (<CODE>)"
  const explicitNamePatterns = [
    /(?:STATION\s*NAME|NAME\s*OF\s*STATION)\s*[:=-]?\s*([A-Z][A-Z\s.]{2,40}?)(?:\s*\(\s*([A-Z]{2,5})\s*\))?(?:\s*\||$)/i,
    /\b(?:STATION|STN)\s*[:=-]\s*([A-Z][A-Z\s.]{2,40}?)(?:\s*\(\s*([A-Z]{2,5})\s*\))?(?:\s*\||$)/i,
    /SECTION\s*[:=-]\s*.*?(?:LC[-\s]*\d+\s*[-–—]\s*)?([A-Z][A-Z\s.]{2,25})\s*\(\s*([A-Z]{2,5})\s*\)/i,
  ];

  if (!stationName) {
    for (const pat of explicitNamePatterns) {
      const m = allText.match(pat);
      if (m && m[1]) {
        // Reject if matched string is part of "NEXT UP/DN STATION"
        if (
          /\bNEXT\s*(?:UP|DN|DOWN)\b/i.test(
            allText.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 10),
          )
        ) {
          continue;
        }

        const candName = m[1].trim().toUpperCase();
        const candCode = m[2]?.toUpperCase() ?? "";
        const isBlacklisted = candName
          .split(/[^A-Z]+/)
          .some((w) => isNonStationToken(w));
        if (!isBlacklisted && candName.length >= 3) {
          stationName = candName;
          if (
            candCode &&
            !isNonStationToken(candCode)
          ) {
            stationCode = candCode;
          }
          break;
        }
      }
    }
  }

  // 2. Candidate Phrase Search: "NAME (CODE)" with exclusion blacklist
  if (!stationName) {
    let bestScore = -1;
    for (const phrase of phrases) {
      const match = upper(phrase.text).match(/^([A-Z][A-Z .]{2,40}?)\s*\(\s*([A-Z]{2,5})\s*\)$/);
      if (!match) continue;

      const candCode = match[2]!;
      const candName = match[1]!.trim();

      // Skip vendor / non-station acronyms
      if (isNonStationToken(candCode)) continue;
      const nameWords = candName.split(/[^A-Z]+/);
      if (nameWords.some((w) => isNonStationToken(w))) continue;

      const fileMatchScore = nameWords.filter((w) => fileKeywords.has(w)).length * 3;
      const heightScore = phrase.height / h;
      const totalScore = heightScore + fileMatchScore;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        stationName = candName;
        stationCode = candCode;
      }
    }
  }

  // 3. Prevent Orphan Suffixes (e.g. "JN.", "JN", "CABIN", "YARD") from being the whole station name
  const ORPHAN_SUFFIXES = /^(?:JN\.?|JUNCTION|CABIN|STATION|STN|YARD)$/i;
  if (ORPHAN_SUFFIXES.test(stationName) || (stationName && stationName.length <= 3)) {
    const fileBase = Array.from(fileKeywords).find(
      (w) => !ORPHAN_SUFFIXES.test(w) && w.length >= 4,
    );
    if (fileBase) {
      stationName = `${fileBase} ${stationName}`.replace(/\s+/g, " ").trim();
    } else {
      const m = allText.match(/\b([A-Z]{3,30})\s*(?:\|\s*)?(?:JN\.?|JUNCTION|CABIN)\b/i);
      if (
        m &&
        !isNonStationToken(m[1]!)
      ) {
        stationName = `${m[1]!.toUpperCase()} ${stationName}`.replace(/\s+/g, " ").trim();
      } else {
        // Look in 2D space for word immediately to the left on the same line
        const orphanToken = texts.find((t) => ORPHAN_SUFFIXES.test(t.text.trim().toUpperCase()));
        if (orphanToken) {
          const leftWord = texts
            .filter(
              (t) =>
                t.page === orphanToken.page &&
                Math.abs(t.y - orphanToken.y) <= 0.8 * h &&
                t.x < orphanToken.x &&
                orphanToken.x - t.x <= 35.0 * h &&
                t.text.trim().length >= 3,
            )
            .sort((a, b) => b.x - a.x)[0];
          if (leftWord && !isNonStationToken(leftWord.text.trim())) {
            stationName = `${leftWord.text.trim().toUpperCase()} ${stationName}`
              .replace(/\s+/g, " ")
              .trim();
          }
        }
      }
    }
  }

  // 4. Fallback to clean filename if no valid station name was found
  if (!stationName) {
    stationName = upper(baseFileName) || "UNKNOWN STATION";
  }

  // 5. Explicit Station Code resolution if code is still empty
  if (!stationCode) {
    const codeMatch = allText.match(
      /(?:STATION|STN)\s*(?:ALPHA\s*)?CODE\s*[:=-]?\s*([A-Z]{2,5})\b/i,
    );
    if (
      codeMatch &&
      !isNonStationToken(codeMatch[1]!)
    ) {
      stationCode = codeMatch[1]!.toUpperCase();
    }
  }

  // 6. Station ID Resolution
  // Prioritize explicit "STATION ID: 47151", "Station ID : 01014(Km.453.850)", or "STN ID: 520"
  if (!stationId) {
    const explicitIdMatches = [
      allText.match(
        /\b(?:STATION|STAION|STN|TCAS|KAVACH)\s*(?:ID|NO\.?)\s*[:.\-=~]?\s*(?:\|\s*)?([0-9O]{3,6})(?:\s*\(|\s*\[|\s*$|\s*[,\s|])/i,
      ),
      allText.match(
        /\b(?:STATION|STAION|STN)\s*NO\.?\s*[:.\-=~]?\s*(?:\|\s*)?([0-9O]{3,6})(?:\s*\(|\s*\[|\s*$|\s*[,\s|])/i,
      ),
      allText.match(/\b(?:STATION|STN)\s*ID\s*[:.\-=~]?\s*(?:\|\s*)?([0-9O]{3,6})/i),
    ];

    for (const m of explicitIdMatches) {
      if (m && m[1]) {
        stationId = m[1].replace(/O/gi, "0");
        break;
      }
    }
  }

  // If station ID not explicitly labelled, inspect allocation tables near station code
  if (!stationId) {
    for (const phrase of phrases) {
      const text = upper(phrase.text);
      if (!/\b(?:STATION|STAION|STN)\s*ID\b/.test(text)) continue;

      const numbers = texts
        .filter(
          (t) =>
            !t.vertical &&
            t.page === phrase.page &&
            Math.abs(t.y - phrase.y) < 0.8 * h &&
            t.x > phrase.x1 &&
            t.x - phrase.x1 < 45 * h &&
            /^\d{2,6}$/.test(upper(t.text)),
        )
        .sort((a, b) => a.x - b.x);

      if (numbers.length > 0) {
        if (numbers.length >= 2) {
          for (const num of numbers) {
            const header = texts
              .filter(
                (t) =>
                  !t.vertical &&
                  t.page === num.page &&
                  num.y - t.y > 0.6 * h &&
                  num.y - t.y < 4 * h &&
                  Math.abs(t.x - num.x) < 3 * h,
              )
              .sort((a, b) => num.y - a.y - (num.y - b.y))[0];

            const headerLabel = header ? words(header.text) : "";
            if (headerLabel === "UP") nextUpStationId ||= upper(num.text);
            else if (headerLabel === "DN" || headerLabel === "DOWN")
              nextDownStationId ||= upper(num.text);
            else if (!stationId && (headerLabel === stationCode || !headerLabel))
              stationId = upper(num.text);
          }
        }
        if (!stationId && numbers[0]) stationId = upper(numbers[0].text);
      }
    }
  }

  // 6. Section Resolution
  const sectionMatch =
    allText.match(
      /\bSECTION\s*[:=-]\s*([A-Z0-9\s()/-]{2,40}?)(?:\s*\||\s*DIVISION|\s*STATION|$)/i,
    ) ||
    allText.match(
      /\b(?:AUTOMATIC|ABSOLUTE)\s+BLOCK\s+SECTION\s*[:=-]?\s*([A-Z0-9\s()/-]{2,40}?)(?:\s*\||$)/i,
    );
  if (sectionMatch && sectionMatch[1]) {
    section = sectionMatch[1].trim().toUpperCase();
  }

  // 7. Division Resolution
  const divMatch =
    allText.match(/\b([A-Z][A-Z\s]{2,30}?)\s+DIVISION\b/i) ||
    allText.match(/\bDIVISION\s*[:=-]\s*([A-Z][A-Z\s]{2,30}?)(?:\s*\||$)/i);
  if (divMatch && divMatch[1]) {
    division = divMatch[1].trim().toUpperCase();
  }

  // 8. Railway Zone Resolution
  const zoneMatch =
    allText.match(/\b([A-Z][A-Z\s]{3,35}?)\s+RAILWAY\b/i) ||
    allText.match(/\bZONE\s*[:=-]\s*([A-Z]{2,6})\b/i);
  if (zoneMatch && zoneMatch[1]) {
    railwayZone = zoneMatch[1].trim().toUpperCase();
  }

  // 9. Document References: SIP, TOC, Layout, Version
  const findRegex = (re: RegExp) =>
    ordered
      .map((p) => upper(p.text).match(re)?.[1])
      .find(Boolean)
      ?.trim() ?? "";

  const refSip =
    findRegex(/\bREF\.?\s*SIP\.?\s*(?:NO\.?)?\s*[:=-]?\s*([A-Z0-9][A-Z0-9./_()-]{3,60})/) ||
    (allText.match(/\b(?:SIP\s*NO\.?|REF\s*SIP)\s*[:=-]?\s*([A-Z0-9./_()-]{3,60})/i)?.[1]?.trim() ??
      "----");

  const refToc =
    findRegex(
      /\bREF\.?\s*(?:TOC|TABLE\s*OF\s*CONTROL)\.?\s*(?:NO\.?)?\s*[:=-]?\s*([A-Z0-9][A-Z0-9./_()-]{2,60})/,
    ) ||
    (allText.match(/\b(?:TOC\s*NO\.?|REF\s*TOC)\s*[:=-]?\s*([A-Z0-9./_()-]{2,60})/i)?.[1]?.trim() ??
      "----");

  const refLayout =
    findRegex(
      /\b((?:KAVACH|TCAS)[_\s]*RFID[_\s]*TAG[_\s]*(?:\/\s*TIN[_\s]*)?LAYOUT[\s_A-Z0-9.-]*)/,
    ) ||
    (allText.match(/\b((?:KAVACH|TCAS)[_\s]*[A-Z0-9_./\s-]*LAYOUT[A-Z0-9_./\s-]*)/i)?.[1]?.trim() ??
      "----");

  const version =
    refLayout.match(/[_\s-](\d+(?:\.\d+)+)$/)?.[1] ||
    findRegex(/\bVER(?:SION)?\.?\s*(?:NO\.?)?\s*[:=-]?\s*([0-9][0-9.]{0,10})\b/) ||
    "1.0.0";

  // 10. Adjacent Station Codes/IDs
  if (!nextDownStationId) {
    const m = allText.match(
      /\bNEXT\s*(?:[|\s]+)?(?:DOWN|DN)\s*(?:[|\s]+)?(?:STATION|STN)?(?:\s*ID)?\s*[:=-]?\s*([A-Z0-9]{2,6})\b/i,
    );
    if (m && !NON_STATION_ACRONYMS.has(m[1]!.toUpperCase())) {
      nextDownStationId = m[1]!.toUpperCase();
    }
  }
  if (!nextUpStationId) {
    const m = allText.match(
      /\bNEXT\s*(?:[|\s]+)?UP\s*(?:[|\s]+)?(?:STATION|STN)?(?:\s*ID)?\s*[:=-]?\s*([A-Z0-9]{2,6})\b/i,
    );
    if (m && !NON_STATION_ACRONYMS.has(m[1]!.toUpperCase())) {
      nextUpStationId = m[1]!.toUpperCase();
    }
  }

  // Also discover "TO <STATION>" / "FROM <STATION>" in drawing extremities
  const boundsX = texts.map((t) => t.x).filter(Number.isFinite);
  if (boundsX.length > 0) {
    const minX = Math.min(...boundsX);
    const maxX = Math.max(...boundsX);
    const midX = (minX + maxX) / 2;

    for (const phrase of phrases) {
      const m = upper(phrase.text).match(
        /\b(?:TO|FROM|TOWARDS)\s+([A-Z][A-Z\s.-]{2,20}?)(?:\s*\(([A-Z]{2,5})\))?(?:\s*END|\s*SIDE|\s*\||$)/,
      );
      if (!m) continue;
      const rawTarget = m[2] || m[1]!;
      const cleanTarget = rawTarget.trim().toUpperCase();
      if (
        cleanTarget === stationCode ||
        cleanTarget === stationName ||
        isNonStationToken(cleanTarget) ||
        /^(?:SCALE|YARD|CABIN|LINE|STATION|UP|DN|DOWN)\b/.test(cleanTarget)
      ) {
        continue;
      }

      if (phrase.x < midX) {
        nextUpStationId ||= cleanTarget;
      } else {
        nextDownStationId ||= cleanTarget;
      }
    }
  }

  // 11. Approval Signatures (JE/SSE/DSTE)
  const valueUnderHeader = (headerRe: RegExp): string => {
    const header = phrases.find((p) => headerRe.test(upper(p.text)));
    if (!header) return "";
    const cand = phrases
      .filter(
        (p) =>
          p.page === header.page &&
          p.y - header.y > 0.8 * h &&
          p.y - header.y < 7 * h &&
          Math.abs(p.x - header.x) < 4 * h,
      )
      .filter(
        (p) =>
          /^[A-Z][A-Z .]{2,35}$/.test(upper(p.text)) &&
          !/\b(?:SIGN|NAME|BY|DATE|APPROVED|CHECKED)\b/.test(upper(p.text)),
      )
      .sort((a, b) => b.y - a.y)[0];
    return cand ? upper(cand.text) : "";
  };

  return {
    stationName,
    stationCode,
    stationId,
    division,
    section,
    railwayZone,
    refSip,
    refLayout,
    refToc,
    version,
    chainageDirection: "UNKNOWN",
    nextDownStationId,
    nextUpStationId,
    preparedBy: valueUnderHeader(/PREPARED\s*BY/) || "JE / SSE / Signal",
    checkedBy: valueUnderHeader(/CHECKED\s*BY/) || "ASTE / DSTE",
    approvedBy: valueUnderHeader(/APPROVED\s*BY/) || "RDSO",
    engineerSignedOff: false,
  };
}
