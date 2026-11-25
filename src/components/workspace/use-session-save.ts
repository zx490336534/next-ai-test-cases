'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedWorkspace, WorkspaceSnapshot, WorkspaceSummary } from '@/lib/workspaces/types';
import { sessionRequest } from './session-client';

export function useSessionSave(session: SavedWorkspace, snapshot: WorkspaceSnapshot, onSaved: (summary: WorkspaceSummary) => void) {
  const [status, setStatus] = useState<'saving' | 'saved' | 'error'>('saved');
  const [error, setError] = useState('');
  const version = useRef(session.version);
  const lastSaved = useRef(JSON.stringify({ messages: session.messages, mindMap: session.mindMap }));
  const pending = useRef<Promise<boolean> | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(snapshot);

  const flush = useCallback((value = latest.current, keepalive = false) => {
    clearTimeout(timer.current);
    const serialized = JSON.stringify(value);
    const save = async () => {
      if (serialized === lastSaved.current) return true;
      setStatus('saving');
      setError('');
      try {
        const body = JSON.stringify({ version: version.current, ...value });
        const saved = await sessionRequest<WorkspaceSummary & { version: number }>(session.id, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
          keepalive: keepalive && new TextEncoder().encode(body).length <= 60 * 1024,
        });
        version.current = saved.version;
        lastSaved.current = serialized;
        onSaved(saved);
        setStatus('saved');
        return true;
      } catch (cause) {
        setStatus('error');
        setError(cause instanceof Error ? cause.message : '会话保存失败，请重试');
        return false;
      }
    };
    const task = pending.current ? pending.current.then(save) : save();
    pending.current = task;
    void task.then(() => {
      if (pending.current === task) pending.current = undefined;
    });
    return task;
  }, [session.id, onSaved]);

  useEffect(() => {
    latest.current = snapshot;
    if (pending.current || JSON.stringify(snapshot) !== lastSaved.current) {
      timer.current = setTimeout(() => { void flush(); }, 250);
    }
    return () => clearTimeout(timer.current);
  }, [snapshot, flush]);

  useEffect(() => {
    const saveBeforeLeaving = () => {
      if (document.visibilityState === 'hidden') void flush(undefined, true);
    };
    document.addEventListener('visibilitychange', saveBeforeLeaving);
    return () => document.removeEventListener('visibilitychange', saveBeforeLeaving);
  }, [flush]);

  return { status, error, flush };
}
