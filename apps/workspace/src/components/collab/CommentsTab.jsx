import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, RotateCcw, Reply as ReplyIcon, Trash2, Pencil, Download, Paperclip, ChevronDown, ChevronRight, User as UserIcon } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { downloadAttachment } from "@/lib/downloadAttachment";
import { useAuth } from "@/lib/auth";
import { COMMENT_VISIBILITY_TONE, formatBytes } from "@/lib/collab";
import { relTime } from "@/lib/relativeTime";
import { formatDateTime } from "@/lib/format";
import StatusPill from "@/components/StatusPill";
import CommentComposer from "./CommentComposer";

// Rendered thread including root comment + replies.
function ThreadItem({ thread, currentUser, users, onRefresh, focusCommentId }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(thread.status === "Resolved");

  const isRootAuthor = thread.user_id === currentUser?.id;
  const canEdit = isRootAuthor && !currentUser?.role?.is_super_admin
    ? isWithin30Min(thread.created_at)
    : isRootAuthor || currentUser?.role?.is_super_admin;

  return (
    <div className="rounded-md border border-amber-200 bg-white" data-testid={`comment-thread-${thread.id}`}>
      <CommentBody
        comment={thread}
        users={users}
        currentUser={currentUser}
        isRoot
        onRefresh={onRefresh}
        canEditNow={canEdit}
        focusCommentId={focusCommentId}
      />

      {thread.status === "Resolved" && (
        <div className="px-3 py-1.5 bg-green-50 border-t border-green-200 text-[11px] text-green-800 flex items-center justify-between">
          <span>Resolved · {relTime(thread.resolved_at)}</span>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="hover:underline"
            data-testid={`thread-expand-${thread.id}`}
          >
            {collapsed ? <><ChevronRight className="h-3 w-3 inline" /> expand</> : <><ChevronDown className="h-3 w-3 inline" /> collapse</>}
          </button>
        </div>
      )}

      {(!collapsed || thread.status !== "Resolved") && (
        <>
          {thread.replies?.length > 0 && (
            <div className="pl-8 pr-3 pb-2 space-y-2 border-t border-gray-100 pt-2">
              {thread.replies.map((r) => (
                <CommentBody
                  key={r.id}
                  comment={r}
                  users={users}
                  currentUser={currentUser}
                  isRoot={false}
                  onRefresh={onRefresh}
                  focusCommentId={focusCommentId}
                />
              ))}
            </div>
          )}
          {thread.status !== "Resolved" && (
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50">
              {!replyOpen ? (
                <button
                  type="button"
                  onClick={() => setReplyOpen(true)}
                  className="inline-flex items-center gap-1 text-xs text-navy-900 hover:underline"
                  data-testid={`thread-reply-${thread.id}`}
                >
                  <ReplyIcon className="h-3 w-3" /> Reply
                </button>
              ) : (
                <CommentComposer
                  entityType={thread.entity_type}
                  entityId={thread.entity_id}
                  parentCommentId={thread.id}
                  parentVisibility={thread.visibility}
                  autoFocus
                  onCancelReply={() => setReplyOpen(false)}
                  onPosted={() => {
                    setReplyOpen(false);
                    onRefresh();
                  }}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CommentBody({ comment, users, currentUser, isRoot, onRefresh, canEditNow, focusCommentId }) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [attachments, setAttachments] = useState([]);
  const rowRef = useRef(null);

  const author = users?.[comment.user_id];
  const isAuthor = comment.user_id === currentUser?.id;
  const isSuper = currentUser?.role?.is_super_admin;
  const editable = (isAuthor && isWithin30Min(comment.created_at)) || isSuper;
  const deletable = isAuthor || isSuper;
  const vTone = COMMENT_VISIBILITY_TONE[comment.visibility] || "grey";

  useEffect(() => {
    // Fetch attachments referenced by this comment
    if (comment.attachment_ids?.length > 0) {
      api
        .get(`/attachments`, { params: { entity_type: comment.entity_type, entity_id: comment.entity_id } })
        .then((r) => setAttachments((r.data || []).filter((a) => comment.attachment_ids.includes(a.id))))
        .catch(() => setAttachments([]));
    }
  }, [comment.attachment_ids, comment.entity_type, comment.entity_id]);

  useEffect(() => {
    if (focusCommentId && focusCommentId === comment.id && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      rowRef.current.classList.add("ring-2", "ring-amber-400");
      const t = setTimeout(() => rowRef.current?.classList.remove("ring-2", "ring-amber-400"), 2500);
      return () => clearTimeout(t);
    }
  }, [focusCommentId, comment.id]);

  const saveEdit = async () => {
    if (!editBody.trim()) return;
    try {
      await api.patch(`/comments/${comment.id}`, { body: editBody.trim() });
      toast.success("Updated");
      setEditing(false);
      onRefresh();
    } catch (e) {
      apiErrorToast(e);
    }
  };

  const deleteComment = async () => {
    if (!window.confirm("Delete this comment?")) return;
    try {
      await api.delete(`/comments/${comment.id}`);
      toast.success("Deleted");
      onRefresh();
    } catch (e) {
      apiErrorToast(e);
    }
  };

  const resolveThread = async () => {
    try {
      await api.post(`/comments/${comment.id}/resolve`, {});
      toast.success(comment.status === "Resolved" ? "Reopened" : "Resolved");
      onRefresh();
    } catch (e) {
      apiErrorToast(e);
    }
  };

  const download = (att) => downloadAttachment(att);

  return (
    <div
      ref={rowRef}
      className={["p-3 space-y-2 transition-shadow", isRoot ? "" : "rounded-md bg-gray-50/40"].join(" ")}
      data-comment-id={comment.id}
      data-testid={`comment-body-${comment.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-6 w-6 rounded-full bg-brand-50 text-navy-900 flex items-center justify-center shrink-0">
            <UserIcon className="h-3 w-3" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-gray-900 truncate">{author?.name || "Unknown"}</span>
              {author?.role_name && <span className="text-xs uppercase tracking-wide text-slate-600 font-semibold">{author.role_name}</span>}
              <span className="text-[10px] text-gray-400" title={formatDateTime(comment.created_at)}>· {relTime(comment.created_at)}</span>
              {comment.edited_at && <span className="text-[10px] text-gray-400 italic">(edited)</span>}
            </div>
          </div>
        </div>
        <StatusPill status={comment.visibility} tone={vTone} label={comment.visibility} />
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded p-2 focus:outline-none focus:ring-1 focus:ring-navy-900"
            rows={3}
            data-testid={`comment-edit-textarea-${comment.id}`}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveEdit}
              className="text-xs bg-navy-900 text-white px-2.5 py-1 rounded hover:bg-navy-800"
              data-testid={`comment-edit-save-${comment.id}`}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setEditBody(comment.body);
              }}
              className="text-xs text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">
          <RenderBodyWithMentions body={comment.body} mentionUsers={comment.mention_user_ids} mentionDepts={comment.mention_department_ids} users={users} />
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => download(a)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white text-[11px] px-2 py-1 hover:bg-gray-50"
              data-testid={`comment-attachment-${a.filename}`}
            >
              <Paperclip className="h-3 w-3 text-gray-500" />
              <span>{a.filename}</span>
              <span className="text-gray-400">· {formatBytes(a.size_bytes)}</span>
              <span className="text-gray-400">· {a.category}</span>
              <Download className="h-3 w-3 text-navy-900" />
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] text-gray-500">
        {isRoot && (
          <button
            type="button"
            onClick={resolveThread}
            className="inline-flex items-center gap-1 hover:text-green-700"
            data-testid={`comment-resolve-${comment.id}`}
          >
            {comment.status === "Resolved" ? <><RotateCcw className="h-3 w-3" /> Reopen</> : <><CheckCircle2 className="h-3 w-3" /> Resolve</>}
          </button>
        )}
        {editable && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 hover:text-navy-900"
            data-testid={`comment-edit-${comment.id}`}
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
        {deletable && (
          <button
            type="button"
            onClick={deleteComment}
            className="inline-flex items-center gap-1 hover:text-red-700"
            data-testid={`comment-delete-${comment.id}`}
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

function RenderBodyWithMentions({ body, mentionUsers, mentionDepts, users }) {
  // We don't parse @tokens from text — the server holds the canonical mention arrays.
  // We just render body verbatim and show chips at the top of the comment.
  const userMentions = (mentionUsers || []).map((id) => users?.[id]?.name).filter(Boolean);
  return (
    <>
      {userMentions.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {userMentions.map((n) => (
            <span key={n} className="inline-flex items-center rounded-full bg-brand-100 text-navy-900 text-[10px] px-1.5 py-0.5">
              @{n}
            </span>
          ))}
        </div>
      )}
      <span>{body}</span>
    </>
  );
}

function isWithin30Min(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 30 * 60 * 1000;
}

export default function CommentsTab({ entityType, entityId, focusCommentId }) {
  const { user } = useAuth();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState({});

  const refresh = async () => {
    setLoading(true);
    try {
      const [c, u] = await Promise.all([
        api.get("/comments", { params: { entity_type: entityType, entity_id: entityId } }),
        api.get("/users/assignable"),
      ]);
      setThreads(c.data);
      const roles = await api.get("/roles");
      const rolesById = Object.fromEntries((roles.data || []).map((r) => [r.id, r]));
      const map = {};
      (u.data || []).forEach((usr) => {
        map[usr.id] = {
          ...usr,
          role_name: rolesById[usr.role_id]?.name,
        };
      });
      setUsers(map);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  const activeThreads = useMemo(() => threads.filter((t) => t.status !== "Resolved"), [threads]);
  const resolvedThreads = useMemo(() => threads.filter((t) => t.status === "Resolved"), [threads]);

  return (
    <div className="space-y-3" data-testid="comments-tab">
      <CommentComposer entityType={entityType} entityId={entityId} onPosted={refresh} />
      {loading ? (
        <div className="text-xs text-gray-500 py-4 text-center">Loading conversations…</div>
      ) : threads.length === 0 ? (
        <div className="py-8 text-center text-xs text-amber-900/70 border border-dashed border-amber-300 bg-white/60 rounded-md">
          No conversations yet. Start one above.
        </div>
      ) : (
        <div className="space-y-3">
          {activeThreads.map((t) => (
            <ThreadItem key={t.id} thread={t} currentUser={user} users={users} onRefresh={refresh} focusCommentId={focusCommentId} />
          ))}
          {resolvedThreads.length > 0 && (
            <>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 pt-2">Resolved</div>
              {resolvedThreads.map((t) => (
                <ThreadItem key={t.id} thread={t} currentUser={user} users={users} onRefresh={refresh} focusCommentId={focusCommentId} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
