import type { FigmaNode, FigmaRectangle, FigmaTypeStyle } from '../schemas';

// =============================================================================
// OUTPUT TYPES
// =============================================================================

/**
 * Image reference extracted from node fills
 */
export interface ImageRef {
  nodeId: string;
  nodeName: string;
  imageRef?: string; // Figma image hash
  scaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE' | 'STRETCH';
  width?: number;
  height?: number;
}

/**
 * Parsed component data from Figma node
 */
export interface ParsedComponent {
  name: string;
  type: string;
  nodeId: string;
  visible?: boolean;
  absoluteBoundingBox?: FigmaRectangle;
  componentId?: string; // for INSTANCE nodes
  properties?: Record<string, unknown>;
  /**
   * Raw componentProperties from Figma (before key normalization / style merging).
   * Useful for debugging and for consumers that need full fidelity.
   */
  propertiesRaw?: Record<string, unknown>;
  text?: string[];
  textStyle?: FigmaTypeStyle;
  hyperlink?: FigmaTypeStyle['hyperlink'];
  reactions?: unknown[];
  interactions?: unknown[];
  images?: ImageRef[];
  children?: ParsedComponent[];
}

/**
 * Full parsed tree with metadata
 */
export interface ParsedComponentTree {
  root: ParsedComponent;
  metadata: {
    totalNodes: number;
    textNodes: number;
    instanceNodes: number;
    imageNodes: number;
    maxDepth: number;
  };
}

// =============================================================================
// PARSER OPTIONS
// =============================================================================

export interface ParseOptions {
  /** Include hidden (visible=false) nodes. Default: false */
  includeHidden?: boolean;
  /** Max depth to traverse. Default: Infinity */
  maxDepth?: number;
  /** Include component properties. Default: true */
  includeProperties?: boolean;
  /** Include style info in properties. Default: false */
  includeStyles?: boolean;
}

const DEFAULT_OPTIONS: Required<ParseOptions> = {
  includeHidden: false,
  maxDepth: Infinity,
  includeProperties: true,
  includeStyles: false,
};

// =============================================================================
// FIGMA NODE PARSER
// =============================================================================

/**
 * Parser for extracting structured data from Figma nodes.
 * Handles component instances, text content, and image fills.
 */
export class FigmaNodeParser {
  private options: Required<ParseOptions>;

  constructor(options?: ParseOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Parse a single node into ParsedComponent.
   * Does not recurse into children.
   */
  parseNode(node: FigmaNode): ParsedComponent {
    const parsed: ParsedComponent = {
      name: node.name,
      type: node.type,
      nodeId: node.id,
      visible: node.visible,
      absoluteBoundingBox: node.absoluteBoundingBox,
    };

    // Component instance properties
    if (node.type === 'INSTANCE' && node.componentId) {
      parsed.componentId = node.componentId;
    }

    // Extract properties for component instances
    if (this.options.includeProperties && node.componentProperties) {
      const { normalized, raw } = this.extractComponentProperties(node);
      parsed.properties = normalized;
      parsed.propertiesRaw = raw;
    }

    // Extract text if TEXT node
    if (node.type === 'TEXT' && node.characters) {
      parsed.text = [node.characters];
      parsed.textStyle = node.style;
      parsed.hyperlink = node.style?.hyperlink;
    }

    // Prototype/interaction metadata (best-effort; not always present in REST payloads)
    const nodeWithInteractions = node as unknown as {
      reactions?: unknown[];
      interactions?: unknown[];
    };
    if (Array.isArray(nodeWithInteractions.reactions)) {
      parsed.reactions = nodeWithInteractions.reactions;
    }
    if (Array.isArray(nodeWithInteractions.interactions)) {
      parsed.interactions = nodeWithInteractions.interactions;
    }

    // Extract images from fills
    const images = this.extractImagesFromNode(node);
    if (images.length > 0) {
      parsed.images = images;
    }

    // Include styles if requested
    if (this.options.includeStyles) {
      parsed.properties = {
        ...parsed.properties,
        ...this.extractStyleProperties(node),
      };
    }

    return parsed;
  }

  /**
   * Extract all text content from a node tree.
   * Returns array of text strings in tree order.
   */
  extractText(node: FigmaNode, depth = 0): string[] {
    const texts: string[] = [];

    // Skip hidden nodes unless configured otherwise
    if (!this.options.includeHidden && node.visible === false) {
      return texts;
    }

    // Check depth limit
    if (depth > this.options.maxDepth) {
      return texts;
    }

    // Extract text from TEXT nodes
    if (node.type === 'TEXT' && node.characters) {
      const trimmed = node.characters.trim();
      if (trimmed) {
        texts.push(trimmed);
      }
    }

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        texts.push(...this.extractText(child, depth + 1));
      }
    }

    return texts;
  }

  /**
   * Extract all image references from a node tree.
   * Returns array of ImageRef objects.
   */
  extractImages(node: FigmaNode, depth = 0): ImageRef[] {
    const images: ImageRef[] = [];

    // Skip hidden nodes unless configured otherwise
    if (!this.options.includeHidden && node.visible === false) {
      return images;
    }

    // Check depth limit
    if (depth > this.options.maxDepth) {
      return images;
    }

    // Extract images from this node
    images.push(...this.extractImagesFromNode(node));

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        images.push(...this.extractImages(child, depth + 1));
      }
    }

    return images;
  }

  /**
   * Parse entire node tree recursively.
   * Returns ParsedComponentTree with metadata.
   */
  parseTree(node: FigmaNode): ParsedComponentTree {
    const stats = {
      totalNodes: 0,
      textNodes: 0,
      instanceNodes: 0,
      imageNodes: 0,
      maxDepth: 0,
    };

    const root = this.parseNodeRecursive(node, 0, stats);

    return {
      root,
      metadata: stats,
    };
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Recursively parse node and children, collecting stats.
   */
  private parseNodeRecursive(
    node: FigmaNode,
    depth: number,
    stats: ParsedComponentTree['metadata'],
  ): ParsedComponent {
    // Update stats
    stats.totalNodes++;
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    if (node.type === 'TEXT') stats.textNodes++;
    if (node.type === 'INSTANCE') stats.instanceNodes++;
    if (this.hasImageFill(node)) stats.imageNodes++;

    // Parse current node
    const parsed = this.parseNode(node);

    // Check depth limit and visibility before recursing
    if (depth < this.options.maxDepth && node.children) {
      const children: ParsedComponent[] = [];

      for (const child of node.children) {
        // Skip hidden nodes
        if (!this.options.includeHidden && child.visible === false) {
          continue;
        }

        children.push(this.parseNodeRecursive(child, depth + 1, stats));
      }

      if (children.length > 0) {
        parsed.children = children;
      }
    }

    return parsed;
  }

  /**
   * Extract images from a single node's fills.
   */
  private extractImagesFromNode(node: FigmaNode): ImageRef[] {
    const images: ImageRef[] = [];

    if (!node.fills || !Array.isArray(node.fills)) {
      return images;
    }

    for (const fill of node.fills) {
      // Only process visible IMAGE fills with imageRef
      if (fill.type === 'IMAGE' && fill.visible !== false && fill.imageRef) {
        const imageRef: ImageRef = {
          nodeId: node.id,
          nodeName: node.name,
          imageRef: fill.imageRef,
        };

        if (fill.scaleMode) {
          imageRef.scaleMode = fill.scaleMode;
        }

        // Get dimensions from bounding box
        if (node.absoluteBoundingBox) {
          imageRef.width = node.absoluteBoundingBox.width;
          imageRef.height = node.absoluteBoundingBox.height;
        }

        images.push(imageRef);
      }
    }

    return images;
  }

  /**
   * Check if node has any image fills.
   */
  private hasImageFill(node: FigmaNode): boolean {
    if (!node.fills || !Array.isArray(node.fills)) {
      return false;
    }

    return node.fills.some(
      (fill) =>
        fill.type === 'IMAGE' && fill.visible !== false && fill.imageRef,
    );
  }

  /**
   * Extract component properties from INSTANCE node.
   */
  private extractComponentProperties(node: FigmaNode): {
    normalized: Record<string, unknown>;
    raw: Record<string, unknown>;
  } {
    const normalized: Record<string, unknown> = {};
    const raw: Record<string, unknown> = {};

    if (!node.componentProperties) {
      return { normalized, raw };
    }

    // componentProperties is Record<string, unknown> with value objects
    for (const [key, value] of Object.entries(node.componentProperties)) {
      const normalizedKey = key.split('#')[0]?.trim() || key;
      const extracted =
        typeof value === 'object' && value !== null && 'value' in value
          ? (value as { value: unknown }).value
          : value;

      raw[key] = extracted;

      if (typeof value === 'object' && value !== null && 'value' in value) {
        normalized[normalizedKey] = extracted;
      } else {
        normalized[normalizedKey] = extracted;
      }
    }

    return { normalized, raw };
  }

  /**
   * Extract style properties for inclusion in parsed output.
   */
  private extractStyleProperties(node: FigmaNode): Record<string, unknown> {
    const styles: Record<string, unknown> = {};

    if (node.opacity !== undefined && node.opacity !== 1) {
      styles.opacity = node.opacity;
    }

    if (node.cornerRadius !== undefined) {
      styles.cornerRadius = node.cornerRadius;
    }

    if (node.layoutMode && node.layoutMode !== 'NONE') {
      styles.layoutMode = node.layoutMode;
      if (node.itemSpacing) styles.itemSpacing = node.itemSpacing;
      if (node.paddingLeft) styles.paddingLeft = node.paddingLeft;
      if (node.paddingRight) styles.paddingRight = node.paddingRight;
      if (node.paddingTop) styles.paddingTop = node.paddingTop;
      if (node.paddingBottom) styles.paddingBottom = node.paddingBottom;
    }

    // Text styles
    if (node.type === 'TEXT' && node.style) {
      styles.textStyle = {
        fontFamily: node.style.fontFamily,
        fontSize: node.style.fontSize,
        fontWeight: node.style.fontWeight,
        textAlign: node.style.textAlignHorizontal,
      };
    }

    return Object.keys(styles).length > 0 ? styles : {};
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Parse a Figma node tree with default options.
 */
export function parseTree(
  node: FigmaNode,
  options?: ParseOptions,
): ParsedComponentTree {
  const parser = new FigmaNodeParser(options);
  return parser.parseTree(node);
}

/**
 * Extract all text from a Figma node tree.
 */
export function extractText(node: FigmaNode, options?: ParseOptions): string[] {
  const parser = new FigmaNodeParser(options);
  return parser.extractText(node);
}

/**
 * Extract all images from a Figma node tree.
 */
export function extractImages(
  node: FigmaNode,
  options?: ParseOptions,
): ImageRef[] {
  const parser = new FigmaNodeParser(options);
  return parser.extractImages(node);
}
