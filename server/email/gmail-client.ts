import { google } from "googleapis";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
export const MAX_SENDERS_PER_QUERY = 25;

function oauthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error(
      "Google OAuth ayarları eksik: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI",
    );
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI);
}

/** Gmail sorgu uzunluğu sınırlı olduğu için gönderen listesi parçalara bölünür. */
export function buildGmailQuery(patterns: string[], afterEpochSeconds: number): string[] {
  const cleaned = patterns
    .map((p) => p.trim().toLowerCase().replace(/^@/, ""))
    .filter((p) => p.length > 0);

  const queries: string[] = [];
  for (let i = 0; i < cleaned.length; i += MAX_SENDERS_PER_QUERY) {
    const chunk = cleaned.slice(i, i + MAX_SENDERS_PER_QUERY);
    queries.push(`(${chunk.map((p) => `from:${p}`).join(" OR ")}) after:${afterEpochSeconds}`);
  }
  return queries;
}

export function createAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // refresh_token'ın her seferinde dönmesini garanti eder
    scope: GMAIL_SCOPES,
    state,
  });
}

export async function exchangeCode(code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google refresh token döndürmedi. İzni iptal edip yeniden bağlanın.");
  }
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });

  return {
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
    emailAddress: profile.data.emailAddress ?? "",
  };
}

export async function revokeAccess(refreshToken: string): Promise<void> {
  await oauthClient().revokeToken(refreshToken);
}

export interface GmailClient {
  listMessageIds(query: string): Promise<string[]>;
  getMessage(id: string): Promise<any>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
}

export const MAX_PAGES_PER_QUERY = 20;

export interface MessageIdPage {
  ids: string[];
  nextPageToken?: string;
}

/**
 * Sayfalama döngüsü. İki koruma: sayfa sayısı üst sınırı ve ilerlemeyen
 * sayfa belirtecinde durma — ikisi de 15 dakikada bir çalışan senkronun
 * sonsuza kadar dönmesini engeller.
 */
export async function collectMessageIds(
  fetchPage: (pageToken?: string) => Promise<MessageIdPage>,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES_PER_QUERY) {
    const page = await fetchPage(pageToken);
    ids.push(...page.ids);
    pages++;

    const next = page.nextPageToken;
    if (!next || next === pageToken) break;
    pageToken = next;
  }

  if (pages >= MAX_PAGES_PER_QUERY) {
    console.warn(
      `[email-inbox] sayfa üst sınırına ulaşıldı (${MAX_PAGES_PER_QUERY}); kalan mailler bir sonraki turda alınacak`,
    );
  }
  return ids;
}

/**
 * refresh_token ile yetkilendirilmiş istemci. googleapis access token'ı
 * kendisi tazeler, bu yüzden access token'ı saklamak zorunda değiliz.
 */
export function createGmailClient(account: { refreshToken: string }): GmailClient {
  const client = oauthClient();
  client.setCredentials({ refresh_token: account.refreshToken });
  const gmail = google.gmail({ version: "v1", auth: client });

  return {
    async listMessageIds(query: string) {
      return collectMessageIds(async (pageToken) => {
        const res = await gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: 100,
          pageToken,
        });
        return {
          ids: (res.data.messages ?? []).map((m) => m.id).filter((id): id is string => !!id),
          nextPageToken: res.data.nextPageToken ?? undefined,
        };
      });
    },

    async getMessage(id: string) {
      const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      return res.data;
    },

    async getAttachment(messageId: string, attachmentId: string) {
      const res = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: attachmentId,
      });
      return Buffer.from(res.data.data ?? "", "base64url");
    },
  };
}
