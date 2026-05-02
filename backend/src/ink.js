// Ink 组件导出
// 由于 Bun 1.3.12 无法解析 ink 7.x 的 ESM 导出，
// 这里提供简单的组件包装，实际渲染时使用真正的 ink
import React from 'react';

export const Box = ({ children, ...props }) => React.createElement('div', props, children);
export const Text = ({ children, ...props }) => React.createElement('span', props, children);
export const Newline = () => React.createElement('br');
export const Spacer = () => React.createElement('div', { style: { flex: 1 } });
export const Static = ({ children }) => React.createElement('div', null, children);
export const render = (element) => { console.log(element); };
