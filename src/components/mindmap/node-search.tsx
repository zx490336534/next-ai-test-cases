'use client';

import { useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { MindMapNode } from '@/lib/agent/types';

export function NodeSearch({ tree, onSelect }: { tree: MindMapNode; onSelect: (id: string) => void }) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState(-1);
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    const result: string[] = [];
    function visit(node: MindMapNode) {
      if (node.data.uid && node.data.text.toLowerCase().includes(term)) result.push(node.data.uid);
      node.children.forEach(visit);
    }
    if (term) tree.children.forEach(visit);
    return result;
  }, [tree, query]);

  function close() {
    if (disclosure.current) disclosure.current.open = false;
  }

  return (
    <details ref={disclosure} className="relative" onToggle={(event) => {
      if (event.currentTarget.open) input.current?.focus();
    }}>
      <summary title="查找节点" aria-label="查找节点"
        className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-md border border-input bg-white hover:bg-muted">
        <Search className="h-4 w-4" aria-hidden="true" />
      </summary>
      <form role="search" aria-label="查找脑图节点" onKeyDown={(event) => {
        if (event.key === 'Escape') { close(); event.stopPropagation(); }
      }} onSubmit={(event) => {
        event.preventDefault();
        if (!matches.length) return;
        const next = (position + 1) % matches.length;
        setPosition(next);
        onSelect(matches[next]);
      }} className="absolute right-0 z-40 mt-2 flex w-64 items-center gap-1 rounded-lg border border-[#e0e2ea] bg-white p-2 shadow-lg">
        <Input ref={input} type="search" aria-label="节点关键字" placeholder="搜索脑图文字" className="h-8 min-w-0"
          value={query} onChange={(event) => { setQuery(event.target.value); setPosition(-1); }} />
        <button type="submit" title="定位下一处" aria-label="定位下一处" disabled={!matches.length}
          className="h-8 rounded px-1.5 text-xs text-[#534ca6] hover:bg-muted disabled:opacity-40">
          {Math.min(position + 1, matches.length)}/{matches.length}
        </button>
        <button type="button" title="关闭搜索" aria-label="关闭搜索" onClick={close}
          className="grid h-8 w-7 shrink-0 place-items-center rounded hover:bg-muted">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </details>
  );
}
