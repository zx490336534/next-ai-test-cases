'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SavedWorkspace, WorkspaceSnapshot, WorkspaceSummary } from '@/lib/workspaces/types';
import { SessionRequestError, sessionRequest } from './session-client';
import { acknowledgedWrite, newWorkspaceWriteId, workspaceSnapshot, writeWorkspaceDraft } from './workspace-draft';

export function useSessionSave(
  session: SavedWorkspace, snapshot: WorkspaceSnapshot, onSaved: (summary: WorkspaceSummary) => void,
  { initialWriteIds, initiallyDeleted = false, protectDraft, capture }: {
    initialWriteIds?: string[];
    initiallyDeleted?: boolean;
    protectDraft?: boolean;
    capture?: (snapshot: WorkspaceSnapshot) => WorkspaceSnapshot | undefined;
  } = {},
) {
  const [confirmed, setConfirmed] = useState(() => JSON.stringify(workspaceSnapshot(session)));
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState(initiallyDeleted);
  const targetDeleted = useRef(initiallyDeleted);
  const [saving, setSaving] = useState(Boolean(initialWriteIds?.length));
  const serialized = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const version = useRef(session.version);
  const lastSaved = useRef(confirmed);
  const writing = useRef<string | undefined>(undefined);
  const previousPageWrites = useRef(initialWriteIds ?? []);
  const recoveryAvailable = useRef(true);
  const mounted = useRef(true);
  const pending = useRef<Promise<boolean> | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ snapshot, serialized });

  const syncDraft = useCallback(() => {
    if (!mounted.current) return;
    const writeIds = [...previousPageWrites.current, ...(writing.current ? [writing.current] : [])];
    const dirty = targetDeleted.current || latest.current.serialized !== lastSaved.current || writeIds.length > 0;
    recoveryAvailable.current = !protectDraft && writeWorkspaceDraft(session.id, dirty ? {
      version: version.current, writeIds, snapshot: latest.current.snapshot,
    } : undefined);
  }, [protectDraft, session.id]);

  const flush = useCallback((value?: WorkspaceSnapshot, keepalive = false) => {
    clearTimeout(timer.current);
    if (value) latest.current = { snapshot: value, serialized: JSON.stringify(value) };
    syncDraft();

    async function put(draft: WorkspaceSnapshot, writeId: string) {
      const body = JSON.stringify({ version: version.current, writeId, ...draft });
      return sessionRequest<WorkspaceSummary & { version: number }>(session.id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
        keepalive: keepalive && new TextEncoder().encode(body).length <= 60 * 1024,
      });
    }

    const save = async (retry = true): Promise<boolean> => {
      if (targetDeleted.current) return false;
      const value = latest.current;
      if (value.serialized === lastSaved.current && !writing.current && !previousPageWrites.current.length) return true;
      const writeId = writing.current ??= newWorkspaceWriteId();
      syncDraft();
      setSaving(true);
      setError('');
      try {
        const saved = await put(value.snapshot, writeId);
        version.current = saved.version;
        lastSaved.current = value.serialized;
        writing.current = undefined;
        previousPageWrites.current = [];
        syncDraft();
        onSaved(saved);
        setConfirmed(value.serialized);
        return true;
      } catch (cause) {
        if (cause instanceof SessionRequestError && cause.status === 404) {
          targetDeleted.current = true;
          setDeleted(true);
          syncDraft();
          return false;
        }
        if (retry && !keepalive && cause instanceof SessionRequestError && cause.status === 409) {
          const saved = await sessionRequest<SavedWorkspace>(session.id).catch(() => undefined);
          if (saved && acknowledgedWrite(saved, version.current, [...previousPageWrites.current, writeId])) {
            version.current = saved.version;
            lastSaved.current = JSON.stringify(workspaceSnapshot(saved));
            writing.current = undefined;
            previousPageWrites.current = [];
            syncDraft();
            onSaved(saved);
            setConfirmed(lastSaved.current);
            return await save(false);
          }
        }
        setError(cause instanceof Error ? cause.message : '会话保存失败，请重试');
        return false;
      } finally {
        setSaving(false);
      }
    };

    const task = pending.current ? pending.current.then(() => save()) : save();
    pending.current = task;
    void task.then(() => {
      if (pending.current === task) pending.current = undefined;
    });
    return task;
  }, [session.id, onSaved, syncDraft]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    latest.current = { snapshot, serialized };
    syncDraft();
    if (!targetDeleted.current && (pending.current || writing.current || previousPageWrites.current.length || serialized !== lastSaved.current)) {
      timer.current = setTimeout(() => { void flush(); }, 250);
    }
    return () => clearTimeout(timer.current);
  }, [snapshot, serialized, flush, syncDraft]);

  useEffect(() => {
    function captureEditor() {
      const current = capture?.(latest.current.snapshot);
      if (current) {
        latest.current = { snapshot: current, serialized: JSON.stringify(current) };
        syncDraft();
      }
    }
    const saveBeforeLeaving = () => {
      if (document.visibilityState === 'hidden') {
        captureEditor();
        void flush(undefined, true);
      }
    };
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      captureEditor();
      if (!recoveryAvailable.current && (targetDeleted.current || writing.current || previousPageWrites.current.length || latest.current.serialized !== lastSaved.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', saveBeforeLeaving);
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => {
      document.removeEventListener('visibilitychange', saveBeforeLeaving);
      window.removeEventListener('beforeunload', warnBeforeLeaving);
    };
  }, [capture, flush, syncDraft]);

  const status = error ? 'error' : saving || serialized !== confirmed ? 'saving' : 'saved';
  function copyWriteId(renew = false) {
    if (renew) writing.current = newWorkspaceWriteId();
    const id = writing.current ??= previousPageWrites.current.at(-1) ?? newWorkspaceWriteId();
    syncDraft();
    return id;
  }
  return { status, error, deleted, flush, copyWriteId };
}
