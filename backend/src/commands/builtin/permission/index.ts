import Permission from './Permission.js';

const permissionCommand = {
  name: 'permission',
  description: '管理细粒度权限控制',
  aliases: ['permissions', 'auth'],
  argumentHint: '<命令> [参数]',
  type: 'local' as const,
  load: () => Promise.resolve(Permission),
};

export { permissionCommand };
