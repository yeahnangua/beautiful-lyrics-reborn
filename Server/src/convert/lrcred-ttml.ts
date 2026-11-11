import { DOMParser, type Element, type Node } from "@xmldom/xmldom";
import { parseTtmlTime } from "./ttml";
import type { BeautifulLyrics, LineVocal, SyllableMetadata, SyllableVocal, SyllableVocalSet } from "../types";

const metadataNamespace = "http://www.w3.org/ns/ttml#metadata";
const lrcNamespace = "http://lrc.red/lyric-ttml-internal";
const role = (element: Element) => element.getAttributeNS(metadataNamespace, "role") ?? element.getAttribute("ttm:role");
const omittedRole = (element: Element) => ["x-translation", "x-roman", "x-bg"].includes(role(element) ?? "");
const isElement = (node: Node): node is Element => node.nodeType === 1;
const cleanText = (text: string) => text.replace(/\s+/gu, " ").trim();

function interval(element: Element) {
  const start = parseTtmlTime(element.getAttribute("begin") ?? undefined);
  const end = parseTtmlTime(element.getAttribute("end") ?? undefined);
  return start !== undefined && end !== undefined && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start
    ? { StartTime: start, EndTime: end } : undefined;
}

function plainText(node: Node, root = true): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? "";
  if (isElement(node) && !root && omittedRole(node)) return "";
  if (isElement(node) && node.localName === "br") return "\n";
  return Array.from(node.childNodes).map(child => plainText(child, false)).join("");
}

function wordVocal(element: Element): SyllableVocal | undefined {
  type TimedText = { text: string; owner: Element } & NonNullable<ReturnType<typeof interval>>;
  const parts: TimedText[] = [];
  let prefix = "";
  const appendText = (text: string, owner?: Element, timing?: ReturnType<typeof interval>) => {
    const last = parts.at(-1);
    if (timing && owner && text.trim()) {
      if (last?.owner === owner) last.text += text;
      else { parts.push({ text: prefix + text, owner, ...timing }); prefix = ""; }
    } else if (last) last.text += text;
    else prefix += text;
  };
  const visit = (node: Node, owner?: Element, timing?: ReturnType<typeof interval>) => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      appendText(node.nodeValue ?? "", owner, timing);
      return;
    }
    if (isElement(node)) {
      if (node !== element && omittedRole(node)) return;
      if (node.localName === "br") { appendText(" "); return; }
      if (node.localName === "span" && (node.hasAttribute("begin") || node.hasAttribute("end"))) {
        timing = interval(node);
        if (!timing) return;
        owner = node;
      }
    }
    for (const child of Array.from(node.childNodes)) visit(child, owner, timing);
  };
  visit(element);
  if (!parts.length) return undefined;
  const syllables: SyllableMetadata[] = parts.map((part, index) => ({
    Text: cleanText(part.text), StartTime: part.StartTime, EndTime: part.EndTime,
    IsPartOfWord: index < parts.length - 1 && !/\s$/u.test(part.text) && !/^\s/u.test(parts[index + 1]!.text)
  }));
  return {
    StartTime: Math.min(...syllables.map(part => part.StartTime)),
    EndTime: Math.max(...syllables.map(part => part.EndTime)), Syllables: syllables
  };
}

function lineVocal(element: Element): SyllableVocal | undefined {
  const timing = interval(element), Text = cleanText(plainText(element));
  return timing && Text ? { ...timing, Syllables: [{ ...timing, Text, IsPartOfWord: false }] } : undefined;
}

function backgroundElements(element: Element): Element[] {
  const result: Element[] = [];
  const visit = (node: Node) => {
    if (!isElement(node)) return;
    if (role(node) === "x-bg") { result.push(node); return; }
    if (omittedRole(node)) return;
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  for (const child of Array.from(element.childNodes)) visit(child);
  return result;
}

/** lrc.red TTML preserves spaces between spans, background vocals and true sync type. */
export function convertLrcRedTtml(ttml: string): BeautifulLyrics | undefined {
  if (!ttml.trim() || ttml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(ttml)) return undefined;
  try {
    // Parse errors stay in the provider's structured diagnostics, never in per-song console output.
    const document = new DOMParser({ onError: () => { throw new Error("Invalid TTML"); } })
      .parseFromString(ttml, "application/xml");
    const root = document.documentElement;
    if (!root || root.localName !== "tt") return undefined;
    const body = root.getElementsByTagNameNS("*", "body").item(0);
    if (!body) return undefined;
    const hint = (root.getAttributeNS(lrcNamespace, "timing") ?? root.getAttribute("lrc:timing") ?? "").toLowerCase();
    const paragraphs = Array.from(body.getElementsByTagNameNS("*", "p"));
    if (hint === "none") {
      const Lines = paragraphs.map(p => ({ Text: cleanText(plainText(p)) })).filter(line => line.Text);
      return Lines.length ? { Type: "Static", Lines } : undefined;
    }
    const agents: string[] = [];
    let hasWordTiming = false;
    const groups: SyllableVocalSet[] = [];
    const lines: LineVocal[] = [];
    for (const p of paragraphs) {
      const timed = wordVocal(p), lead = timed ?? lineVocal(p);
      if (!lead) continue;
      const agent = p.getAttributeNS(metadataNamespace, "agent") ?? p.getAttribute("ttm:agent") ?? "";
      if (!agents.includes(agent)) agents.push(agent);
      const OppositeAligned = agents.indexOf(agent) % 2 === 1;
      const backgrounds = backgroundElements(p).flatMap(bg => {
        const words = wordVocal(bg);
        if (words) hasWordTiming = true;
        const vocal = words ?? lineVocal(bg);
        return vocal ? [vocal] : [];
      });
      if (timed) hasWordTiming = true;
      groups.push({ Type: "Vocal", OppositeAligned, Lead: lead,
        ...(backgrounds.length ? { Background: backgrounds } : {}) });
      lines.push({ Type: "Vocal", OppositeAligned, Text: cleanText(plainText(p)), ...(interval(p) ?? {
        StartTime: lead.StartTime, EndTime: lead.EndTime
      }) });
    }
    if (!groups.length) return undefined;
    if (hasWordTiming && hint !== "line") {
      const vocals = groups.flatMap(group => [group.Lead, ...(group.Background ?? [])]);
      return { Type: "Syllable", StartTime: Math.min(...vocals.map(vocal => vocal.StartTime)),
        EndTime: Math.max(...vocals.map(vocal => vocal.EndTime)), Content: groups };
    }
    return { Type: "Line", StartTime: Math.min(...lines.map(line => line.StartTime)),
      EndTime: Math.max(...lines.map(line => line.EndTime)), Content: lines };
  } catch { return undefined; }
}
