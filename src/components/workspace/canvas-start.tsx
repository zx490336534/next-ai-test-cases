'use client';

import { ArrowRight, GitBranch, PencilLine } from 'lucide-react';
import { requirementExamples } from './chat-support';

export function CanvasStart({ compose, edit }: { compose: (example?: string) => void; edit: () => void }) {
  return (
    <div className="canvas-start mindmap-grid">
      <div className="canvas-intro">
        <div className="example-diagram" role="img" aria-label="团队邀请用例示例：有效邀请允许加入，撤销的邀请拒绝加入">
          <div className="example-root"><GitBranch size={17} aria-hidden="true" />团队邀请</div>
          <div className="example-branches" aria-hidden="true">
            <div className="example-node"><span className="example-marker p-one">P1</span>有效邀请允许加入</div>
            <div className="example-node"><span className="example-marker p-zero">P0</span>撤销后拒绝加入</div>
          </div>
        </div>
        <h2>从需求开始，生成用例脑图</h2>
        <p>把业务规则整理成用例、测试步骤和预期结果。</p>
        <div className="intro-actions">
          <button className="intro-primary" type="button" onClick={() => compose()}>输入需求<ArrowRight size={16} aria-hidden="true" /></button>
          <button className="intro-secondary" type="button" onClick={() => compose(requirementExamples[0].text)}>使用邀请示例</button>
        </div>
        <button className="intro-manual" type="button" onClick={edit}><PencilLine size={14} aria-hidden="true" />手动编辑空白脑图</button>
      </div>
    </div>
  );
}
