'use client';

import { useState, type FormEvent } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, Ellipsis, GripVertical, History, PanelLeftClose, Pencil, Trash2, X } from 'lucide-react';
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
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      data-session-id={item.id}
      className={'group/history relative min-w-0 rounded-md ' +
        (selected ? 'bg-[#eeedfb] text-[#454080] before:absolute before:left-0 before:top-3 before:h-4 before:w-[3px] before:rounded-full before:bg-[#5752a3]'
          : 'text-[#41465a] hover:bg-[#f6f6f9]') + (isDragging ? ' z-10 shadow-md' : '')}>
      {confirmDelete ? (
        <div className="min-w-0 space-y-2 px-3 py-2" onKeyDown={(event) => {
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
          <div className="flex min-h-10 items-center gap-0.5 ps-1.5 pe-8 pointer-coarse:pe-12">
            <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
              aria-label={'排序 ' + item.title} title="拖动排序" disabled={editing || busy}
              className="grid size-6 shrink-0 touch-none cursor-grab place-items-center rounded text-[#8c90a1] hover:text-[#5752a3] focus-visible:outline-[#5752a3] active:cursor-grabbing disabled:opacity-40">
              <GripVertical aria-hidden="true" className="size-3.5" />
            </button>
            <button type="button" onClick={select} disabled={disabled} aria-current={selected ? 'true' : undefined}
              title={item.title} className="group/title min-w-0 flex-1 rounded py-2 text-start text-[13px] leading-5 focus-visible:outline-[#5752a3] aria-[current=true]:font-semibold">
              <span className="block truncate group-focus-visible/title:whitespace-normal group-has-[details[open]]/history:whitespace-normal wrap-anywhere">{item.title}</span>
            </button>
          </div>
          <details name="workspace-history-actions" className="group/actions">
            <summary aria-label={'更多操作 ' + item.title} title="更多操作"
              className="absolute end-1 top-1.5 grid size-7 cursor-pointer list-none place-items-center rounded text-[#697084] hover:bg-white hover:text-[#5752a3] focus-visible:outline-[#5752a3] group-open/actions:bg-white pointer-coarse:top-0 [&::-webkit-details-marker]:hidden">
              <Ellipsis aria-hidden="true" className="size-4" />
            </summary>
            <div className="flex flex-wrap gap-1 px-2 pb-2 pt-0.5 text-xs">
              <button type="button" aria-label={'重命名 ' + item.title} disabled={busy} onClick={startEditing}
                className="inline-flex min-h-7 items-center gap-1.5 rounded px-2 text-[#454080] hover:bg-white focus-visible:outline-[#5752a3] disabled:opacity-40">
                <Pencil aria-hidden="true" className="size-3.5" />重命名
              </button>
              <button type="button" aria-label={'删除 ' + item.title} disabled={busy || (selected && disabled)} onClick={askDelete}
                className="inline-flex min-h-7 items-center gap-1.5 rounded px-2 text-[#697084] hover:bg-white hover:text-red-700 focus-visible:outline-[#5752a3] disabled:opacity-40">
                <Trash2 aria-hidden="true" className="size-3.5" />删除
              </button>
            </div>
          </details>
        </>
      ) : (
        <form className="flex min-w-0 items-center gap-1 p-1.5" onSubmit={saveTitle} onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) stopEditing();
        }}>
          <Input autoFocus value={draft} maxLength={120} aria-label="会话名称" disabled={busy}
            className="h-8 min-w-0 flex-1 px-2" onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" aria-label="保存名称" title="保存名称" disabled={busy || !draft.trim()}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-[#5752a3] hover:bg-white disabled:opacity-40">
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
    <aside aria-label="历史对话" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[#e0e2ea] px-3">
        <h2 className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm font-semibold text-[#25283d]">
          <History aria-hidden="true" className="h-4 w-4 shrink-0 text-[#697084]" />历史对话
        </h2>
        {collapse && <button id="collapse-history" type="button" aria-label="折叠历史对话" title="折叠历史对话" onClick={collapse}
          className="grid size-7 shrink-0 place-items-center rounded-md text-[#697084] hover:bg-[#eeedfb] hover:text-[#5752a3] focus-visible:outline-[#5752a3]">
          <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
        </button>}
      </header>
      <DndContext id="workspace-history-sort" sensors={sensors} collisionDetection={closestCenter}
        onDragEnd={(event) => { void sort(event); }}>
        <SortableContext items={items.map(({ id }) => id)} strategy={verticalListSortingStrategy}>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
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
