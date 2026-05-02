import { useEffect, useState } from 'react';
import { useConfigStore } from '../../stores/configStore';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function Modal({ isOpen, onClose, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function ConfigPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const { config, loadConfig, setConfig } = useConfigStore();

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen, loadConfig]);

  const handleChange = (key: string, value: string) => {
    let parsedValue: unknown = value;

    if (value === 'true') parsedValue = true;
    else if (value === 'false') parsedValue = false;
    else if (!isNaN(Number(value)) && value !== '') parsedValue = Number(value);

    setConfig(key, parsedValue);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 w-12 h-12 bg-gray-700 hover:bg-gray-600 text-white rounded-full shadow-lg flex items-center justify-center text-xl"
        title="设置"
      >
        ⚙
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">设置</h2>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            {Object.entries(config).map(([key, value]) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {key}
                </label>
                <input
                  type="text"
                  defaultValue={String(value)}
                  onBlur={(e) => handleChange(key, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleChange(key, (e.target as HTMLInputElement).value);
                    }
                  }}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>

          {Object.keys(config).length === 0 && (
            <p className="text-gray-500 text-center py-4">暂无配置项</p>
          )}
        </div>
      </Modal>
    </>
  );
}

export default ConfigPanel;