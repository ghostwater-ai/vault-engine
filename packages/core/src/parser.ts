/**
 * Markdown parser for vault notes.
 *
 * Parses individual vault files into typed VaultDocument objects,
 * extracting YAML frontmatter, body sections, and wiki-links.
 */

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import matter from 'gray-matter';
import type { BodySection, NoteType, VaultDocument } from './types.js';

/**
 * Regex to match [[wiki-links]] in markdown content.
 * Captures the link text between the double brackets.
 */
const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

/**
 * Regex to match # H1 header for title extraction.
 */
const H1_HEADER_REGEX = /^# (.+)$/m;

/**
 * Extracts all wiki-link targets from markdown content.
 * Returns unique link targets with brackets stripped.
 */
function extractWikiLinks(content: string): string[] {
  const links: Set<string> = new Set();
  // Create a new regex each time to avoid stateful global regex issues
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    links.add(match[1]);
  }

  return Array.from(links);
}

/**
 * Strips [[wiki-links]] brackets from content but preserves the linked note name.
 */
function stripWikiLinkBrackets(content: string): string {
  return content.replace(WIKI_LINK_REGEX, '$1');
}

/**
 * Splits markdown body content on ## headers into named sections.
 */
function splitBodySections(body: string): BodySection[] {
  const sections: BodySection[] = [];
  const lines = body.split('\n');

  let currentSection: BodySection | null = null;
  const contentLines: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)$/);
    if (h2Match) {
      // Save previous section if exists
      if (currentSection) {
        currentSection.content = contentLines.join('\n').trim();
        sections.push(currentSection);
        contentLines.length = 0;
      }
      currentSection = { name: h2Match[1], content: '' };
    } else if (currentSection) {
      contentLines.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    currentSection.content = contentLines.join('\n').trim();
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Derives the slug from a file path (filename without extension).
 */
function deriveSlug(filePath: string): string {
  const filename = basename(filePath);
  const ext = extname(filename);
  return filename.slice(0, filename.length - ext.length);
}

/**
 * Derives the title from body content or falls back to slug.
 * Looks for the first H1 header in the body.
 */
function deriveTitle(body: string, slug: string): string {
  const h1Match = body.match(H1_HEADER_REGEX);
  if (h1Match) {
    return h1Match[1].trim();
  }
  return slug;
}

/**
 * Validates and normalizes a note type string.
 * Returns the valid NoteType or undefined if invalid.
 */
function parseNoteType(type: unknown): NoteType | undefined {
  const validTypes: NoteType[] = [
    'experience',
    'research',
    'belief',
    'entity',
    'bet',
    'question',
    'topic',
  ];

  if (typeof type === 'string' && validTypes.includes(type as NoteType)) {
    return type as NoteType;
  }
  return undefined;
}

/**
 * Safely extracts a string array from frontmatter data.
 */
function extractStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const filtered = value.filter(
    (item): item is string => typeof item === 'string'
  );
  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Safely extracts a string from frontmatter data.
 */
function extractString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

/**
 * Safely extracts a date string from frontmatter data.
 * Handles Date objects (converting to YYYY-MM-DD) and strings.
 */
function extractDateString(value: unknown): string | undefined {
  if (value instanceof Date) {
    // gray-matter parses dates as Date objects, convert back to YYYY-MM-DD
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

/**
 * Parses a single markdown file into a VaultDocument.
 *
 * @param filePath - Absolute path to the markdown file
 * @returns The parsed VaultDocument, or null if parsing fails
 */
export async function parseFile(
  filePath: string
): Promise<VaultDocument | null> {
  let content: string;

  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error) {
    console.warn(`[vault-engine] Failed to read file: ${filePath}`, error);
    return null;
  }

  let parsed: matter.GrayMatterFile<string>;

  try {
    parsed = matter(content);
  } catch (error) {
    console.warn(
      `[vault-engine] Malformed YAML frontmatter in file: ${filePath}`,
      error
    );
    return null;
  }

  const { data: frontmatter, content: body } = parsed;

  // Extract wiki-links from body
  const bodyWikiLinks = extractWikiLinks(body);

  // Merge frontmatter connections with body wiki-links
  const frontmatterConnections = extractStringArray(frontmatter.connections);
  const allConnections = new Set<string>();

  if (frontmatterConnections) {
    for (const conn of frontmatterConnections) {
      allConnections.add(conn);
    }
  }

  for (const link of bodyWikiLinks) {
    allConnections.add(link);
  }

  // Strip wiki-link brackets from raw body
  const rawBody = stripWikiLinkBrackets(body);

  // Derive slug and title
  const slug = deriveSlug(filePath);
  const title = deriveTitle(body, slug);

  // Parse note type - defaults to 'experience' if not specified or invalid
  const noteType = parseNoteType(frontmatter.type) ?? 'experience';

  // Split body into sections
  const bodySections = splitBodySections(body);

  const document: VaultDocument = {
    path: filePath,
    slug,
    noteType,
    title,
    bodySections,
    rawBody,
  };

  // Add optional fields if present
  const description = extractString(frontmatter.description);
  if (description) {
    document.description = description;
  }

  const topics = extractStringArray(frontmatter.topics);
  if (topics) {
    document.topics = topics;
  }

  const status = extractString(frontmatter.status);
  if (status) {
    document.status = status;
  }

  const confidence = extractString(frontmatter.confidence);
  if (confidence) {
    document.confidence = confidence;
  }

  const maturity = extractString(frontmatter.maturity);
  if (maturity) {
    document.maturity = maturity;
  }

  const provenance = extractString(frontmatter.provenance);
  if (provenance) {
    document.provenance = provenance;
  }

  const date = extractDateString(frontmatter.date);
  if (date) {
    document.date = date;
  }

  if (allConnections.size > 0) {
    document.connections = Array.from(allConnections);
  }

  return document;
}
