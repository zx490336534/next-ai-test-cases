'use client';

import { useEffect, useRef, useState } from 'react';
import type { MindMapNode } from '@/lib/agent/types';

type Props = {
  data: MindMapNode | null;
};

export function MindMapView({ data }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<any>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function render() {
      if (!containerRef.current || !data) {
        return;
      }

      try {
        setRenderError(null);
        const smm = await import('simple-mind-map');
        const MindMap = smm.default ?? (smm as { MindMap?: any }).MindMap;

        if (!MindMap) {
          throw new Error('simple-mind-map 加载失败');
        }

        if (!mounted || !containerRef.current) {
          return;
        }

        // 避免不同版本 API 差异导致 setData 失效，直接重建实例最稳妥
        if (instanceRef.current) {
          instanceRef.current.destroy();
          instanceRef.current = null;
        }
        containerRef.current.innerHTML = '';

        const MindMapCtor = MindMap as new (opts: any) => any;
        instanceRef.current = new MindMapCtor({
          el: containerRef.current,
          data,
          theme: 'default',
          layout: 'logicalStructure',
          fit: true,
        } as any);

        requestAnimationFrame(() => {
          instanceRef.current?.view?.fit?.();
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '脑图渲染失败';
        setRenderError(message);
      }
    }

    void render();

    return () => {
      mounted = false;
    };
  }, [data]);

  useEffect(() => {
    return () => {
      if (instanceRef.current) {
        instanceRef.current.destroy();
        instanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-lg border bg-white">
      {renderError ? <p className="absolute left-3 top-3 z-10 text-xs text-red-600">{renderError}</p> : null}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
