/**
 * Markdown parser for vault notes.
 *
 * Parses individual vault files into typed VaultDocument objects,
 * extracting YAML frontmatter, body sections, and wiki-links.
 */

import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
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
 * Internal parse result that includes metadata about parsing.
 */
interface ParseResult {
  document: VaultDocument;
  /** True if the noteType was explicitly set in frontmatter */
  hasExplicitType: boolean;
}

/**
 * Internal function to parse a markdown file, returning additional metadata.
 */
async function parseFileInternal(
  filePath: string
): Promise<ParseResult | null> {
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

  // Parse note type - track whether it was explicitly set
  const parsedNoteType = parseNoteType(frontmatter.type);
  const hasExplicitType = parsedNoteType !== undefined;
  const noteType = parsedNoteType ?? 'experience';

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

  return { document, hasExplicitType };
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
  const result = await parseFileInternal(filePath);
  return result ? result.document : null;
}

/**
 * Directories to scan within a vault path.
 * These are the only directories where vault notes live.
 */
const INCLUDED_DIRECTORIES = [
  'experiences',
  'research/notes',
  'beliefs',
  'entities',
  'bets',
  'questions',
  '_topics',
];

/**
 * Maps directory paths to their corresponding note types.
 * Used for inferring noteType when frontmatter doesn't specify it.
 */
const DIRECTORY_TO_NOTE_TYPE: Record<string, NoteType> = {
  experiences: 'experience',
  'research/notes': 'research',
  beliefs: 'belief',
  entities: 'entity',
  bets: 'bet',
  questions: 'question',
  _topics: 'topic',
};

/**
 * Recursively collects all .md files from a directory.
 */
async function collectMarkdownFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    // Directory doesn't exist or can't be read
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Skip _* prefixed subdirectories (except _topics which is handled at root level)
      if (entry.name.startsWith('_')) {
        continue;
      }
      const subFiles = await collectMarkdownFiles(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Infers the note type from a file's path relative to the vault root.
 * Returns undefined if the path doesn't match a known directory.
 */
function inferNoteTypeFromPath(
  filePath: string,
  vaultPath: string
): NoteType | undefined {
  const relativePath = relative(vaultPath, filePath);

  for (const [dir, noteType] of Object.entries(DIRECTORY_TO_NOTE_TYPE)) {
    if (relativePath.startsWith(dir + '/') || relativePath.startsWith(dir + '\\')) {
      return noteType;
    }
  }

  return undefined;
}

/**
 * Checks if a file is in the _topics directory.
 */
function isInTopicsDirectory(filePath: string, vaultPath: string): boolean {
  const relativePath = relative(vaultPath, filePath);
  return relativePath.startsWith('_topics/') || relativePath.startsWith('_topics\\');
}

/**
 * Parses all markdown files from the scoped directories within a vault.
 *
 * Scans only: experiences/, research/notes/, beliefs/, entities/, bets/, questions/, _topics/
 * Excludes: _maintenance/, root-level files, _* prefixed directories except _topics/
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @returns Array of successfully parsed VaultDocuments (skips failures)
 */
export async function parseVaultDirectory(
  vaultPath: string
): Promise<VaultDocument[]> {
  const documents: VaultDocument[] = [];

  // Collect files from each included directory
  for (const dir of INCLUDED_DIRECTORIES) {
    const dirPath = join(vaultPath, dir);
    const files = await collectMarkdownFiles(dirPath);

    for (const filePath of files) {
      const result = await parseFileInternal(filePath);

      if (result) {
        const { document: doc, hasExplicitType } = result;

        // For _topics directory, always set noteType to 'topic' regardless of frontmatter
        if (isInTopicsDirectory(filePath, vaultPath)) {
          doc.noteType = 'topic';
        }
        // Infer noteType from path if frontmatter didn't specify a type
        else if (!hasExplicitType) {
          const inferredType = inferNoteTypeFromPath(filePath, vaultPath);
          if (inferredType) {
            doc.noteType = inferredType;
          }
        }

        documents.push(doc);
      }
    }
  }

  return documents;
}
