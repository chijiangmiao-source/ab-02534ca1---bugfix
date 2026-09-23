// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

const containers: HTMLElement[] = [];

function render(): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => root.render(<App />));
  return { container, root };
}

afterEach(() => {
  for (const c of containers) {
    act(() => c.textContent && (c.innerHTML = ''));
  }
  containers.length = 0;
});

function setNative(el: Element, value: string): void {
  const proto = Object.getPrototypeOf(el) as unknown as { value: string };
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('App 页面', () => {
  it('渲染示例并显示 8 个割集与“无关”分类', () => {
    const { container } = render();
    const heading = container.textContent ?? '';
    expect(heading).toContain('最小割集（8 个）');
    expect(heading).toContain('无关');
    expect(heading).toContain('COSMIC');
    // 共享门计数表
    expect(heading).toContain('LOSS');
  });

  it('保留非法输入并显示可点击的问题定位', () => {
    const { container } = render();
    const gateArea = container.querySelectorAll('textarea')[1];
    setNative(gateArea, 'G AND A MISSING');
    expect(container.textContent).toContain('missing_reference');
  });

  it('超限输入显示 complexity_limit 警示且不输出割集', () => {
    const { container } = render();
    const areas = container.querySelectorAll('textarea');
    const ev: string[] = [];
    const lines: string[] = [];
    for (let g = 0; g < 7; g += 1) {
      const members = [`e${g}_0`, `e${g}_1`, `e${g}_2`];
      ev.push(...members);
      lines.push(`GRP${g} OR ${members.join(' ')}`);
    }
    lines.push('BIG AND GRP0 GRP1 GRP2 GRP3 GRP4 GRP5 GRP6');
    setNative(areas[0], ev.join('\n'));
    setNative(areas[1], lines.join('\n'));
    const topInput = container.querySelector('input')!;
    setNative(topInput, 'BIG');

    const text = container.textContent ?? '';
    expect(text).toContain('complexity_limit');
    expect(text).toContain('结论不完整');
    expect(text).not.toContain('最小割集（0 个）');
  });
});
