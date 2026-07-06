import Database from "better-sqlite3";
import { insertAuditRow } from "./evidence.js";

export interface DraftRow {
  id: string;
  grant_id: string;
  section: string;
  content_md: string;
  citations_json: string;
  status: string;
  created_at: string;
  approved_by: string | null;
}

export interface CreateDraftInput {
  id: string;
  grant_id: string;
  section: string;
  content_md: string;
  citations: unknown[];
  created_at: string;
}

export function createDraft(
  db: Database.Database,
  draft: CreateDraftInput
): void {
  const stmt = db.prepare(`
    INSERT INTO drafts (
      id, grant_id, section, content_md, citations_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    draft.id,
    draft.grant_id,
    draft.section,
    draft.content_md,
    JSON.stringify(draft.citations),
    "proposed",
    draft.created_at
  );
}

export function approveDraft(
  db: Database.Database,
  draftId: string,
  actingUser: string,
  nowIso: string
): boolean {
  const updateStmt = db.prepare(`
    UPDATE drafts
    SET status = 'approved', approved_by = ?
    WHERE id = ? AND status != 'approved'
  `);

  const result = updateStmt.run(actingUser, draftId);

  if (result.changes > 0) {
    const auditId = `audit_${draftId}_approve_${Date.now()}`;
    insertAuditRow(db, {
      id: auditId,
      actor: actingUser,
      action: "approve_draft",
      entity: draftId,
      at: nowIso,
    });
    return true;
  }

  return false;
}

export function getDraftById(
  db: Database.Database,
  draftId: string
): DraftRow | null {
  const stmt = db.prepare(`SELECT * FROM drafts WHERE id = ?`);
  return (stmt.get(draftId) as DraftRow | undefined) ?? null;
}
