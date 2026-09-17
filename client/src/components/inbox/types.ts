export interface MessageListItem {
  direction?: string;
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
  /** Gönderilen bir mail sayesinde kendiliğinden kapandıysa dolu. */
  autoClosed?: boolean;
  closedReason?: string;
  closedByEmailId?: number;
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

export interface ThreadListItem {
  threadId: string;
  latestEmailId: number;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  lastSentAt: string | null;
  summary: string | null;
  category: string | null;
  urgency: string | null;
  status: string;
  aiStatus: string;
  messageCount: number;
  unreadCount: number;
  openActionCount: number;
  hasAttachments: boolean;
  procedureId: number | null;
  procedureReference: string | null;
}

export interface ThreadListResponse {
  items: ThreadListItem[];
  total: number;
}

export interface ProcedureMailSummary {
  procedureId: number;
  reference: string | null;
  shipper: string | null;
  messageCount: number;
  threadCount: number;
  openActionCount: number;
  unreadCount: number;
  pendingAttachmentCount: number;
  lastMailAt: string | null;
}

export interface ProcedureMailDocument {
  source: "procedure" | "email";
  id: number;
  name: string | null;
  type: string | null;
  createdAt: string | null;
  emailId: number | null;
  emailSubject: string | null;
  status: string | null;
  sizeBytes: number | null;
}

export interface ProcedureActionItem {
  emailId: number;
  autoClosed?: boolean;
  closedReason?: string;
  emailSubject: string | null;
  sentAt: string | null;
  itemId: string;
  text: string;
  done: boolean;
}

export interface ProcedureMailDetail {
  summary: ProcedureMailSummary;
  documents: ProcedureMailDocument[];
  actionItems: ProcedureActionItem[];
  threads: ThreadListItem[];
}

export interface OtherMailsResponse {
  threads: ThreadListItem[];
  total: number;
  actionItems: ProcedureActionItem[];
  openCount: number;
}
