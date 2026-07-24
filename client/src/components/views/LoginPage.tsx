import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../stores/authStore";
import { useConfigStore } from "../../stores/configStore";
import { handleClientError } from "../../utils/handleError";

function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, register, isLoading, error, clearError } = useAuthStore();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clearError();

    if (!username.trim()) {
      setFormError(t("user.errorUsernameRequired"));
      return;
    }

    if (!password) {
      setFormError(t("user.errorPasswordRequired"));
      return;
    }

    if (isRegisterMode) {
      if (password !== confirmPassword) {
        setFormError(t("user.errorPasswordMismatch"));
        return;
      }

      if (password.length < 6) {
        setFormError(t("user.errorPasswordTooShort"));
        return;
      }

      try {
        await register(username, password, email || undefined);
        navigate("/");
      } catch (e) {
        handleClientError(e, {
          module: "components:views:Login",
          action: "register",
        });
      }
    } else {
      try {
        await login(username, password);
        navigate("/");
      } catch (e) {
        handleClientError(e, {
          module: "components:views:Login",
          action: "login",
        });
      }
    }
  };

  const toggleMode = () => {
    setIsRegisterMode(!isRegisterMode);
    setFormError(null);
    clearError();
    setPassword("");
    setConfirmPassword("");
  };

  return (
    <div
      className={`min-h-screen flex items-center justify-center ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div
        className={`max-w-md w-full mx-4 p-8 rounded-xl border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} shadow-lg`}
      >
        <div className="text-center mb-8">
          <div
            className={`w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center ${isDark ? "bg-blue-600" : "bg-blue-500"}`}
          >
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1
            className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {isRegisterMode ? t("user.register") : t("user.login")}
          </h1>
          <p
            className={`mt-2 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {isRegisterMode ? t("user.registerHint") : t("user.loginHint")}
          </p>
        </div>

        {(formError || error) && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-red-50 text-red-600 border border-red-200"}`}
          >
            {formError || error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              className={`block text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"} mb-1`}
            >
              {t("user.username")}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("user.usernamePlaceholder")}
              className={`w-full px-3 py-2 text-sm border rounded-lg ${
                isDark
                  ? "bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400 focus:ring-blue-500"
                  : "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:ring-blue-500"
              } focus:outline-none focus:ring-2`}
            />
          </div>

          <div>
            <label
              className={`block text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"} mb-1`}
            >
              {t("user.password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("user.passwordPlaceholder")}
              className={`w-full px-3 py-2 text-sm border rounded-lg ${
                isDark
                  ? "bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400 focus:ring-blue-500"
                  : "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:ring-blue-500"
              } focus:outline-none focus:ring-2`}
            />
          </div>

          {isRegisterMode && (
            <>
              <div>
                <label
                  className={`block text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"} mb-1`}
                >
                  {t("user.confirmPassword")}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t("user.confirmPasswordPlaceholder")}
                  className={`w-full px-3 py-2 text-sm border rounded-lg ${
                    isDark
                      ? "bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400 focus:ring-blue-500"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:ring-blue-500"
                  } focus:outline-none focus:ring-2`}
                />
              </div>

              <div>
                <label
                  className={`block text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"} mb-1`}
                >
                  {t("user.emailOptional")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("user.emailOptionalPlaceholder")}
                  className={`w-full px-3 py-2 text-sm border rounded-lg ${
                    isDark
                      ? "bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400 focus:ring-blue-500"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:ring-blue-500"
                  } focus:outline-none focus:ring-2`}
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-2.5 px-4 rounded-lg font-medium text-white transition-colors ${
              isLoading
                ? "bg-blue-400 cursor-not-allowed"
                : isDark
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isLoading
              ? t("user.processing")
              : isRegisterMode
                ? t("user.register")
                : t("user.login")}
          </button>
        </form>

        <div
          className={`mt-6 text-center text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
        >
          {isRegisterMode ? t("user.hasAccount") : t("user.noAccount")}
          <button
            onClick={toggleMode}
            className={`ml-1 font-medium ${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"}`}
          >
            {isRegisterMode ? t("user.loginNow") : t("user.registerNow")}
          </button>
        </div>

        {!isRegisterMode && (
          <>
            <div
              className={`mt-4 text-center text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {t("user.or")}{" "}
              <button
                onClick={() => navigate("/apikeys")}
                className={`font-medium ${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"}`}
              >
                {t("user.loginWithApiKey")}
              </button>
            </div>

            <div className={`mt-6`}>
              <div
                className={`relative flex items-center justify-center ${isDark ? "text-gray-600" : "text-gray-300"}`}
              >
                <div className={`absolute inset-0 flex items-center`}>
                  <div
                    className={`w-full border-t ${isDark ? "border-gray-700" : "border-gray-200"}`}
                  ></div>
                </div>
                <span
                  className={`relative z-10 px-4 ${isDark ? "bg-gray-800 text-gray-400" : "bg-white text-gray-500"} text-sm`}
                >
                  {t("user.orLoginWithThirdParty")}
                </span>
              </div>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => {}}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border transition-colors ${
                    isDark
                      ? "bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300"
                      : "bg-white border-gray-200 hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  <span className="text-sm font-medium">Google</span>
                </button>

                <button
                  onClick={() => {}}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border transition-colors ${
                    isDark
                      ? "bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300"
                      : "bg-white border-gray-200 hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"
                    />
                  </svg>
                  <span className="text-sm font-medium">GitHub</span>
                </button>

                <button
                  onClick={() => {}}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border transition-colors ${
                    isDark
                      ? "bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300"
                      : "bg-white border-gray-200 hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#0078D4">
                    <path d="M23.127 12.332a1.125 1.125 0 010-2.25l-7.592-3.978a1.125 1.125 0 01-.664-.008l-.003.001a1.125 1.125 0 01-.664 2.063l4.713 2.48v6.853l-4.713 2.48a1.125 1.125 0 01-.664 0 1.125 1.125 0 01-.664-2.063l7.592-3.978z" />
                    <path d="M13.5 20.83a1.125 1.125 0 01-1.125-1.125V4.295a1.125 1.125 0 012.25 0v15.41a1.125 1.125 0 01-1.125 1.125z" />
                  </svg>
                  <span className="text-sm font-medium">Azure</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default LoginPage;
