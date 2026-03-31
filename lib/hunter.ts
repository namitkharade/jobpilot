import { RecruiterProfile } from "@/types";
import { getConfig } from "./local-store";

type HunterDepartment =
  | "hr"
  | "engineering"
  | "sales"
  | "marketing"
  | "it"
  | "finance"
  | "management"
  | "legal"
  | "communication"
  | "support";

const DEPT_MAP: Record<string, HunterDepartment> = {
  engineering: "engineering",
  data: "engineering",
  platform: "engineering",
  infrastructure: "engineering",
  backend: "engineering",
  frontend: "engineering",
  mobile: "engineering",
  ml: "engineering",
  ai: "engineering",
  devops: "engineering",
  security: "engineering",
  research: "engineering",
  science: "engineering",
  product: "engineering",
  sales: "sales",
  revenue: "sales",
  "business development": "sales",
  bd: "sales",
  partnerships: "sales",
  account: "sales",
  marketing: "marketing",
  growth: "marketing",
  brand: "marketing",
  content: "marketing",
  seo: "marketing",
  demand: "marketing",
  hr: "hr",
  "human resources": "hr",
  people: "hr",
  talent: "hr",
  recruiting: "hr",
  "people ops": "hr",
  operations: "management",
  management: "management",
  "customer success": "support",
  support: "support",
  finance: "finance",
  legal: "legal",
  compliance: "legal",
  it: "it",
};

const RECRUITER_KEYWORDS = [
  "recruiter",
  "talent",
  "acquisition",
  "staffing",
  "hiring",
  "sourcer",
  "talent acquisition",
  "ta lead",
  "talent lead",
  "talent manager",
  "talent partner",
  "people partner",
  "people business partner",
  "hr business partner",
  "human resources business partner",
  "people operations",
  "people ops",
  "human resources",
];
const MANAGER_KEYWORDS = ["manager", "director", "head of", "vp", "vice president", "lead", "principal"];

const BASE_URL = "https://api.hunter.io/v2";

function getHunterKey(): string {
  return process.env.HUNTER_API_KEY || getConfig().apiKeys.hunter || "";
}

function mapToHunterDept(raw: string): HunterDepartment | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const [key, value] of Object.entries(DEPT_MAP)) {
    if (lower.includes(key)) return value;
  }
  return null;
}

export async function extractDomain(company: string): Promise<string> {
  try {
    const res = await fetch(`${BASE_URL}/domain-search?company=${encodeURIComponent(company)}&api_key=${getHunterKey()}`);
    if (!res.ok) return "";
    const data = await res.json();
    return data.data?.domain || "";
  } catch {
    return "";
  }
}

export async function findEmail(firstName: string, lastName: string, domain: string): Promise<{email: string, confidence: number, verified: boolean}> {
  try {
    const res = await fetch(`${BASE_URL}/email-finder?first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&domain=${encodeURIComponent(domain)}&api_key=${getHunterKey()}`);
    if (!res.ok) return { email: "", confidence: 0, verified: false };
    const data = await res.json();
    return {
      email: data.data?.email || "",
      confidence: data.data?.score || 0,
      verified: data.data?.status === "valid" || data.data?.verification?.status === "valid"
    };
  } catch {
    return { email: "", confidence: 0, verified: false };
  }
}

export async function verifyEmail(email: string): Promise<{valid: boolean, result: string}> {
  try {
    const res = await fetch(`${BASE_URL}/email-verifier?email=${encodeURIComponent(email)}&api_key=${getHunterKey()}`);
    if (!res.ok) return { valid: false, result: "error" };
    const data = await res.json();
    return {
      valid: data.data?.status === "valid",
      result: data.data?.status || "unknown"
    };
  } catch {
    return { valid: false, result: "error" };
  }
}

/**
 * Track A = HR dept search filtered to recruiter titles
 * Track B = job-relevant dept search filtered to manager/lead titles
 * Cost = 1-2 Hunter credits per call
 */
export async function findRecruitersAndManagers(
  domain: string,
  jobDepartment: string
): Promise<{
  name: string;
  email: string;
  title: string;
  linkedinUrl: string;
  confidence: number;
  verified: boolean;
  contactType: "recruiter" | "hiring-manager";
}[]> {
  if (!getHunterKey()) return [];

  try {
    const hunterDept = mapToHunterDept(jobDepartment);
    const encodedDomain = encodeURIComponent(domain);
    const hrUrl = `${BASE_URL}/domain-search?domain=${encodedDomain}&department=hr&type=personal&limit=10&api_key=${getHunterKey()}`;
    const requests: Promise<Response>[] = [fetch(hrUrl)];

    if (hunterDept && hunterDept !== "hr") {
      const deptUrl = `${BASE_URL}/domain-search?domain=${encodedDomain}&department=${hunterDept}&type=personal&limit=10&api_key=${getHunterKey()}`;
      requests.push(fetch(deptUrl));
    }

    const responses = await Promise.all(requests);
    const payloads = await Promise.all(
      responses.map(async (res) => (res.ok ? res.json() : null))
    );

    const parse = (
      data: unknown,
      contactType: "recruiter" | "hiring-manager"
    ) => {
      const emails = Array.isArray((data as { data?: { emails?: unknown } })?.data?.emails)
        ? (data as { data?: { emails?: unknown[] } }).data?.emails || []
        : [];
      const keywords = contactType === "recruiter" ? RECRUITER_KEYWORDS : MANAGER_KEYWORDS;

      return emails
        .filter((emailEntry) => {
          const entry = (emailEntry && typeof emailEntry === "object")
            ? (emailEntry as Record<string, unknown>)
            : {};
          const positionRaw = typeof entry.position_raw === "string" ? entry.position_raw : "";
          const position = typeof entry.position === "string" ? entry.position : "";
          const haystack = `${positionRaw} ${position}`.toLowerCase();
          return keywords.some((keyword) => haystack.includes(keyword));
        })
        .map((emailEntry) => {
          const entry = (emailEntry && typeof emailEntry === "object")
            ? (emailEntry as Record<string, unknown>)
            : {};
          const firstName = typeof entry.first_name === "string" ? entry.first_name : "";
          const lastName = typeof entry.last_name === "string" ? entry.last_name : "";
          const positionRaw = typeof entry.position_raw === "string" ? entry.position_raw : "";
          const position = typeof entry.position === "string" ? entry.position : "";
          const verification = (entry.verification && typeof entry.verification === "object")
            ? (entry.verification as Record<string, unknown>)
            : {};
          const linkedinUrl = typeof entry.linkedin === "string"
            ? entry.linkedin
            : typeof entry.linkedin_url === "string"
              ? entry.linkedin_url
              : "";
          return {
            name: `${firstName} ${lastName}`.trim(),
            email: typeof entry.value === "string" ? entry.value : "",
            title: positionRaw || position || "",
            linkedinUrl,
            confidence: typeof entry.confidence === "number" ? entry.confidence : 0,
            verified: verification.status === "valid",
            contactType,
          };
        });
    };

    const rank = (items: ReturnType<typeof parse>) =>
      items
        .sort(
          (a, b) => Number(b.verified) - Number(a.verified) || b.confidence - a.confidence
        )
        .slice(0, 6);

    const hrResults = parse(payloads[0], "recruiter");
    const deptResults = payloads.length > 1 ? parse(payloads[1], "hiring-manager") : [];

    return [...rank(hrResults), ...rank(deptResults)];
  } catch {
    return [];
  }
}

async function domainSearch(
  domain: string,
  department?: string
): Promise<{ name: string; email: string; title: string; confidence: number }[]> {
  try {
    let url = `${BASE_URL}/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${getHunterKey()}`;
    if (department) {
      url += `&department=${encodeURIComponent(department)}`;
    }
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const emails = Array.isArray(data.data?.emails) ? data.data.emails : [];
    return emails.map((emailEntry: unknown) => {
      const entry = (emailEntry && typeof emailEntry === "object") ? (emailEntry as Record<string, unknown>) : {};
      const firstName = typeof entry.first_name === "string" ? entry.first_name : "";
      const lastName = typeof entry.last_name === "string" ? entry.last_name : "";
      return {
        name: `${firstName} ${lastName}`.trim(),
        email: typeof entry.value === "string" ? entry.value : "",
        title: typeof entry.position === "string" ? entry.position : "",
        confidence: typeof entry.confidence === "number" ? entry.confidence : 0
      };
    });
  } catch {
    return [];
  }
}

export async function lookupRecruiterEmail(
  recruiter: RecruiterProfile,
  company: string
): Promise<{
  email: string;
  confidence: number;
  method: "hunter-direct" | "hunter-domain" | "pattern-verified" | "not-found";
  verified: boolean;
}> {
  // 1. Extract domain
  const domain = await extractDomain(company);
  if (!domain) {
    return { email: "", confidence: 0, method: "not-found", verified: false };
  }

  // 2. Parse recruiter.name
  const nameParts = recruiter.name.trim().split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  // 3. Try findEmail
  if (firstName) {
    const directMatch = await findEmail(firstName, lastName, domain);
    if (directMatch.email && directMatch.confidence >= 50) {
      return {
        email: directMatch.email,
        confidence: directMatch.confidence,
        method: "hunter-direct",
        verified: directMatch.verified,
      };
    }
  }

  // 4. Try domainSearch
  const searchResults = await domainSearch(domain, "human resources");
  const nameMatch = searchResults.find(
    (r) => r.name.toLowerCase() === recruiter.name.toLowerCase()
  );
  if (nameMatch) {
    return {
      email: nameMatch.email,
      confidence: nameMatch.confidence,
      method: "hunter-domain",
      // domainSearch score doesn't imply verification but let's assume not verified natively, 
      // or we can verify it right now:
      verified: false,
    };
  }

  // 5. Generate patterns and verify
  if (firstName && lastName) {
    const f1 = firstName.toLowerCase();
    const l1 = lastName.toLowerCase();
    const fi = f1.charAt(0);

    const patterns = [
      `${f1}@${domain}`,
      `${fi}.${l1}@${domain}`,
      `${f1}.${l1}@${domain}`,
      `${fi}${l1}@${domain}`,
      `${l1}@${domain}`,
      `${f1}_${l1}@${domain}`,
    ];

    for (const pattern of patterns) {
      const v = await verifyEmail(pattern);
      if (v.valid) {
        return {
          email: pattern,
          confidence: 99,
          method: "pattern-verified",
          verified: true,
        };
      }
    }
  }

  return { email: "", confidence: 0, method: "not-found", verified: false };
}
