import * as Icons from './icons';

interface IconProps {
  name: string;
  className?: string;
  size?: number;
  color?: string;
}

const iconMap: Record<string, React.ComponentType<{ className?: string; size?: number; color?: string }>> = {
  home: Icons.HomeIcon,
  chat: Icons.ChatIcon,
  task: Icons.TaskIcon,
  dev: Icons.DevIcon,
  cron: Icons.CronIcon,
  knowledge: Icons.KnowledgeIcon,
  model: Icons.ModelIcon,
  skill: Icons.SkillIcon,
  file: Icons.FileIcon,
  mcp: Icons.McpIcon,
  channel: Icons.ChannelIcon,
  buddy: Icons.BuddyIcon,
  theme: Icons.ThemeIcon,
  settings: Icons.SettingsIcon,
  user: Icons.UserIcon,
  help: Icons.HelpIcon,
  plus: Icons.PlusIcon,
  delete: Icons.DeleteIcon,
  search: Icons.SearchIcon,
};

export default function Icon({ name, className = '', size = 24, color = 'currentColor' }: IconProps) {
  const IconComponent = iconMap[name.toLowerCase()];
  
  if (!IconComponent) {
    console.warn(`Icon "${name}" not found`);
    return null;
  }
  
  return <IconComponent className={className} size={size} color={color} />;
}