"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../AuthProvider";
import {
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Save,
  RotateCw,
  ExternalLink,
  Eye,
  EyeOff,
  Sparkles,
  Send,
  Globe,
  ShieldCheck,
  Cpu,
  Loader2,
  Info,
  Check
} from "lucide-react";

interface SettingItem {
  key: string;
  label: string;
  category: string;
  is_secret: boolean;
  is_set: boolean;
  masked_value: string;
  raw_value: string;
  description: string;
  placeholder: string;
  docs_url: string;
  source: string;
}

interface TestResult {
  ok: boolean;
  message: string;
  data?: any;
}

export default function IntegrationsSettingsPage() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form values (storing user-entered overrides)
  const [formData, setFormData] = useState<Record<string, string>>({});
  // Track visibility toggles for secret fields
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  // Testing states
  const [testingService, setTestingService] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const loadSettings = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/settings/integrations`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error("Failed to load integrations settings");
      }
      const data: SettingItem[] = await res.json();
      setSettings(data);

      // Pre-fill form values with raw non-secret values
      const initialForm: Record<string, string> = {};
      data.forEach(item => {
        if (!item.is_secret && item.raw_value) {
          initialForm[item.key] = item.raw_value;
        }
      });
      setFormData(initialForm);
    } catch (err) {
      console.error("Error loading settings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, [getToken, API_URL]);

  const handleInputChange = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveSuccess(false);
      const token = await getToken();

      // Only send values that have been typed into or edited
      const payload: Record<string, string> = {};
      Object.entries(formData).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v.trim() !== "") {
          payload[k] = v.trim();
        }
      });

      const res = await fetch(`${API_URL}/api/settings/integrations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ settings: payload })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to save settings");
      }

      const resData = await res.json();
      if (resData.settings) {
        setSettings(resData.settings);
      } else {
        await loadSettings();
      }

      setSaveSuccess(true);
      // Clear sensitive text inputs after saving
      const clearedSecrets: Record<string, string> = { ...formData };
      settings.forEach(s => {
        if (s.is_secret && clearedSecrets[s.key]) {
          delete clearedSecrets[s.key];
        }
      });
      setFormData(clearedSecrets);

      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      alert(`Ошибка при сохранении: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async (serviceName: string, settingKey: string) => {
    try {
      setTestingService(serviceName);
      const token = await getToken();

      // If user typed a new unsaved key into the input, pass it for testing
      const overrideVal = formData[settingKey] || "";

      const res = await fetch(`${API_URL}/api/settings/integrations/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          service: serviceName,
          value: overrideVal || null
        })
      });

      const result: TestResult = await res.json();
      setTestResults(prev => ({ ...prev, [serviceName]: result }));
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [serviceName]: { ok: false, message: `Ошибка сети: ${err.message}` }
      }));
    } finally {
      setTestingService(null);
    }
  };

  const getSettingItem = (key: string): SettingItem | undefined => {
    return settings.find(s => s.key === key);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-lime-400" />
        <p className="text-sm text-zinc-400">Загрузка конфигурации интеграций...</p>
      </div>
    );
  }

  // Pre-fetch items
  const uploadPostItem = getSettingItem("UPLOAD_POST_API_KEY");
  const tgTokenItem = getSettingItem("TELEGRAM_BOT_TOKEN");
  const tgUsersItem = getSettingItem("TELEGRAM_ALLOWED_USERS");
  const geminiItem = getSettingItem("GEMINI_API_KEY");
  const dashboardItem = getSettingItem("DASHBOARD_URL");

  // Allowed users count calculation
  const allowedRaw = formData["TELEGRAM_ALLOWED_USERS"] !== undefined 
    ? formData["TELEGRAM_ALLOWED_USERS"] 
    : (tgUsersItem?.raw_value || "");
  const allowedCount = allowedRaw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean).length;

  return (
    <div className="space-y-8 animate-fade-in max-w-5xl pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-extrabold text-lime-400 tracking-tight">
              API Keys & Integrations
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-lime-400/10 text-lime-400 border border-lime-400/20">
              Settings
            </span>
          </div>
          <p className="text-zinc-400 text-sm mt-1.5">
            Управление внешними API-ключами, токеном Telegram-бота и системными переменными без необходимости редактировать серверные файлы.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadSettings}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl text-sm font-medium border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 transition flex items-center gap-2 cursor-pointer"
            title="Обновить текущие значения"
          >
            <RotateCw className="w-4 h-4 text-zinc-400" /> Обновить
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-lime-400 hover:bg-lime-500 text-zinc-950 transition shadow-lg shadow-lime-950/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-zinc-950" /> Сохранение...
              </>
            ) : saveSuccess ? (
              <>
                <Check className="w-4 h-4 text-zinc-950" /> Сохранено!
              </>
            ) : (
              <>
                <Save className="w-4 h-4 text-zinc-950" /> Сохранить изменения
              </>
            )}
          </button>
        </div>
      </div>

      {/* Handover Notice Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-lime-950/30 via-zinc-900/40 to-zinc-900/30 border border-lime-500/20 flex items-start gap-3.5">
        <Info className="w-5 h-5 text-lime-400 shrink-0 mt-0.5" />
        <div className="text-xs text-zinc-300 leading-relaxed space-y-1">
          <span className="font-semibold text-lime-400 text-sm block">
            Удобная передача проекта новой команде
          </span>
          <p>
            Все указанные здесь переменные сохраняются в базе данных и автоматически подхватываются планировщиком публикаций, Telegram-ботом и воркерами.
            Новой команде достаточно указать свои ключи ниже и нажать <b>«Сохранить»</b> — перезапуск сервера не требуется.
          </p>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-4 rounded-xl bg-lime-500/10 border border-lime-500/30 text-lime-400 text-sm flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-lime-400 shrink-0" />
          <span>Настройки успешно сохранены в защищенную базу данных и активированы в системе!</span>
        </div>
      )}

      {/* Grid of Integration Cards */}
      <div className="space-y-6">

        {/* 1. UPLOAD POST API */}
        <div className="rounded-2xl border border-zinc-800 bg-[#0d0d12]/90 backdrop-blur-xl p-6 shadow-xl relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-zinc-800/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white">Upload Post API (Мультипостинг)</h2>
                  {uploadPostItem?.is_set ? (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Настроен ({uploadPostItem.source})
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Не задан
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Публикация готовых видео в Instagram Reels, TikTok и YouTube Shorts.
                </p>
              </div>
            </div>

            <a
              href="https://upload-post.com"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 hover:underline shrink-0"
            >
              Личный кабинет upload-post.com <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="mt-5 space-y-3">
            <div>
              <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between mb-1.5">
                <span>API-ключ (JWT Token)</span>
                {uploadPostItem?.is_set && (
                  <span className="text-[11px] text-zinc-500 font-mono">
                    Текущий: {uploadPostItem.masked_value}
                  </span>
                )}
              </label>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showSecrets["UPLOAD_POST_API_KEY"] ? "text" : "password"}
                    value={formData["UPLOAD_POST_API_KEY"] ?? ""}
                    onChange={e => handleInputChange("UPLOAD_POST_API_KEY", e.target.value)}
                    placeholder={uploadPostItem?.is_set ? "Оставьте пустым, чтобы сохранить текущий ключ" : uploadPostItem?.placeholder}
                    className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/60 font-mono transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecrets(prev => ({ ...prev, UPLOAD_POST_API_KEY: !prev["UPLOAD_POST_API_KEY"] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition"
                  >
                    {showSecrets["UPLOAD_POST_API_KEY"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleTestConnection("upload_post", "UPLOAD_POST_API_KEY")}
                  disabled={testingService === "upload_post"}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {testingService === "upload_post" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  Проверить связь
                </button>
              </div>
            </div>

            {/* Test result banner */}
            {testResults["upload_post"] && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 animate-fade-in ${
                  testResults["upload_post"].ok
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                }`}
              >
                {testResults["upload_post"].ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                )}
                <span>{testResults["upload_post"].message}</span>
              </div>
            )}
          </div>
        </div>

        {/* 2. TELEGRAM BOT */}
        <div className="rounded-2xl border border-zinc-800 bg-[#0d0d12]/90 backdrop-blur-xl p-6 shadow-xl relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-zinc-800/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                <Send className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white">Telegram Bot & Уведомления</h2>
                  {tgTokenItem?.is_set ? (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Активен ({tgTokenItem.source})
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Не настроен
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Прием ссылок, быстрый постинг, ручные правки и оповещения команды об опубликованных роликах.
                </p>
              </div>
            </div>

            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 hover:underline shrink-0"
            >
              Создать бота в @BotFather <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="mt-5 space-y-4">
            {/* Bot Token */}
            <div>
              <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between mb-1.5">
                <span>TELEGRAM_BOT_TOKEN</span>
                {tgTokenItem?.is_set && (
                  <span className="text-[11px] text-zinc-500 font-mono">
                    Текущий: {tgTokenItem.masked_value}
                  </span>
                )}
              </label>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showSecrets["TELEGRAM_BOT_TOKEN"] ? "text" : "password"}
                    value={formData["TELEGRAM_BOT_TOKEN"] ?? ""}
                    onChange={e => handleInputChange("TELEGRAM_BOT_TOKEN", e.target.value)}
                    placeholder={tgTokenItem?.is_set ? "Оставьте пустым, чтобы сохранить текущий токен" : "1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ..."}
                    className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-sky-500/60 font-mono transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecrets(prev => ({ ...prev, TELEGRAM_BOT_TOKEN: !prev["TELEGRAM_BOT_TOKEN"] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition"
                  >
                    {showSecrets["TELEGRAM_BOT_TOKEN"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleTestConnection("telegram", "TELEGRAM_BOT_TOKEN")}
                  disabled={testingService === "telegram"}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {testingService === "telegram" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  Проверить бота
                </button>
              </div>
            </div>

            {testResults["telegram"] && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 animate-fade-in ${
                  testResults["telegram"].ok
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                }`}
              >
                {testResults["telegram"].ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                )}
                <span>{testResults["telegram"].message}</span>
              </div>
            )}

            {/* Allowed Users */}
            <div className="pt-2 border-t border-zinc-800/40">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  TELEGRAM_ALLOWED_USERS (ID пользователей с доступом)
                </label>
                <span className="text-[11px] text-zinc-400">
                  {allowedCount > 0 ? (
                    <span className="text-lime-400 font-semibold">{allowedCount} польз. в белом списке</span>
                  ) : (
                    <span className="text-zinc-500">Доступен всем пользователям (пусто)</span>
                  )}
                </span>
              </div>

              <input
                type="text"
                value={formData["TELEGRAM_ALLOWED_USERS"] ?? (tgUsersItem?.raw_value || "")}
                onChange={e => handleInputChange("TELEGRAM_ALLOWED_USERS", e.target.value)}
                placeholder="123456789, 987654321"
                className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-sky-500/60 font-mono transition"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Перечислите числовые ID пользователей через запятую. Свой ID можно узнать в боте <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-sky-400 underline">@userinfobot</a> или отправив команду <code className="bg-zinc-800 px-1 py-0.5 rounded text-zinc-300">/id</code> нашему боту.
              </p>
            </div>
          </div>
        </div>

        {/* 3. GEMINI AI */}
        <div className="rounded-2xl border border-zinc-800 bg-[#0d0d12]/90 backdrop-blur-xl p-6 shadow-xl relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-zinc-800/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white">Google Gemini AI (Рерайтер хуков)</h2>
                  {geminiItem?.is_set ? (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> gemini-1.5-flash ({geminiItem.source})
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                      <Cpu className="w-3 h-3" /> Работает по правилам (Fallback)
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Генерация вирусных заголовков, интригующих описаний и релевантных хештегов для роликов.
                </p>
              </div>
            </div>

            <a
              href="https://aistudio.google.com"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 hover:underline shrink-0"
            >
              Получить бесплатный ключ в Google AI Studio <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="mt-5 space-y-3">
            <div>
              <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between mb-1.5">
                <span>GEMINI_API_KEY</span>
                {geminiItem?.is_set && (
                  <span className="text-[11px] text-zinc-500 font-mono">
                    Текущий: {geminiItem.masked_value}
                  </span>
                )}
              </label>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showSecrets["GEMINI_API_KEY"] ? "text" : "password"}
                    value={formData["GEMINI_API_KEY"] ?? ""}
                    onChange={e => handleInputChange("GEMINI_API_KEY", e.target.value)}
                    placeholder={geminiItem?.is_set ? "Оставьте пустым, чтобы сохранить текущий ключ" : "AIzaSy..."}
                    className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/60 font-mono transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecrets(prev => ({ ...prev, GEMINI_API_KEY: !prev["GEMINI_API_KEY"] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition"
                  >
                    {showSecrets["GEMINI_API_KEY"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleTestConnection("gemini", "GEMINI_API_KEY")}
                  disabled={testingService === "gemini"}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {testingService === "gemini" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Проверить Gemini
                </button>
              </div>
            </div>

            {testResults["gemini"] && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 animate-fade-in ${
                  testResults["gemini"].ok
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                }`}
              >
                {testResults["gemini"].ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                )}
                <span>{testResults["gemini"].message}</span>
              </div>
            )}
          </div>
        </div>

        {/* 4. DASHBOARD URL */}
        <div className="rounded-2xl border border-zinc-800 bg-[#0d0d12]/90 backdrop-blur-xl p-6 shadow-xl relative overflow-hidden">
          <div className="flex items-center gap-3 pb-4 border-b border-zinc-800/60">
            <div className="w-10 h-10 rounded-xl bg-lime-500/10 border border-lime-500/20 flex items-center justify-center text-lime-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Публичный URL веб-дашборда</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Используется для формирования ссылок на видео, календарь и коллекции внутри Telegram-сообщений.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
              DASHBOARD_URL
            </label>
            <input
              type="text"
              value={formData["DASHBOARD_URL"] ?? (dashboardItem?.raw_value || "https://apeworker.top")}
              onChange={e => handleInputChange("DASHBOARD_URL", e.target.value)}
              placeholder="https://apeworker.top"
              className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-lime-500/60 font-mono transition"
            />
          </div>
        </div>

      </div>

      {/* Floating Save Trigger */}
      <div className="flex justify-end pt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 rounded-xl font-bold bg-lime-400 hover:bg-lime-500 text-zinc-950 transition shadow-xl shadow-lime-950/40 flex items-center gap-2 text-sm cursor-pointer disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-zinc-950" /> Сохранение настроек...
            </>
          ) : saveSuccess ? (
            <>
              <Check className="w-4 h-4 text-zinc-950" /> Настройки сохранены!
            </>
          ) : (
            <>
              <Save className="w-4 h-4 text-zinc-950" /> Сохранить все изменения
            </>
          )}
        </button>
      </div>
    </div>
  );
}
