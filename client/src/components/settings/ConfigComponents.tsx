interface ConfigSectionProps {
  title: string;
  description?: string;
  isDark: boolean;
  children: React.ReactNode;
}

function ConfigSection({ title, description, isDark, children }: ConfigSectionProps) {
  return (
    <section className={`px-6 py-5 border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
      <h3 className="text-base font-semibold mb-1">
        {title}
      </h3>
      {description && (
        <p className={`text-xs mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

interface ConfigItemProps {
  label: string;
  description?: string;
  isDark: boolean;
  children: React.ReactNode;
}

function ConfigItem({ label, description, isDark, children }: ConfigItemProps) {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between">
        <div>
          <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
            {label}
          </label>
          {description && (
            <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {description}
            </p>
          )}
        </div>
        <div className="ml-4">{children}</div>
      </div>
    </div>
  );
}

interface ToggleConfigProps {
  isDark: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function ToggleConfig({ isDark, checked, onChange, disabled }: ToggleConfigProps) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors ${
        checked
          ? 'bg-blue-500'
          : isDark
          ? 'bg-gray-600'
          : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

interface TextConfigProps {
  isDark: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'number';
  disabled?: boolean;
  className?: string;
}

function TextConfig({ isDark, value, onChange, placeholder, type = 'text', disabled, className = 'w-64' }: TextConfigProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm border rounded ${
        isDark
          ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-500'
          : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    />
  );
}

interface SelectConfigProps {
  isDark: boolean;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}

function SelectConfig({ isDark, value, onChange, options, disabled, className = 'w-48' }: SelectConfigProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm border rounded ${
        isDark
          ? 'bg-gray-700 border-gray-600 text-white'
          : 'bg-white border-gray-300 text-gray-900'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export { ConfigSection, ConfigItem, ToggleConfig, TextConfig, SelectConfig };