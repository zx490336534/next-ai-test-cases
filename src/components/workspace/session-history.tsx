'use client';

import { useState, type FormEvent } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, History, PanelLeftClose, Pencil, Trash2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { WorkspaceSummary } from '@/lib/workspaces/types';

type Placement = 'before' | 'after';

function HistoryRow({
  item, selected, disabled, editing, busy, draft, setDraft, startEditing, stopEditing, saveTitle, select,
  confirmDelete, askDelete, cancelDelete, remove,
}: {
  item: WorkspaceSummary;
  selected: boolean;
  disabled: boolean;
  editing: boolean;
  busy: boolean;
  draft: string | undefined;
  setDraft: (value: string) => void;
  startEditing: () => void;
  stopEditing: () => void;
  saveTitle: (event: FormEvent) => void;
  select: () => void;
  confirmDelete: boolean;
  askDelete: () => void;
  cancelDelete: () => void;
  remove: () => void;
}) {
  const { setNodeRef, setActivatorNodeRef, transform, transition, isDragging, attributes, listeners }
    = useSortable({ id: item.id, disabled: editing || busy });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition: transition }}
      data-session-id={item.id}
      className={'flex min-w-0 items-center gap-1 rounded-lg border p-1 ' +
        (selected ? 'border-[#b8d9d2] bg-[#eef7f4]' : 'border-transparent hover:bg-muted') +
        (isDragging ? ' relative z-10 bg-white shadow-sm' : '')}>
      {confirmDelete ? (
        <div className="min-w-0 flex-1 space-y-1.5 px-1 py-1" onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) cancelDelete();
        }}>
          <p className="text-xs text-red-700">删除会话和脑图？</p>
          <div className="flex gap-1.5">
            <button autoFocus type="button" disabled={busy} onClick={cancelDelete}
              className="rounded-md border bg-white px-2 py-1 text-xs">取消</button>
            <button type="button" disabled={busy} onClick={remove}
              aria-label={'确认删除 ' + item.title} title="删除后无法撤销"
              className="rounded-md bg-red-700 px-2 py-1 text-xs text-white hover:bg-red-800 disabled:opacity-50">删除</button>
          </div>
        </div>
      ) : draft === undefined ? (
        <>
          <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
            aria-label={'排序 ' + item.title} title="拖动排序" disabled={editing || busy}
            className="grid h-7 w-6 shrink-0 touch-none cursor-grab place-items-center rounded text-slate-500 hover:bg-white active:cursor-grabbing disabled:opacity-40">
            <GripVertical aria-hidden="true" className="h-4 w-4" />
          </button>
          <button type="button" onClick={select} disabled={disabled} aria-current={selected ? 'true' : undefined}
            title={item.title} className="min-w-0 flex-1 rounded text-left">
            <span className="block truncate text-sm font-medium">{item.title}</span>
          </button>
          <button type="button" aria-label={'重命名 ' + item.title} title="重命名" disabled={busy} onClick={startEditing}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-slate-600 hover:bg-white disabled:opacity-40">
            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label={'删除 ' + item.title} title="删除会话"
            disabled={busy || (selected && disabled)} onClick={askDelete}
            className="grid h-7 w-6 shrink-0 place-items-center rounded text-slate-500 hover:bg-white hover:text-red-700 disabled:opacity-40">
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={saveTitle} onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) stopEditing();
        }}>
          <Input autoFocus value={draft} maxLength={120} aria-label="会话名称" disabled={busy}
            className="h-8 min-w-0 flex-1 px-2" onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" aria-label="保存名称" title="保存名称" disabled={busy || !draft.trim()}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-primary hover:bg-white disabled:opacity-40">
            <Check aria-hidden="true" className="h-4 w-4" />
          </button>
          <button type="button" aria-label="取消重命名" title="取消重命名" disabled={busy} onClick={stopEditing}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-slate-600 hover:bg-white">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </form>
      )}
    </li>
  );
}

export function SessionHistory({ items, selected, disabled, select, rename, reorder, remove, collapse }: {
  items: WorkspaceSummary[];
  selected: string;
  disabled: boolean;
  select: (id: string) => void;
  rename: (id: string, title: string) => Promise<void>;
  reorder: (id: string, targetId: string, placement: Placement) => Promise<void>;
  remove: (id: string) => Promise<void>;
  collapse?: () => void;
}) {
  const [editing, setEditing] = useState<{ id: string; title: string }>();
  const [deleting, setDeleting] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    if (!editing?.title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await rename(editing.id, editing.title.trim());
      setEditing(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '会话重命名失败');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSession() {
    if (!deleting || busy || (selected === deleting && disabled)) return;
    setBusy(true);
    setError('');
    try {
      await remove(deleting);
      setDeleting(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '会话删除失败');
    } finally {
      setBusy(false);
    }
  }

  async function sort({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || busy) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;
    setBusy(true);
    setError('');
    try {
      await reorder(items[from].id, items[to].id, from < to ? 'after' : 'before');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '会话排序失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside aria-label="历史对话" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[#d6e6e2] bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-[#e1ebe8] bg-[#f3f8f6] px-3 py-2.5">
        <h2 className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-[#183637]">
          <History aria-hidden="true" className="h-4 w-4 shrink-0" />历史对话
        </h2>
        {collapse && <button id="collapse-history" type="button" aria-label="折叠历史对话" title="折叠历史对话" onClick={collapse}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-white text-slate-600 hover:bg-muted">
          <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
        </button>}
      </header>
      <DndContext id="workspace-history-sort" sensors={sensors} collisionDetection={closestCenter}
        onDragEnd={(event) => { void sort(event); }}>
        <SortableContext items={items.map(({ id }) => id)} strategy={verticalListSortingStrategy}>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {items.map((item) => (
              <HistoryRow key={item.id} item={item} selected={item.id === selected} disabled={disabled} editing={!!editing || !!deleting}
                busy={busy} draft={item.id === editing?.id ? editing.title : undefined}
                setDraft={(title) => setEditing({ id: item.id, title })}
                startEditing={() => { setError(''); setDeleting(undefined); setEditing({ id: item.id, title: item.title }); }}
                stopEditing={() => setEditing(undefined)} saveTitle={saveTitle}
                select={() => { if (item.id !== selected) select(item.id); }}
                confirmDelete={deleting === item.id} cancelDelete={() => setDeleting(undefined)}
                askDelete={() => { setError(''); setEditing(undefined); setDeleting(item.id); }}
                remove={() => { void deleteSession(); }} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {error ? <p role="alert" className="border-t px-3 py-2 text-xs text-red-700">{error}</p> : null}
    </aside>
  );
}
