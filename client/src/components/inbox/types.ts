export interface MessageListItem {
  id: number;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  sentAt: string | null;
  summary: string | null;
  category: string | null;
  urgency: string | null;
  status: string;
  aiStatus: string;
  hasAttachments: boolean;
  procedureId: number | null;
  procedureReference: string | null;
}

export interface MessageListResponse {
  items: MessageListItem[];
  total: number;
}

export interface AccountStatus {
  connected: boolean;
  emailAddress?: string;
  status?: string;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  syncing?: boolean;
}

export interface ActionItem {
  id: string;
  text: string;
  done: boolean;
}

export interface AttachmentItem {
  id: number;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  procedureDocumentId: number | null;
}

export interface MessageDetail extends MessageListItem {
  gmailThreadId: string | null;
  toAddress: string | null;
  bodyText: string | null;
  snippet: string | null;
  actionItems: ActionItem[] | null;
  matchConfidence: string | null;
  matchReason: string | null;
  aiError: string | null;
  procedureShipper: string | null;
  attachments: AttachmentItem[];
}
