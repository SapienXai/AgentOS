"use client";

import { useRef, useState, type Ref } from "react";
import { ArrowUp } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import type { TaskRecord } from "@/lib/openclaw/types";
import type { TaskMessageReceipt } from "./task-live-presentation";

type PendingMessage = { key: string; message: string; createdAt: string };

export function TaskMessageComposer({ task, textareaRef, onReceipt }: {
  task: TaskRecord;
  textareaRef: Ref<HTMLTextAreaElement>;
  onReceipt: (receipt: TaskMessageReceipt) => void;
}) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState<PendingMessage | null>(null);
  const pending = useRef(Promise.resolve());
  const unconfirmed = useRef(new Set<string>());

  const send = (input: PendingMessage) => {
    const { key, message, createdAt } = input;
    const publish = (status: TaskMessageReceipt["status"], runId?: string) =>
      onReceipt({ id: key, message, timestamp: createdAt, status, runId });
    publish("sending");
    pending.current = pending.current.then(async () => {
      if (unconfirmed.current.has(message)) {
        publish("unconfirmed");
        return;
      }
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/control`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "message", message, dispatchId: task.dispatchId ?? null, idempotencyKey: key })
        });
        const payload = await response.json() as { error?: string; delivery?: string; historyPersistenceWarning?: string;
          result?: { result?: { runId?: string; status?: string; queued?: boolean } } };
        if (!response.ok && payload.delivery !== "unconfirmed" && response.status < 500) {
          publish("rejected");
          setFailed(input);
          setNotice(payload.error || "OpenClaw rejected this message.");
          return;
        }
        const result = payload.result?.result;
        if (!response.ok || !result?.runId) throw new Error("Delivery unconfirmed");
        publish(result.queued || result.status === "queued" ? "queued" : "accepted", result.runId);
        if (payload.historyPersistenceWarning) setNotice(payload.historyPersistenceWarning);
      } catch {
        unconfirmed.current.add(message);
        if (unconfirmed.current.size > 50) unconfirmed.current.delete(unconfirmed.current.values().next().value!);
        publish("unconfirmed");
        setNotice("Delivery could not be confirmed. Check the conversation for a reply before sending again.");
      }
    });
  };

  return (
    <div className="space-y-1.5">
      <form className="flex items-end gap-2 rounded-2xl border border-[var(--task-line)] bg-[var(--task-field)] p-1.5 transition-colors focus-within:border-violet-500"
        onSubmit={(event) => {
          event.preventDefault();
          const message = draft.trim();
          if (!message) return;
          if (unconfirmed.current.has(message)) {
            setNotice("Delivery of this message is still unconfirmed. Check the conversation for a reply.");
            return;
          }
          setDraft("");
          setNotice("");
          const key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          send({ key, message, createdAt: new Date().toISOString() });
        }}>
        <Textarea ref={textareaRef} aria-label="Additional task instruction" placeholder="Message the agent…"
          value={draft} maxLength={4000} rows={1} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          className="nowheel max-h-24 min-h-10 resize-none border-0 bg-transparent px-2 py-2.5 text-base text-inherit shadow-none [field-sizing:content] placeholder:text-[var(--task-muted)] focus-visible:ring-0 sm:text-sm" />
        <button type="submit" disabled={!draft.trim()} aria-label="Send task instruction"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-600 text-white outline-offset-2 transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-violet-500 disabled:opacity-40">
          <ArrowUp aria-hidden="true" className="size-[19px]" />
        </button>
      </form>
      {notice || failed ? <div className="flex items-start gap-2 px-1 text-xs text-[var(--task-muted)]">
        <p role="status">{notice}</p>
        {failed ? <button type="button" className="shrink-0 rounded font-medium underline underline-offset-2" onClick={() => {
          setFailed(null);
          setNotice("");
          send(failed);
        }}>Retry send</button> : null}
      </div> : null}
    </div>
  );
}
