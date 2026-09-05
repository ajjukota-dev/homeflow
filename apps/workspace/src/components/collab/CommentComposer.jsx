import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AtSign, Paperclip, Send, X as XIcon, Loader2, Eye, EyeOff } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/context/PermissionsContext";
import {
  canPostCustomerVisible,
  ALLOWED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  formatBytes,
} from "@/lib/collab";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Composer for a new comment or an inline reply.
export default function CommentComposer({
  entityType,
  entityId,
  parentCommentId = null,
  parentVisibility = null,
  onPosted,
  autoFocus = false,
  onCancelReply,
}) {
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState(parentVisibility || "Internal");
  const [mentionUsers, setMentionUsers] = useState([]);
  const [mentionDepts, setMentionDepts] = useState([]);
  const [attachmentIds, setAttachmentIds] = useState([]);
  const [attachmentMeta, setAttachmentMeta] = useState([]);
  const [users, setUsers] = useState([]);
  const [depts, setDepts] = useState([]);
  const [rolesById, setRolesById] = useState({});
  const [deptsById, setDeptsById] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Picker state — supports two open modes:
  //  * "inline"  → triggered by typing "@" in the textarea
  //  * "button"  → triggered by clicking the @ toolbar button
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState(null);
  const [pickerQ, setPickerQ] = useState("");
  const [pickerIdx, setPickerIdx] = useState(0);
  const [inlineAtPos, setInlineAtPos] = useState(-1); // char index of the "@" in body when inline

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const rootRef = useRef(null);
  const pickerQInputRef = useRef(null);

  const isReply = Boolean(parentCommentId);
  const cvAllowed = canPostCustomerVisible(user);
  const canComment = useCan("comments", "write");

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get("/users/assignable"),
      api.get("/departments"),
      api.get("/roles"),
    ])
      .then(([u, d, r]) => {
        if (!alive) return;
        setUsers(u.data || []);
        setDepts(d.data || []);
        setRolesById(Object.fromEntries((r.data || []).map((x) => [x.id, x])));
        setDeptsById(Object.fromEntries((d.data || []).map((x) => [x.id, x])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) closePicker();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableUsers = useMemo(() => {
    const chosen = new Set(mentionUsers.map((u) => u.id));
    const q = pickerQ.trim().toLowerCase();
    return users
      .filter((u) => u.id !== user?.id && !chosen.has(u.id))
      .filter((u) => {
        if (!q) return true;
        const roleName = rolesById[u.role_id]?.name || "";
        const deptName = deptsById[u.department_id]?.name || "";
        return `${u.name} ${u.email} ${roleName} ${deptName}`.toLowerCase().includes(q);
      })
      .slice(0, 10);
  }, [users, pickerQ, mentionUsers, user, rolesById, deptsById]);

  const availableDepts = useMemo(() => {
    const chosen = new Set(mentionDepts.map((d) => d.id));
    const q = pickerQ.trim().toLowerCase();
    return depts
      .filter((d) => !chosen.has(d.id) && d.active !== false)
      .filter((d) => !q || `${d.name} ${d.code}`.toLowerCase().includes(q))
      .slice(0, 10);
  }, [depts, pickerQ, mentionDepts]);

  const flatItems = useMemo(() => {
    return [
      ...availableUsers.map((u) => ({ kind: "user", item: u })),
      ...availableDepts.map((d) => ({ kind: "dept", item: d })),
    ];
  }, [availableUsers, availableDepts]);

  // Keep the highlighted index inside bounds when the list shrinks.
  useEffect(() => {
    if (pickerIdx >= flatItems.length) setPickerIdx(Math.max(0, flatItems.length - 1));
  }, [flatItems.length, pickerIdx]);

  const closePicker = () => {
    setPickerOpen(false);
    setPickerMode(null);
    setPickerQ("");
    setPickerIdx(0);
    setInlineAtPos(-1);
  };

  const openButtonPicker = () => {
    setPickerOpen(true);
    setPickerMode("button");
    setPickerQ("");
    setPickerIdx(0);
    setTimeout(() => pickerQInputRef.current?.focus(), 0);
  };

  const selectItem = (entry) => {
    if (!entry) return;
    if (entry.kind === "user") {
      setMentionUsers((prev) => [...prev, entry.item]);
    } else {
      setMentionDepts((prev) => [...prev, entry.item]);
    }
    if (pickerMode === "inline" && inlineAtPos >= 0) {
      // Strip the "@fragment" (including the @) from the body.
      const removedLen = 1 + pickerQ.length;
      const newBody = body.slice(0, inlineAtPos) + body.slice(inlineAtPos + removedLen);
      setBody(newBody);
      // Restore focus to textarea after selection
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = inlineAtPos;
        }
      }, 0);
    }
    closePicker();
  };

  const removeUserMention = (id) => setMentionUsers((p) => p.filter((u) => u.id !== id));
  const removeDeptMention = (id) => setMentionDepts((p) => p.filter((d) => d.id !== id));

  // ---- inline @ detector ----
  const detectInline = (text, cursor) => {
    const upto = text.slice(0, cursor);
    const atIdx = upto.lastIndexOf("@");
    if (atIdx === -1) return null;
    if (atIdx > 0 && !/\s/.test(upto[atIdx - 1])) return null; // must follow whitespace/start
    const frag = upto.slice(atIdx + 1);
    if (/\s/.test(frag)) return null; // fragment must have no spaces
    return { atIdx, q: frag };
  };

  const onBodyChange = (e) => {
    const newBody = e.target.value;
    setBody(newBody);
    const cursor = e.target.selectionStart ?? newBody.length;
    const info = detectInline(newBody, cursor);
    if (info) {
      setPickerOpen(true);
      setPickerMode("inline");
      setPickerQ(info.q);
      setInlineAtPos(info.atIdx);
      // Reset highlight on new query
      setPickerIdx(0);
    } else if (pickerMode === "inline") {
      closePicker();
    }
  };

  const onBodyKeyDown = (e) => {
    if (pickerOpen && pickerMode === "inline") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerIdx((i) => (flatItems.length === 0 ? 0 : Math.min(flatItems.length - 1, i + 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" && flatItems.length > 0) {
        e.preventDefault();
        selectItem(flatItems[pickerIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closePicker();
        return;
      }
    }
  };

  const onFilesPicked = async (fileList) => {
    const files = Array.from(fileList || []);
    for (const f of files) {
      const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
        toast.error(`${f.name}: extension not allowed`);
        continue;
      }
      if (f.size > MAX_UPLOAD_BYTES) {
        toast.error(`${f.name}: file exceeds 25 MB`);
        continue;
      }
      const tempId = `t-${Math.random().toString(36).slice(2)}`;
      setAttachmentMeta((prev) => [...prev, { id: tempId, filename: f.name, size: f.size, uploading: true, progress: 0 }]);
      try {
        const form = new FormData();
        form.append("file", f);
        form.append("entity_type", entityType);
        form.append("entity_id", entityId);
        form.append("category", "Other");
        form.append("visibility", visibility);
        const { data } = await api.post("/attachments", form, {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (evt) => {
            if (evt.total) {
              const pct = Math.round((evt.loaded / evt.total) * 100);
              setAttachmentMeta((prev) => prev.map((a) => (a.id === tempId ? { ...a, progress: pct } : a)));
            }
          },
        });
        setAttachmentIds((prev) => [...prev, data.id]);
        setAttachmentMeta((prev) => prev.map((a) => (a.id === tempId ? { id: data.id, filename: data.filename, size: data.size_bytes, uploading: false } : a)));
      } catch (err) {
        apiErrorToast(err);
        setAttachmentMeta((prev) => prev.filter((a) => a.id !== tempId));
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (attId) => {
    setAttachmentIds((prev) => prev.filter((id) => id !== attId));
    setAttachmentMeta((prev) => prev.filter((a) => a.id !== attId));
  };

  const canSubmit = body.trim().length > 0 && !submitting && !attachmentMeta.some((a) => a.uploading);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload = {
        entity_type: entityType,
        entity_id: entityId,
        body: body.trim(),
        visibility,
        parent_comment_id: parentCommentId || null,
        mention_user_ids: mentionUsers.map((u) => u.id),
        mention_department_ids: mentionDepts.map((d) => d.id),
        attachment_ids: attachmentIds,
      };
      const { data } = await api.post("/comments", payload);
      toast.success(isReply ? "Reply posted" : "Comment posted");
      setBody("");
      setMentionUsers([]);
      setMentionDepts([]);
      setAttachmentIds([]);
      setAttachmentMeta([]);
      closePicker();
      onPosted?.(data);
    } catch (err) {
      apiErrorToast(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    canComment ? (
    <form
      ref={rootRef}
      onSubmit={submit}
      className={["rounded-md border border-amber-200 bg-white p-3 space-y-2 relative", isReply ? "border-brand-200 bg-brand-50/30" : ""].join(" ")}
      data-testid={isReply ? "comment-reply-composer" : "comment-composer"}
    >
      <Textarea
        ref={textareaRef}
        rows={isReply ? 2 : 3}
        value={body}
        onChange={onBodyChange}
        onKeyDown={onBodyKeyDown}
        placeholder={isReply ? "Write a reply…" : "Post a comment. Type @ to mention a user or department."}
        className="text-sm resize-y focus-visible:ring-1 focus-visible:ring-navy-900"
        data-testid={isReply ? "comment-reply-textarea" : "comment-composer-textarea"}
      />

      {/* Mention chips */}
      {(mentionUsers.length > 0 || mentionDepts.length > 0) && (
        <div className="flex flex-wrap gap-1.5" data-testid="composer-mention-chips">
          {mentionUsers.map((u) => (
            <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-brand-100 text-navy-900 text-[11px] px-2 py-0.5" data-testid={`mention-chip-user-${u.email}`}>
              @{u.name}
              <button type="button" onClick={() => removeUserMention(u.id)} className="hover:text-red-700">
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
          {mentionDepts.map((d) => (
            <span key={d.id} className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-800 text-[11px] px-2 py-0.5" data-testid={`mention-chip-dept-${d.code}`}>
              Dept: {d.name}
              <button type="button" onClick={() => removeDeptMention(d.id)} className="hover:text-red-700">
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Attachment previews */}
      {attachmentMeta.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachmentMeta.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 text-[11px] px-2 py-1 max-w-[220px]" data-testid={`composer-attachment-${a.filename}`}>
              <Paperclip className="h-3 w-3 text-gray-500 shrink-0" />
              <span className="truncate">{a.filename}</span>
              <span className="text-gray-400 shrink-0">{formatBytes(a.size)}</span>
              {a.uploading ? (
                <Loader2 className="h-3 w-3 animate-spin text-navy-900 shrink-0" />
              ) : (
                <button type="button" onClick={() => removeAttachment(a.id)} className="text-gray-500 hover:text-red-700 shrink-0">
                  <XIcon className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={openButtonPicker}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
            data-testid="composer-mention-button"
            title="Mention a user or department"
          >
            <AtSign className="h-3.5 w-3.5" /> @
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
            data-testid="composer-attach-button"
            title="Attach files"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => onFilesPicked(e.target.files)} accept={ALLOWED_UPLOAD_EXTENSIONS.join(",")} data-testid="composer-file-input" />

          {!isReply && (
            <div className="flex items-center gap-0 ml-1">
              <button
                type="button"
                onClick={() => setVisibility("Internal")}
                className={[
                  "inline-flex items-center gap-1 rounded-l-md border px-1.5 py-1 text-[11px]",
                  visibility === "Internal" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
                ].join(" ")}
                data-testid="visibility-internal"
                title="Internal — visible to teammates only"
              >
                <EyeOff className="h-3 w-3" /> Int
              </button>
              <button
                type="button"
                onClick={() => cvAllowed && setVisibility("Customer Visible")}
                disabled={!cvAllowed}
                title={cvAllowed ? "Customer Visible — will be shown to the customer" : "Only CRM/Legal/Management can post customer-visible comments."}
                className={[
                  "inline-flex items-center gap-1 rounded-r-md border -ml-px px-1.5 py-1 text-[11px]",
                  visibility === "Customer Visible" ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
                  !cvAllowed ? "opacity-50 cursor-not-allowed" : "",
                ].join(" ")}
                data-testid="visibility-customer-visible"
              >
                <Eye className="h-3 w-3" /> Cust
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {isReply && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancelReply} className="h-7 text-xs px-2" data-testid="reply-cancel">
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            disabled={!canSubmit}
            className="h-7 bg-brand-500 hover:bg-brand-600 text-white text-white text-xs px-3"
            data-testid={isReply ? "comment-reply-submit" : "comment-composer-submit"}
          >
            <Send className="h-3.5 w-3.5" /> {isReply ? "Reply" : "Post"}
          </Button>
        </div>
      </div>

      {/* Mention picker — anchored to the composer, appears above the toolbar */}
      {pickerOpen && (
        <div
          className="absolute left-3 right-3 bottom-full mb-1 z-30 rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden"
          data-testid="mention-picker"
          data-picker-mode={pickerMode}
        >
          {pickerMode === "button" && (
            <div className="p-2 border-b border-gray-100">
              <input
                ref={pickerQInputRef}
                value={pickerQ}
                onChange={(e) => {
                  setPickerQ(e.target.value);
                  setPickerIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setPickerIdx((i) => Math.min(flatItems.length - 1, i + 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setPickerIdx((i) => Math.max(0, i - 1)); }
                  else if (e.key === "Enter" && flatItems.length > 0) { e.preventDefault(); selectItem(flatItems[pickerIdx]); }
                  else if (e.key === "Escape") { e.preventDefault(); closePicker(); }
                }}
                placeholder="Search users or departments…"
                className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded"
                data-testid="mention-picker-input"
              />
            </div>
          )}
          {pickerMode === "inline" && (
            <div className="px-3 py-1.5 border-b border-gray-100 text-[10px] uppercase tracking-widest text-gray-400 flex items-center justify-between">
              <span>@{pickerQ || "…"}</span>
              <span>↑↓ Enter · Esc</span>
            </div>
          )}
          <div className="max-h-[240px] overflow-y-auto py-1">
            {flatItems.length === 0 && (
              <div className="px-3 py-4 text-center text-[11px] text-gray-500">No matches</div>
            )}
            {availableUsers.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400">Users</div>
                {availableUsers.map((u, i) => {
                  const idx = i;
                  const active = idx === pickerIdx;
                  const roleName = rolesById[u.role_id]?.name || "";
                  const deptName = deptsById[u.department_id]?.name || "";
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => selectItem({ kind: "user", item: u })}
                      onMouseEnter={() => setPickerIdx(idx)}
                      className={[
                        "w-full text-left px-3 py-1.5 text-xs",
                        active ? "bg-brand-50" : "hover:bg-brand-50/60",
                      ].join(" ")}
                      data-testid={`mention-picker-user-${u.email}`}
                    >
                      <div className="font-medium text-gray-900">{u.name}</div>
                      <div className="text-[10px] text-gray-500">{[roleName, deptName].filter(Boolean).join(" · ") || u.email}</div>
                    </button>
                  );
                })}
              </>
            )}
            {availableDepts.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400 mt-1">Departments</div>
                {availableDepts.map((d, i) => {
                  const idx = availableUsers.length + i;
                  const active = idx === pickerIdx;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => selectItem({ kind: "dept", item: d })}
                      onMouseEnter={() => setPickerIdx(idx)}
                      className={[
                        "w-full text-left px-3 py-1.5 text-xs",
                        active ? "bg-brand-50" : "hover:bg-brand-50/60",
                      ].join(" ")}
                      data-testid={`mention-picker-dept-${d.code}`}
                    >
                      <div className="font-medium text-gray-900">Dept: {d.name}</div>
                      <div className="text-[10px] text-gray-500">{d.code}</div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </form>
    ) : null
  );
}
