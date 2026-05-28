import { FigmaAuthorization } from '../auth/FigmaAuthorization';
import {
  FigmaNodesResponse,
  FigmaNodesResponseSchema,
  FigmaNode,
} from '../schemas';

const FIGMA_API_BASE = 'https://api.figma.com/v1';

export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId: string;
}

/**
 * Error thrown when Figma API requests fail
 */
export class FigmaApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = 'FigmaApiError';
  }
}

/**
 * FigmaApi - REST API client for Figma
 *
 * Provides methods for:
 * - Parsing Figma URLs to extract file keys and node IDs
 * - Fetching node data from the Figma API
 */
export class FigmaApi {
  private auth: FigmaAuthorization;

  constructor(auth?: FigmaAuthorization) {
    this.auth = auth ?? new FigmaAuthorization();
  }

  /**
   * Parse a Figma URL to extract file key and node ID.
   *
   * Supports URL formats:
   * - https://www.figma.com/design/XSgpz.../FH-System?node-id=17286-100687
   * - https://www.figma.com/file/XSgpz.../FH-System?node-id=17286:100687
   *
   * @param url - Figma design URL
   * @returns Parsed URL with fileKey and nodeId (nodeId uses : format for API)
   * @throws Error if URL format is invalid or missing required parts
   */
  parseUrl(url: string): ParsedFigmaUrl {
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Validate host
    if (
      urlObj.hostname !== 'figma.com' &&
      !urlObj.hostname.endsWith('.figma.com')
    ) {
      throw new Error(`Not a Figma URL: ${url}`);
    }

    // Parse path: /design/FILEKEY/NAME or /file/FILEKEY/NAME
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const typeIndex = pathParts.findIndex(
      (p) => p === 'design' || p === 'file',
    );

    if (typeIndex === -1) {
      throw new Error(
        `Invalid Figma URL format - expected /design/ or /file/ in path: ${url}`,
      );
    }

    const fileKey = pathParts[typeIndex + 1];
    if (!fileKey) {
      throw new Error(`Invalid Figma URL - missing file key: ${url}`);
    }

    // Parse node-id from query params
    const nodeIdParam = urlObj.searchParams.get('node-id');
    if (!nodeIdParam) {
      throw new Error(
        `Invalid Figma URL - missing node-id query param: ${url}`,
      );
    }

    // Convert from URL format (17286-100687) to API format (17286:100687)
    const nodeId = nodeIdParam.replace(/-/g, ':');

    return { fileKey, nodeId };
  }

  /**
   * Fetch node data from Figma API.
   *
   * @param fileKey - Figma file key
   * @param nodeIds - Array of node IDs in 123:456 format
   * @returns FigmaNodesResponse with node documents
   * @throws FigmaApiError on API errors
   */
  async getNodes(
    fileKey: string,
    nodeIds: string[],
    init?: RequestInit,
  ): Promise<FigmaNodesResponse> {
    if (nodeIds.length === 0) {
      throw new Error('At least one node ID is required');
    }

    // Build URL with comma-separated node IDs
    const ids = nodeIds.join(',');
    const url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`;

    const response = await this.auth.fetch(url, init);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new FigmaApiError(
        `Figma API error: ${response.status} ${response.statusText}`,
        response.status,
        errorBody,
      );
    }

    const json = (await response.json()) as unknown;
    const parsed = FigmaNodesResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new FigmaApiError(
        `Invalid Figma API response: ${parsed.error.message}`,
        response.status,
        json,
      );
    }

    return parsed.data;
  }

  /**
   * Fetch a single node by Figma URL.
   *
   * Convenience method that parses the URL and fetches the node.
   *
   * @param url - Figma design URL with node-id
   * @returns The FigmaNode document for the specified node
   * @throws Error if URL is invalid or node not found
   */
  async getNodeByUrl(url: string, init?: RequestInit): Promise<FigmaNode> {
    const { fileKey, nodeId } = this.parseUrl(url);
    const response = await this.getNodes(fileKey, [nodeId], init);

    const nodeData = response.nodes[nodeId];
    if (!nodeData) {
      throw new FigmaApiError(
        `Node not found in response: ${nodeId}`,
        undefined,
        response,
      );
    }

    return nodeData.document;
  }
}
