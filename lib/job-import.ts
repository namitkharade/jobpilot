import { runStructuredResponse } from "@/lib/openai";
import { JobImportDraft, JobImportMethod, JobSource } from "@/types";
import { assertSafeExternalUrl } from "./url-safety";

const FETCH_TIMEOUT_MS = 12000;
const MAX_HTML_CHARS = 500_000;
const MAX_AI_CONTEXT_CHARS = 18_000;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const IMPORT_FIELDS: Array<keyof JobImportDraft> = [
  "title",
  "company",
  "location",
  "salary",
  "jobType",
  "source",
  "applyUrl",
  "jobDescription",
  "companyDescription",
  "postedAt",
  "jobPosterName",
  "jobPosterTitle",
];

const EMPTY_IMPORT_DRAFT: JobImportDraft = {
  title: "",
  company: "",
  location: "",
  salary: "",
  jobType: "",
  source: "manual",
  applyUrl: "",
  jobDescription: "",
  companyDescription: "",
  postedAt: "",
  jobPosterName: "",
  jobPosterTitle: "",
};

type DraftFragment = Partial<JobImportDraft>;

interface ImportPageResult {
  finalUrl: string;
  html: string;
}

export interface JobPageLink {
  url: string;
  text: string;
}

export interface JobPageInspection {
  finalUrl: string;
  canonicalUrl: string;
  extractedVia: JobImportMethod;
  draft: JobImportDraft;
  warnings: string[];
  visibleText: string;
  pageTitle: string;
  mailtoEmails: string[];
  teamLinks: JobPageLink[];
  companyWebsiteUrls: string[];
}

interface JobImportResult {
  data: JobImportDraft;
  warnings: string[];
  extractedVia: JobImportMethod;
}

export class JobImportError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "JobImportError";
    this.status = status;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanInlineText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function cleanBlockText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripHtml(value: string): string {
  return cleanBlockText(
    value
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|ul|ol|h\d|tr|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function normalizeDate(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return "";
  return new Date(timestamp).toISOString();
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getUrlString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const normalized = new URL(trimmed);
    if (!/^https?:$/i.test(normalized.protocol)) {
      return "";
    }
    return normalized.toString();
  } catch {
    return "";
  }
}

function getUrlStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = getUrlString(value);
    return normalized ? [normalized] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => getUrlString(entry))
    .filter(Boolean);
}

function inferSourceFromUrl(url: string): JobSource {
  const normalized = getUrlString(url);
  if (!normalized) return "manual";

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    if (hostname.includes("linkedin.")) return "linkedin";
    if (hostname.includes("indeed.")) return "indeed";
  } catch {
    return "manual";
  }

  return "manual";
}

function buildEmptyDraft(applyUrl = ""): JobImportDraft {
  return {
    ...EMPTY_IMPORT_DRAFT,
    applyUrl,
    source: inferSourceFromUrl(applyUrl),
  };
}

function mergeDrafts(...drafts: DraftFragment[]): JobImportDraft {
  const merged = buildEmptyDraft();

  drafts.forEach((draft) => {
    IMPORT_FIELDS.forEach((field) => {
      const nextValue = draft[field];

      if (field === "source") {
        if (typeof nextValue === "string" && nextValue) {
          merged.source = nextValue as JobSource;
        }
        return;
      }

      if (typeof nextValue !== "string") return;
      if (merged[field]) return;

      merged[field] = field === "postedAt" ? normalizeDate(nextValue) : cleanBlockText(nextValue);
    });
  });

  merged.applyUrl = getUrlString(merged.applyUrl);
  merged.source = inferSourceFromUrl(merged.applyUrl) || merged.source;
  return merged;
}

function mergeMissingFields(base: JobImportDraft, patch: DraftFragment): JobImportDraft {
  const merged = { ...base };

  IMPORT_FIELDS.forEach((field) => {
    const nextValue = patch[field];
    if (field === "source") return;
    if (typeof nextValue !== "string" || !nextValue.trim()) return;
    if (merged[field]) return;
    merged[field] = field === "postedAt" ? normalizeDate(nextValue) : cleanBlockText(nextValue);
  });

  merged.source = inferSourceFromUrl(merged.applyUrl || patch.applyUrl || "");
  return merged;
}

function hasDraftValues(draft: DraftFragment): boolean {
  return IMPORT_FIELDS.some((field) => {
    const value = draft[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function getTagAttribute(tag: string, attribute: string): string {
  const pattern = new RegExp(`${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return cleanInlineText(match?.[1] || match?.[2] || match?.[3] || "");
}

function extractTitleTag(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanInlineText(match?.[1] || "");
}

function parseMetaTags(html: string): Record<string, string> {
  const matches = html.match(/<meta\b[^>]*>/gi) || [];
  return matches.reduce<Record<string, string>>((acc, tag) => {
    const key = (
      getTagAttribute(tag, "property") ||
      getTagAttribute(tag, "name") ||
      getTagAttribute(tag, "itemprop") ||
      getTagAttribute(tag, "http-equiv")
    ).toLowerCase();
    const content = getTagAttribute(tag, "content");
    if (key && content && !acc[key]) {
      acc[key] = content;
    }
    return acc;
  }, {});
}

function extractCanonicalUrl(html: string, fallbackUrl: string): string {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    const rel = getTagAttribute(tag, "rel").toLowerCase();
    if (!rel.includes("canonical")) continue;
    const href = getUrlString(getTagAttribute(tag, "href"));
    if (href) return href;
  }
  return getUrlString(fallbackUrl);
}

function formatSalary(value: unknown): string {
  if (typeof value === "string") {
    return cleanInlineText(stripHtml(value));
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const currency = getString(record.currency) || getString((record.value as Record<string, unknown> | undefined)?.currency);
  const unitText =
    getString(record.unitText) ||
    getString((record.value as Record<string, unknown> | undefined)?.unitText) ||
    getString((record.value as Record<string, unknown> | undefined)?.unitText);

  const valueRecord =
    record.value && typeof record.value === "object" && !Array.isArray(record.value)
      ? (record.value as Record<string, unknown>)
      : record;

  const minValue = getString(valueRecord.minValue ?? valueRecord.value);
  const maxValue = getString(valueRecord.maxValue);
  const minNumber =
    typeof valueRecord.minValue === "number"
      ? String(valueRecord.minValue)
      : typeof valueRecord.value === "number"
        ? String(valueRecord.value)
        : minValue;
  const maxNumber = typeof valueRecord.maxValue === "number" ? String(valueRecord.maxValue) : maxValue;

  if (minNumber && maxNumber) {
    return cleanInlineText(`${currency}${minNumber} - ${currency}${maxNumber} ${unitText}`.trim());
  }

  if (minNumber) {
    return cleanInlineText(`${currency}${minNumber} ${unitText}`.trim());
  }

  return "";
}

function formatLocation(value: unknown): string {
  if (typeof value === "string") {
    return cleanInlineText(stripHtml(value));
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => formatLocation(entry))
      .filter(Boolean)
      .join(" | ");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const address =
    record.address && typeof record.address === "object" && !Array.isArray(record.address)
      ? (record.address as Record<string, unknown>)
      : record;

  const parts = [
    getString(address.addressLocality),
    getString(address.addressRegion),
    getString(address.addressCountry),
  ]
    .map(cleanInlineText)
    .filter(Boolean);

  return parts.join(", ");
}

function formatEmploymentType(value: unknown): string {
  if (typeof value === "string") {
    return cleanInlineText(value);
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map(cleanInlineText)
      .filter(Boolean)
      .join(", ");
  }

  return "";
}

function extractJsonLdBlocks(html: string): unknown[] {
  const matches = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  return matches.flatMap((tag) => {
    const contentMatch = tag.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    const raw = contentMatch?.[1]?.trim();
    if (!raw) return [];

    try {
      return [JSON.parse(raw)];
    } catch {
      return [];
    }
  });
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findJobPosting(entry);
      if (found) return found;
    }
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const typeField = record["@type"];
  const types = Array.isArray(typeField)
    ? typeField.filter((entry): entry is string => typeof entry === "string")
    : typeof typeField === "string"
      ? [typeField]
      : [];

  if (types.some((entry) => entry.toLowerCase() === "jobposting")) {
    return record;
  }

  for (const nestedValue of Object.values(record)) {
    const found = findJobPosting(nestedValue);
    if (found) return found;
  }

  return null;
}

function extractStructuredDataDraft(html: string, fallbackUrl: string): DraftFragment {
  const blocks = extractJsonLdBlocks(html);
  const jobPosting = blocks.map(findJobPosting).find((entry): entry is Record<string, unknown> => Boolean(entry));

  if (!jobPosting) {
    return {};
  }

  const hiringOrganization =
    jobPosting.hiringOrganization && typeof jobPosting.hiringOrganization === "object" && !Array.isArray(jobPosting.hiringOrganization)
      ? (jobPosting.hiringOrganization as Record<string, unknown>)
      : {};
  const author =
    jobPosting.author && typeof jobPosting.author === "object" && !Array.isArray(jobPosting.author)
      ? (jobPosting.author as Record<string, unknown>)
      : {};

  const applyUrl = getUrlString(getString(jobPosting.url)) || getUrlString(fallbackUrl);

  return {
    title: getString(jobPosting.title) || getString(jobPosting.name),
    company: getString(hiringOrganization.name),
    location: formatLocation(jobPosting.jobLocation || jobPosting.applicantLocationRequirements),
    salary: formatSalary(jobPosting.baseSalary),
    jobType: formatEmploymentType(jobPosting.employmentType),
    source: inferSourceFromUrl(applyUrl),
    applyUrl,
    jobDescription: stripHtml(getString(jobPosting.description)),
    companyDescription: stripHtml(getString(hiringOrganization.description)),
    postedAt: normalizeDate(getString(jobPosting.datePosted)),
    jobPosterName: getString(author.name),
    jobPosterTitle: getString(author.jobTitle),
  };
}

function extractStructuredDataCompanyUrls(html: string): string[] {
  const blocks = extractJsonLdBlocks(html);
  const jobPosting = blocks.map(findJobPosting).find((entry): entry is Record<string, unknown> => Boolean(entry));
  if (!jobPosting) return [];

  const hiringOrganization =
    jobPosting.hiringOrganization && typeof jobPosting.hiringOrganization === "object" && !Array.isArray(jobPosting.hiringOrganization)
      ? (jobPosting.hiringOrganization as Record<string, unknown>)
      : {};

  return Array.from(
    new Set([
      ...getUrlStringArray(hiringOrganization.url),
      ...getUrlStringArray(hiringOrganization.sameAs),
    ])
  );
}

function inferTitleAndCompanyFromText(title: string, siteName: string): Pick<JobImportDraft, "title" | "company"> {
  const normalizedTitle = cleanInlineText(title.replace(/\s*\|\s*apply now.*$/i, ""));
  if (!normalizedTitle) {
    return { title: "", company: cleanInlineText(siteName) };
  }

  if (/^(careers?|jobs?|job openings?|open roles?)$/i.test(normalizedTitle)) {
    return { title: "", company: cleanInlineText(siteName) };
  }

  const separators = [" at ", " | ", " - ", " — ", " :: "];

  for (const separator of separators) {
    const parts = normalizedTitle.split(separator).map((part) => cleanInlineText(part)).filter(Boolean);
    if (parts.length < 2) continue;

    if (separator.trim() === "at") {
      return { title: parts[0], company: parts[1] || cleanInlineText(siteName) };
    }

    if (siteName) {
      const companyIndex = parts.findIndex((part) => part.toLowerCase() === siteName.toLowerCase());
      if (companyIndex >= 0) {
        const role = parts.find((_, index) => index !== companyIndex) || parts[0];
        return { title: role, company: parts[companyIndex] };
      }
    }

    return { title: parts[0], company: parts[1] || cleanInlineText(siteName) };
  }

  return {
    title: normalizedTitle,
    company: cleanInlineText(siteName),
  };
}

function extractMetaDraft(html: string, fallbackUrl: string): DraftFragment {
  const meta = parseMetaTags(html);
  const titleTag = extractTitleTag(html);
  const siteName = meta["og:site_name"] || meta["application-name"] || "";
  const inferred = inferTitleAndCompanyFromText(meta["og:title"] || meta["twitter:title"] || titleTag, siteName);
  const applyUrl = extractCanonicalUrl(html, fallbackUrl);

  return {
    title: inferred.title,
    company: inferred.company,
    location:
      meta["job:location"] ||
      meta["business:contact_data:locality"] ||
      meta["geo.placename"] ||
      meta["location"] ||
      "",
    salary: meta["og:salary"] || meta["salary"] || "",
    jobType: meta["employmenttype"] || meta["job:type"] || "",
    source: inferSourceFromUrl(applyUrl),
    applyUrl,
    jobDescription: meta["description"] || meta["og:description"] || meta["twitter:description"] || "",
    companyDescription: meta["og:site_name"] ? `${meta["og:site_name"]} careers page` : "",
    postedAt: normalizeDate(meta["article:published_time"] || meta["og:updated_time"] || meta["date"]),
    jobPosterName: meta["author"] || "",
    jobPosterTitle: "",
  };
}

function extractVisibleText(html: string): string {
  return cleanBlockText(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|section|article|li|ul|ol|h\d|tr|table|main|header|footer)>/gi, "\n")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractMailtoEmails(html: string): string[] {
  const matches = html.match(/mailto:([^"'?#\s>]+)/gi) || [];
  return Array.from(
    new Set(
      matches
        .map((entry) => entry.replace(/^mailto:/i, "").trim())
        .map((entry) => entry.split("?")[0]?.trim() || "")
        .filter(Boolean)
    )
  );
}

function extractCandidateLinks(html: string, baseUrl: string): JobPageLink[] {
  const anchorPattern = /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  const links: JobPageLink[] = [];

  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = match[1] || match[2] || match[3] || "";
    const text = cleanInlineText(stripHtml(match[4] || ""));
    if (!rawHref.trim()) continue;

    try {
      const resolved = new URL(rawHref, baseUrl).toString();
      if (!/^https?:/i.test(resolved)) continue;
      links.push({ url: resolved, text });
    } catch {
      continue;
    }
  }

  return links;
}

function filterTeamLinks(links: JobPageLink[]): JobPageLink[] {
  const keywords = ["team", "people", "leadership", "about", "contact", "careers"];
  const seen = new Set<string>();

  return links.filter((link) => {
    const haystack = `${link.url} ${link.text}`.toLowerCase();
    const matches = keywords.some((keyword) => haystack.includes(keyword));
    if (!matches || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function extractFirstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanInlineText(match?.[1] || match?.[0] || "");
    if (value) return value;
  }
  return "";
}

function extractDescriptionSnippet(text: string): string {
  const windows = [
    /about the job([\s\S]{0,1500})/i,
    /job description([\s\S]{0,1500})/i,
    /about the role([\s\S]{0,1500})/i,
    /responsibilities([\s\S]{0,1500})/i,
  ];

  for (const pattern of windows) {
    const match = text.match(pattern);
    if (!match?.[0]) continue;
    const snippet = cleanBlockText(match[0]).slice(0, 1500);
    if (snippet.length >= 120) return snippet;
  }

  return cleanBlockText(text).slice(0, 1500);
}

function extractHeuristicDraft(html: string, fallbackUrl: string): DraftFragment {
  const visibleText = extractVisibleText(html);
  const meta = parseMetaTags(html);
  const inferred = inferTitleAndCompanyFromText(extractTitleTag(html), meta["og:site_name"] || "");

  return {
    title: inferred.title,
    company: inferred.company,
    location: extractFirstMatch(visibleText, [
      /\b(?:location|job location|work location|based in)\b[:\s-]*([A-Z][A-Za-z0-9,./()\s-]{2,80}|Remote|Hybrid|On-site|Onsite)/i,
      /\b(Remote|Hybrid|On-site|Onsite)\b/i,
    ]),
    salary: extractFirstMatch(visibleText, [
      /([$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s*[kK])?(?:\s*(?:-|to)\s*[$€£]?\s?\d[\d,]*(?:\.\d+)?(?:\s*[kK])?)?(?:\s*\/\s*(?:year|yr|hour|hr|month))?)/i,
    ]),
    jobType: extractFirstMatch(visibleText, [/\b(full[\s-]?time|part[\s-]?time|contract|internship|temporary|apprenticeship)\b/i]),
    source: inferSourceFromUrl(fallbackUrl),
    applyUrl: getUrlString(fallbackUrl),
    jobDescription: extractDescriptionSnippet(visibleText),
    companyDescription: "",
    postedAt: normalizeDate(
      extractFirstMatch(visibleText, [
        /\b(?:posted|date posted|published)\b[:\s-]*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i,
        /\b(\d{4}-\d{2}-\d{2})\b/,
      ])
    ),
    jobPosterName: "",
    jobPosterTitle: "",
  };
}

function summarizeMissingFields(draft: JobImportDraft): string[] {
  const missing = [
    !draft.title && "job title",
    !draft.company && "company",
    !draft.location && "location",
    !draft.jobDescription && "job description",
  ].filter((entry): entry is string => Boolean(entry));

  if (!missing.length) return [];
  return [`Some fields still need review: ${missing.join(", ")}.`];
}

function buildAiInput(url: string, deterministicDraft: JobImportDraft, html: string): string {
  const visibleText = extractVisibleText(html).slice(0, MAX_AI_CONTEXT_CHARS);

  return [
    `Job URL: ${url}`,
    `Current extracted fields: ${JSON.stringify(deterministicDraft, null, 2)}`,
    "Visible page text excerpt:",
    visibleText,
  ].join("\n\n");
}

async function extractWithAiFallback(url: string, draft: JobImportDraft, html: string): Promise<DraftFragment> {
  const result = await runStructuredResponse<JobImportDraft>({
    schemaName: "job_import_draft",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        company: { type: "string" },
        location: { type: "string" },
        salary: { type: "string" },
        jobType: { type: "string" },
        source: { type: "string", enum: ["linkedin", "indeed", "manual"] },
        applyUrl: { type: "string" },
        jobDescription: { type: "string" },
        companyDescription: { type: "string" },
        postedAt: { type: "string" },
        jobPosterName: { type: "string" },
        jobPosterTitle: { type: "string" },
      },
      required: IMPORT_FIELDS,
    },
    instructions:
      "Extract job listing details from the supplied job-page text. Prefer explicit facts. Use an empty string when a field is unknown. Return ISO 8601 for postedAt only when the date is explicit. Do not invent recruiter names or companies.",
    input: buildAiInput(url, draft, html),
    allowChatFallback: true,
  });

  return result.data;
}

async function fetchJobPage(inputUrl: string): Promise<ImportPageResult> {
  let safeInputUrl: URL;
  try {
    safeInputUrl = await assertSafeExternalUrl(inputUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid URL";
    throw new JobImportError(message, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(safeInputUrl.toString(), {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": BROWSER_USER_AGENT,
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new JobImportError("Timed out while fetching the job page.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 502 : response.status;
    throw new JobImportError(`Failed to fetch the job page (${response.status}).`, status);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new JobImportError("The pasted URL did not return an HTML job page.", 422);
  }

  const html = (await response.text()).slice(0, MAX_HTML_CHARS);
  if (!html.trim()) {
    throw new JobImportError("The job page was empty.", 422);
  }

  let safeFinalUrl = safeInputUrl;
  const redirectedUrl = typeof response.url === "string" ? response.url.trim() : "";
  if (redirectedUrl) {
    try {
      safeFinalUrl = await assertSafeExternalUrl(redirectedUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unsafe redirect target";
      throw new JobImportError(`Unsafe redirect target: ${message}`, 422);
    }
  }

  return {
    finalUrl: getUrlString(safeFinalUrl.toString()) || getUrlString(safeInputUrl.toString()),
    html,
  };
}

export async function inspectJobPage(
  inputUrl: string,
  options: { allowAiFallback?: boolean } = {}
): Promise<JobPageInspection> {
  const normalizedUrl = getUrlString(inputUrl);
  if (!normalizedUrl) {
    throw new JobImportError("Please paste a valid http or https job URL.", 400);
  }

  const { finalUrl, html } = await fetchJobPage(normalizedUrl);
  const structuredDraft = extractStructuredDataDraft(html, finalUrl);
  const metaDraft = extractMetaDraft(html, finalUrl);
  const heuristicDraft = extractHeuristicDraft(html, finalUrl);

  let draft = mergeDrafts(buildEmptyDraft(finalUrl), structuredDraft, metaDraft, heuristicDraft);
  let extractedVia: JobImportMethod = hasDraftValues(structuredDraft)
    ? "structured-data"
    : hasDraftValues(metaDraft)
      ? "meta-tags"
      : "heuristic";

  const warnings: string[] = [];
  const missingCoreFields = [draft.title, draft.company, draft.location, draft.jobDescription].filter((value) => !value).length;

  if (missingCoreFields > 0 && options.allowAiFallback) {
    try {
      const aiDraft = await extractWithAiFallback(finalUrl, draft, html);
      const nextDraft = mergeMissingFields(draft, aiDraft);
      const usedAi = IMPORT_FIELDS.some((field) => field !== "source" && !draft[field] && nextDraft[field]);

      draft = nextDraft;
      if (usedAi) {
        extractedVia = "openai-fallback";
        warnings.push("Used AI fallback to complete missing job fields.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI fallback unavailable";
      warnings.push(`AI fallback unavailable: ${message}.`);
    }
  }

  draft.applyUrl = getUrlString(draft.applyUrl || finalUrl);
  draft.source = inferSourceFromUrl(draft.applyUrl);
  draft.postedAt = normalizeDate(draft.postedAt);
  draft.jobDescription = draft.jobDescription.slice(0, 5000);
  draft.companyDescription = draft.companyDescription.slice(0, 1500);

  warnings.push(...summarizeMissingFields(draft));

  return {
    finalUrl,
    canonicalUrl: extractCanonicalUrl(html, finalUrl),
    extractedVia,
    draft,
    warnings: Array.from(new Set(warnings)),
    visibleText: extractVisibleText(html),
    pageTitle: extractTitleTag(html),
    mailtoEmails: extractMailtoEmails(html),
    teamLinks: filterTeamLinks(extractCandidateLinks(html, finalUrl)),
    companyWebsiteUrls: extractStructuredDataCompanyUrls(html),
  };
}

export async function importJobFromUrl(inputUrl: string): Promise<JobImportResult> {
  const inspection = await inspectJobPage(inputUrl, { allowAiFallback: true });

  return {
    data: inspection.draft,
    warnings: inspection.warnings,
    extractedVia: inspection.extractedVia,
  };
}
