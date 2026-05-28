import { z } from 'zod';

// =============================================================================
// FIGMA API NODE TYPES
// =============================================================================

/**
 * Figma node type enumeration based on REST API specification.
 * @see https://developers.figma.com/docs/rest-api/file-node-types/
 */
export const FigmaNodeTypeSchema = z.enum([
  'DOCUMENT',
  'CANVAS',
  'FRAME',
  'GROUP',
  'TRANSFORM_GROUP',
  'SECTION',
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'REGULAR_POLYGON',
  'RECTANGLE',
  'TABLE',
  'TABLE_CELL',
  'TEXT',
  'TEXT_PATH',
  'SLICE',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'STICKY',
  'SHAPE_WITH_TEXT',
  'CONNECTOR',
  'WASHI_TAPE',
]);

export type FigmaNodeType = z.infer<typeof FigmaNodeTypeSchema>;

// =============================================================================
// FIGMA PROPERTY TYPES
// =============================================================================

/** Rectangle bounding box */
export const FigmaRectangleSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type FigmaRectangle = z.infer<typeof FigmaRectangleSchema>;

/** RGBA Color */
export const FigmaColorSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
  a: z.number().min(0).max(1),
});
export type FigmaColor = z.infer<typeof FigmaColorSchema>;

/** Paint/Fill type enum */
export const FigmaPaintTypeSchema = z.enum([
  'SOLID',
  'GRADIENT_LINEAR',
  'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND',
  'IMAGE',
  'EMOJI',
  'VIDEO',
]);
export type FigmaPaintType = z.infer<typeof FigmaPaintTypeSchema>;

/** Paint/Fill definition including image references */
export const FigmaPaintSchema = z.object({
  type: FigmaPaintTypeSchema,
  visible: z.boolean().optional().default(true),
  opacity: z.number().min(0).max(1).optional().default(1),
  color: FigmaColorSchema.optional(),
  blendMode: z.string().optional(),
  // Image-specific properties
  scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE', 'STRETCH']).optional(),
  imageRef: z.string().optional(),
  imageTransform: z.array(z.array(z.number())).optional(),
  scalingFactor: z.number().optional(),
  rotation: z.number().optional(),
  filters: z
    .object({
      exposure: z.number().optional(),
      contrast: z.number().optional(),
      saturation: z.number().optional(),
      temperature: z.number().optional(),
      tint: z.number().optional(),
      highlights: z.number().optional(),
      shadows: z.number().optional(),
    })
    .optional(),
  // Gradient properties
  gradientHandlePositions: z
    .array(z.object({ x: z.number(), y: z.number() }))
    .optional(),
  gradientStops: z
    .array(
      z.object({
        position: z.number(),
        color: FigmaColorSchema,
      }),
    )
    .optional(),
});
export type FigmaPaint = z.infer<typeof FigmaPaintSchema>;

/** TypeStyle for text nodes */
export const FigmaTypeStyleSchema = z.object({
  fontFamily: z.string().optional(),
  fontPostScriptName: z.string().nullable().optional(),
  fontWeight: z.number().optional(),
  fontSize: z.number().optional(),
  textAlignHorizontal: z
    .enum(['LEFT', 'RIGHT', 'CENTER', 'JUSTIFIED'])
    .optional(),
  textAlignVertical: z.enum(['TOP', 'CENTER', 'BOTTOM']).optional(),
  letterSpacing: z.number().optional(),
  lineHeightPx: z.number().optional(),
  lineHeightPercent: z.number().optional(),
  lineHeightPercentFontSize: z.number().optional(),
  lineHeightUnit: z.enum(['PIXELS', 'FONT_SIZE_%', 'INTRINSIC_%']).optional(),
  textCase: z
    .enum([
      'ORIGINAL',
      'UPPER',
      'LOWER',
      'TITLE',
      'SMALL_CAPS',
      'SMALL_CAPS_FORCED',
    ])
    .optional(),
  textDecoration: z.enum(['NONE', 'STRIKETHROUGH', 'UNDERLINE']).optional(),
  italic: z.boolean().optional(),
  fills: z.array(FigmaPaintSchema).optional(),
  hyperlink: z
    .preprocess(
      (val) => {
        // Figma sometimes returns `hyperlink: null` or omits `hyperlink.type`.
        // Treat missing/null/invalid as "no hyperlink" instead of failing the whole response.
        if (!val || typeof val !== 'object') return undefined;
        const o = val as Record<string, unknown>;
        const url = typeof o.url === 'string' ? o.url : undefined;
        const nodeIDRaw =
          typeof o.nodeID === 'string'
            ? o.nodeID
            : typeof o.nodeId === 'string'
              ? o.nodeId
              : typeof o.node_id === 'string'
                ? o.node_id
                : undefined;
        const typeRaw = typeof o.type === 'string' ? o.type : undefined;
        const type =
          typeRaw === 'URL' || typeRaw === 'NODE'
            ? typeRaw
            : url
              ? 'URL'
              : nodeIDRaw
                ? 'NODE'
                : undefined;

        // If we can't infer a usable hyperlink shape, drop it.
        if (!type) return undefined;

        return {
          type,
          ...(url ? { url } : {}),
          ...(nodeIDRaw ? { nodeID: nodeIDRaw } : {}),
        };
      },
      // Important: make the *inner* schema optional so preprocess->undefined is accepted
      // even when the input key exists (e.g. `hyperlink: null`).
      z
        .object({
          type: z.enum(['URL', 'NODE']),
          url: z.string().optional(),
          nodeID: z.string().optional(),
        })
        .optional(),
    ),
  opentypeFlags: z.record(z.number()).optional(),
});
export type FigmaTypeStyle = z.infer<typeof FigmaTypeStyleSchema>;

/** Effect definition (shadows, blur, etc.) */
export const FigmaEffectSchema = z.object({
  type: z.enum([
    'INNER_SHADOW',
    'DROP_SHADOW',
    'LAYER_BLUR',
    'BACKGROUND_BLUR',
  ]),
  visible: z.boolean().optional().default(true),
  radius: z.number().optional(),
  color: FigmaColorSchema.optional(),
  blendMode: z.string().optional(),
  offset: z.object({ x: z.number(), y: z.number() }).optional(),
  spread: z.number().optional(),
  showShadowBehindNode: z.boolean().optional(),
});
export type FigmaEffect = z.infer<typeof FigmaEffectSchema>;

/** Layout constraint */
export const FigmaLayoutConstraintSchema = z.object({
  vertical: z.enum(['TOP', 'BOTTOM', 'CENTER', 'TOP_BOTTOM', 'SCALE']),
  horizontal: z.enum(['LEFT', 'RIGHT', 'CENTER', 'LEFT_RIGHT', 'SCALE']),
});
export type FigmaLayoutConstraint = z.infer<typeof FigmaLayoutConstraintSchema>;

// =============================================================================
// FIGMA NODE SCHEMAS
// =============================================================================

/** Common geometric properties for frame-like nodes */
const FigmaGeometricPropsSchema = z.object({
  absoluteBoundingBox: FigmaRectangleSchema.optional(),
  absoluteRenderBounds: FigmaRectangleSchema.nullable().optional(),
  relativeTransform: z.array(z.array(z.number())).optional(),
  size: z.object({ x: z.number(), y: z.number() }).optional(),
  constraints: FigmaLayoutConstraintSchema.optional(),
  clipsContent: z.boolean().optional(),
});

/** Style properties for paintable nodes */
const FigmaStylePropsSchema = z.object({
  fills: z.array(FigmaPaintSchema).optional(),
  strokes: z.array(FigmaPaintSchema).optional(),
  strokeWeight: z.number().optional(),
  strokeAlign: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional(),
  strokeDashes: z.array(z.number()).optional(),
  opacity: z.number().optional().default(1),
  blendMode: z.string().optional(),
  effects: z.array(FigmaEffectSchema).optional(),
  styles: z.record(z.string()).optional(),
});

/** Layout properties for auto-layout frames */
const FigmaLayoutPropsSchema = z.object({
  layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']).optional(),
  layoutAlign: z
    .enum(['INHERIT', 'STRETCH', 'MIN', 'CENTER', 'MAX'])
    .optional(),
  layoutGrow: z.number().optional(),
  layoutSizingHorizontal: z.enum(['FIXED', 'HUG', 'FILL']).optional(),
  layoutSizingVertical: z.enum(['FIXED', 'HUG', 'FILL']).optional(),
  layoutPositioning: z.enum(['AUTO', 'ABSOLUTE']).optional(),
  paddingLeft: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingTop: z.number().optional(),
  paddingBottom: z.number().optional(),
  itemSpacing: z.number().optional(),
  counterAxisSpacing: z.number().optional(),
  primaryAxisSizingMode: z.enum(['FIXED', 'AUTO']).optional(),
  counterAxisSizingMode: z.enum(['FIXED', 'AUTO']).optional(),
  primaryAxisAlignItems: z
    .enum(['MIN', 'MAX', 'CENTER', 'SPACE_BETWEEN'])
    .optional(),
  counterAxisAlignItems: z
    .enum(['MIN', 'MAX', 'CENTER', 'BASELINE'])
    .optional(),
  counterAxisAlignContent: z.enum(['AUTO', 'SPACE_BETWEEN']).optional(),
  layoutWrap: z.enum(['NO_WRAP', 'WRAP']).optional(),
});

// Recursive type definition for FigmaNode
export type FigmaNode = {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  locked?: boolean;
  pluginData?: Record<string, unknown>;
  sharedPluginData?: Record<string, Record<string, unknown>>;
  // Geometric properties
  absoluteBoundingBox?: FigmaRectangle;
  absoluteRenderBounds?: FigmaRectangle | null;
  relativeTransform?: number[][];
  size?: { x: number; y: number };
  constraints?: z.infer<typeof FigmaLayoutConstraintSchema>;
  clipsContent?: boolean;
  // Style properties
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  strokeDashes?: number[];
  opacity?: number;
  blendMode?: string;
  effects?: z.infer<typeof FigmaEffectSchema>[];
  styles?: Record<string, string>;
  // Layout properties
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
  layoutGrow?: number;
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE';
  counterAxisAlignContent?: 'AUTO' | 'SPACE_BETWEEN';
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  // Children
  children?: FigmaNode[];
  // TEXT node properties
  characters?: string;
  style?: z.infer<typeof FigmaTypeStyleSchema>;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<number, z.infer<typeof FigmaTypeStyleSchema>>;
  // COMPONENT/INSTANCE properties
  componentId?: string;
  componentPropertyDefinitions?: Record<string, unknown>;
  componentProperties?: Record<string, unknown>;
  overrides?: unknown[];
  isExposedInstance?: boolean;
  // Corner properties
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  cornerSmoothing?: number;
  // Allow additional properties for extensibility
  [key: string]: unknown;
};

// Base schema for recursive nodes - use `z.lazy` for children
const baseFigmaNodeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    pluginData: z.record(z.unknown()).optional(),
    sharedPluginData: z.record(z.record(z.unknown())).optional(),
  })
  .merge(FigmaGeometricPropsSchema.partial())
  .merge(FigmaStylePropsSchema.partial())
  .merge(FigmaLayoutPropsSchema.partial())
  .extend({
    // TEXT node properties
    characters: z.string().optional(),
    style: FigmaTypeStyleSchema.optional(),
    characterStyleOverrides: z.array(z.number()).optional(),
    styleOverrideTable: z
      .record(z.coerce.number(), FigmaTypeStyleSchema)
      .optional(),
    // COMPONENT/INSTANCE properties
    componentId: z.string().optional(),
    componentPropertyDefinitions: z.record(z.unknown()).optional(),
    componentProperties: z.record(z.unknown()).optional(),
    overrides: z.array(z.unknown()).optional(),
    isExposedInstance: z.boolean().optional(),
    // Corner properties
    cornerRadius: z.number().optional(),
    rectangleCornerRadii: z.array(z.number()).optional(),
    cornerSmoothing: z.number().optional(),
  })
  .passthrough();

/** Full node schema with recursive children support */
export const FigmaNodeSchema: z.ZodType<FigmaNode> = baseFigmaNodeSchema.extend(
  {
    children: z.lazy(() => z.array(FigmaNodeSchema)).optional(),
  },
) as z.ZodType<FigmaNode>;

// =============================================================================
// TEXT-SPECIFIC SCHEMAS
// =============================================================================

/** Extracted text content from a TEXT node */
export const FigmaTextSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  characters: z.string(),
  style: FigmaTypeStyleSchema.optional(),
  boundingBox: FigmaRectangleSchema.optional(),
  // Derived properties for content extraction
  isHeading: z.boolean().optional(),
  headingLevel: z.number().min(1).max(6).optional(),
  isLink: z.boolean().optional(),
  linkUrl: z.string().optional(),
});
export type FigmaText = z.infer<typeof FigmaTextSchema>;

// =============================================================================
// IMAGE REFERENCE SCHEMAS
// =============================================================================

/** Image reference extracted from fills */
export const FigmaImageRefSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  imageRef: z.string(),
  scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE', 'STRETCH']).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  depth: z.number().optional(),
  // Purpose hint based on layer name or context
  purpose: z.string().optional(),
  // Fill type (IMAGE, VIDEO, etc.)
  fillType: FigmaPaintTypeSchema.optional(),
});
export type FigmaImageRef = z.infer<typeof FigmaImageRefSchema>;

// =============================================================================
// COMPONENT SCHEMAS
// =============================================================================

/** Component property definition */
export const FigmaComponentPropertyDefinitionSchema = z.object({
  type: z.enum(['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'VARIANT']),
  defaultValue: z.union([z.string(), z.boolean()]).optional(),
  variantOptions: z.array(z.string()).optional(),
  preferredValues: z
    .array(z.object({ type: z.string(), key: z.string() }))
    .optional(),
});
export type FigmaComponentPropertyDefinition = z.infer<
  typeof FigmaComponentPropertyDefinitionSchema
>;

/** Extracted component data */
export const FigmaComponentSchema = z.object({
  nodeId: z.string(),
  name: z.string(),
  type: z.enum(['COMPONENT', 'COMPONENT_SET', 'INSTANCE']),
  // For INSTANCE nodes
  componentId: z.string().optional(),
  // Component variant info (parsed from name like "Type=Primary, Size=Large")
  figmaVariant: z.string().optional(),
  variantProperties: z.record(z.string()).optional(),
  // Extracted content
  properties: z.record(z.unknown()).optional(),
  // Property definitions (for COMPONENT/COMPONENT_SET)
  componentPropertyDefinitions: z
    .record(FigmaComponentPropertyDefinitionSchema)
    .optional(),
  // Bounding box
  boundingBox: FigmaRectangleSchema.optional(),
  // Child component references
  childComponents: z
    .array(
      z.object({
        nodeId: z.string(),
        name: z.string(),
        type: z.string(),
      }),
    )
    .optional(),
});
export type FigmaComponent = z.infer<typeof FigmaComponentSchema>;

// =============================================================================
// CODE CONNECT SCHEMAS (for mapping to React components)
// =============================================================================

/** Code Connect mapping info */
export const FigmaCodeConnectSchema = z.object({
  componentName: z.string().nullable(),
  source: z.string().nullable(),
  matched: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  matchMethod: z.string().optional(),
  note: z.string().optional(),
});
export type FigmaCodeConnect = z.infer<typeof FigmaCodeConnectSchema>;

/** Component scan info (from codebase analysis) */
export const FigmaComponentScanSchema = z.object({
  propsInterface: z.string().optional(),
  recommendedComponent: z.string().optional(),
  source: z.string().optional(),
  requiredFields: z.array(z.string()).optional(),
  optionalFields: z.array(z.string()).optional(),
  fieldTypes: z.record(z.string()).optional(),
  multiItemFields: z
    .array(
      z.object({
        fieldName: z.string(),
        itemInterface: z.string(),
        itemFields: z.record(z.string()),
      }),
    )
    .optional(),
  imageFields: z.array(FigmaImageRefSchema).optional(),
  importPath: z.string().optional(),
  variantParam: z
    .object({
      paramName: z.string(),
      paramValue: z.string(),
    })
    .optional(),
  note: z.string().optional(),
});
export type FigmaComponentScan = z.infer<typeof FigmaComponentScanSchema>;

/** Extraction sources metadata */
export const FigmaExtractionSourcesSchema = z.object({
  method: z.string(),
  extractionPhases: z
    .object({
      phase1Depth: z.number().optional(),
      phase2Depth: z.number().optional(),
    })
    .optional(),
  totalFields: z.number().optional(),
  codeConnectUsed: z.boolean().optional(),
  componentScanUsed: z.boolean().optional(),
  note: z.string().optional(),
});
export type FigmaExtractionSources = z.infer<
  typeof FigmaExtractionSourcesSchema
>;

// =============================================================================
// FIGMA EXTRACT OUTPUT SCHEMA (template-match.json compatible)
// =============================================================================

/** Extracted component for figma-extract.json output */
export const FigmaExtractedComponentSchema = z.object({
  name: z.string(),
  nodeId: z.string(),
  type: z.enum(['component', 'instance', 'frame']),
  figmaComponentName: z.string().optional(),
  figmaVariant: z.string().optional(),
  // Extracted text/content properties
  properties: z.record(z.unknown()).optional(),
  // Multi-item collections (like servicesBlockItems, proofPointItems)
  servicesBlockItems: z.array(z.record(z.unknown())).optional(),
  proofPointItems: z.array(z.record(z.unknown())).optional(),
  actionBlockItems: z.array(z.record(z.unknown())).optional(),
  linkCardItems: z.array(z.record(z.unknown())).optional(),
  inlineCalloutItems: z.array(z.record(z.unknown())).optional(),
  // Code connect and component scan metadata
  _codeConnect: FigmaCodeConnectSchema.optional(),
  _componentScan: FigmaComponentScanSchema.optional(),
  _extractionSources: FigmaExtractionSourcesSchema.optional(),
});
export type FigmaExtractedComponent = z.infer<
  typeof FigmaExtractedComponentSchema
>;

/** Figma template section of output */
export const FigmaTemplateSchema = z.object({
  nodeId: z.string(),
  fileKey: z.string(),
  templateUrl: z.string().url(),
  components: z.array(FigmaExtractedComponentSchema),
});
export type FigmaTemplate = z.infer<typeof FigmaTemplateSchema>;

/** Figma metadata section */
export const FigmaExtractMetadataSchema = z.object({
  nodeCount: z.number(),
  hierarchyDepth: z.number(),
  extractionDepth: z.number(),
  extractionMethod: z.string(),
  templateStructure: z.array(z.string()).optional(),
});
export type FigmaExtractMetadata = z.infer<typeof FigmaExtractMetadataSchema>;

/** Category match info */
export const CategoryMatchSchema = z.object({
  category: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type CategoryMatch = z.infer<typeof CategoryMatchSchema>;

/** Template match info */
export const TemplateMatchSchema = z.object({
  matchType: z.enum(['direct', 'derived', 'partial', 'none']),
  matchedPagePath: z.string().optional(),
  templateName: z.string(),
  templateUrl: z.string().url().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type TemplateMatch = z.infer<typeof TemplateMatchSchema>;

/** Alternate match suggestion */
export const AlternateMatchSchema = z.object({
  templateName: z.string(),
  matchedPagePath: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type AlternateMatch = z.infer<typeof AlternateMatchSchema>;

/** Issue/warning in extraction */
export const ExtractionIssueSchema = z.union([
  z.string(),
  z.object({
    type: z.string(),
    component: z.string().optional(),
    description: z.string(),
  }),
]);
export type ExtractionIssue = z.infer<typeof ExtractionIssueSchema>;

/**
 * Full figma-extract.json / template-match.json output schema.
 * Compatible with existing page conversion workflow.
 */
export const FigmaExtractOutputSchema = z.object({
  // Source page info
  legacyPageUrl: z.string().url().optional(),
  legacyPageName: z.string().optional(),
  extractedAt: z.string().datetime().optional(),
  conversionPath: z.enum(['template', 'barebones', 'custom']).optional(),
  // Matching info
  categoryMatch: CategoryMatchSchema.optional(),
  templateMatch: TemplateMatchSchema.optional(),
  // Core Figma data
  figmaTemplate: FigmaTemplateSchema,
  figmaMetadata: FigmaExtractMetadataSchema,
  // Alternatives and issues
  alternateMatches: z.array(AlternateMatchSchema).optional(),
  issues: z.array(ExtractionIssueSchema).optional(),
});
export type FigmaExtractOutput = z.infer<typeof FigmaExtractOutputSchema>;

// =============================================================================
// FIGMA API RESPONSE SCHEMAS
// =============================================================================

/** GET /v1/files/:key response */
export const FigmaFileResponseSchema = z.object({
  name: z.string(),
  lastModified: z.string(),
  thumbnailUrl: z.string().url().optional(),
  version: z.string().optional(),
  role: z.string().optional(),
  document: FigmaNodeSchema,
  components: z.record(z.unknown()).optional(),
  componentSets: z.record(z.unknown()).optional(),
  schemaVersion: z.number().optional(),
  styles: z.record(z.unknown()).optional(),
  mainFileKey: z.string().optional(),
  branches: z.array(z.object({ key: z.string(), name: z.string() })).optional(),
});
export type FigmaFileResponse = z.infer<typeof FigmaFileResponseSchema>;

/** GET /v1/files/:key/nodes response */
export const FigmaNodesResponseSchema = z.object({
  name: z.string(),
  lastModified: z.string(),
  thumbnailUrl: z.string().url().optional(),
  version: z.string().optional(),
  role: z.string().optional(),
  nodes: z.record(
    z.object({
      document: FigmaNodeSchema,
      components: z.record(z.unknown()).optional(),
      schemaVersion: z.number().optional(),
      styles: z.record(z.unknown()).optional(),
    }),
  ),
});
export type FigmaNodesResponse = z.infer<typeof FigmaNodesResponseSchema>;

/** GET /v1/images/:key response */
export const FigmaImagesResponseSchema = z.object({
  err: z.string().nullable(),
  images: z.record(z.string().url().nullable()),
});
export type FigmaImagesResponse = z.infer<typeof FigmaImagesResponseSchema>;

// =============================================================================
// URL PARSING UTILITIES
// =============================================================================

/** Parsed Figma URL info */
export const FigmaUrlInfoSchema = z.object({
  fileKey: z.string(),
  nodeId: z.string().optional(),
  fileName: z.string().optional(),
});
export type FigmaUrlInfo = z.infer<typeof FigmaUrlInfoSchema>;

/**
 * Parse a Figma URL into its components.
 * Supports formats:
 * - https://www.figma.com/design/FILEKEY/NAME?node-id=123-456
 * - https://www.figma.com/file/FILEKEY/NAME?node-id=123:456
 * - figma.com/design/FILEKEY
 */
export function parseFigmaUrl(url: string): FigmaUrlInfo | null {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    // Expect [design|file, fileKey, optionalName]
    const typeIndex = pathParts.findIndex(
      (p) => p === 'design' || p === 'file',
    );
    if (typeIndex === -1 || !pathParts[typeIndex + 1]) {
      return null;
    }

    const fileKey = pathParts[typeIndex + 1];
    const fileName = pathParts[typeIndex + 2]
      ? decodeURIComponent(pathParts[typeIndex + 2])
      : undefined;

    // Parse node-id from query params (format: 123-456 or 123:456)
    const nodeIdParam = urlObj.searchParams.get('node-id');
    const nodeId = nodeIdParam ? nodeIdParam.replace(/-/g, ':') : undefined;

    return { fileKey, nodeId, fileName };
  } catch {
    return null;
  }
}

/**
 * Build a Figma URL from components.
 */
export function buildFigmaUrl(
  fileKey: string,
  nodeId?: string,
  fileName?: string,
): string {
  const base = `https://www.figma.com/design/${fileKey}`;
  const namePart = fileName ? `/${encodeURIComponent(fileName)}` : '';
  const nodePart = nodeId ? `?node-id=${nodeId.replace(':', '-')}` : '';
  return `${base}${namePart}${nodePart}`;
}
